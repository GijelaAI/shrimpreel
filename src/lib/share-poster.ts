// 分享封面：在浏览器里从成片截一帧，画成 1200×630 的 OG 图（模糊铺底 + 居中原画 + 左上角 AI 标识），导出 JPEG。
// 成片和页面同源，canvas 不会被污染；任何一步失败（解码不了、超时、浏览器不支持）都返回 null，分享页改用站点默认 OG 图
const WIDTH = 1200
const HEIGHT = 630
const TIMEOUT_MS = 8000

function waitFor(video: HTMLVideoElement, event: 'loadeddata' | 'seeked') {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), TIMEOUT_MS)
    video.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true })
    video.addEventListener('error', () => (clearTimeout(timer), reject(new Error('video error'))), { once: true })
  })
}

function drawFit(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, mode: 'cover' | 'contain') {
  const scale = (mode === 'cover' ? Math.max : Math.min)(WIDTH / video.videoWidth, HEIGHT / video.videoHeight)
  const w = video.videoWidth * scale
  const h = video.videoHeight * scale
  ctx.drawImage(video, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
}

export async function captureSharePoster(videoUrl: string, label: string): Promise<Blob | null> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    const loaded = waitFor(video, 'loadeddata')
    video.src = videoUrl
    await loaded
    if (!video.videoWidth || !video.videoHeight) return null
    const seeked = waitFor(video, 'seeked')
    video.currentTime = Math.min(1, (video.duration || 0) / 2)
    await seeked

    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.filter = 'blur(28px) brightness(0.55)'
    drawFit(ctx, video, 'cover')
    ctx.filter = 'none'
    drawFit(ctx, video, 'contain')

    // AI 标识：和站内成片角标一致，截图转发后仍能看出是 AI 生成
    ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", sans-serif'
    const padX = 18
    const boxW = ctx.measureText(label).width + padX * 2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.beginPath()
    ctx.roundRect(28, 28, boxW, 52, 12)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 28 + padX, 55)

    // 服务端上限 512 KB（SHARE_POSTER_MAX_BYTES），细节多的画面降一档质量
    const encode = (quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    const blob = await encode(0.85)
    return blob && blob.size > 480 * 1024 ? encode(0.65) : blob
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}
