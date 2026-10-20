// 成片后处理容器：ffmpeg 一次解码同时产出“带 AI 标识水印的成片 + 封面 + 预览短片”，再用 c2patool 写入 C2PA manifest。
// POST /process?label=<水印文字>&title=<文件名>&generator=<品牌>&model=<模型名>  body = mp4
//   → 200 multipart/form-data：video（mp4）、poster（jpg）、preview（mp4，无声、长边 480）、meta（JSON）
// GET /health → 200 { ok, signer }
// 单实例同时只处理一个任务，忙时返回 503 busy，由调用方（队列）重试。
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const env = process.env
const PORT = Number(env.PORT || 8080)
const FFMPEG = env.FFMPEG || 'ffmpeg'
const FFPROBE = env.FFPROBE || 'ffprobe'
const C2PATOOL = env.C2PATOOL || 'c2patool'
const FONT_FILE = env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
const X264_PRESET = env.X264_PRESET || 'veryfast'
const FFMPEG_THREADS = Number(env.FFMPEG_THREADS || 1)
const MAX_INPUT_BYTES = Number(env.MAX_INPUT_BYTES || 200 * 1024 * 1024)
const MAX_DURATION_SECONDS = Number(env.MAX_DURATION_SECONDS || 120)
const JOB_TIMEOUT_MS = Number(env.JOB_TIMEOUT_MS || 300_000)
const PREVIEW_SECONDS = 3
const POSTER_AT_SECONDS = 1
const AI_SOURCE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

class HttpError extends Error {
  constructor(status, code, detail) {
    super(detail ? `${code}: ${detail}` : code)
    this.status = status
    this.code = code
  }
}

// 签名凭据只从环境变量（Worker secret）读取。c2patool 在没有凭据时会静默改用内置测试证书，
// 所以必须显式配置；只有 C2PA_ALLOW_TEST_CERT=1（本地/预发）才允许测试证书。
let signer = null

async function loadSigner() {
  const key = env.C2PA_PRIVATE_KEY?.trim()
  const cert = env.C2PA_SIGN_CERT?.trim()
  if (key && cert) {
    const dir = join(tmpdir(), 'c2pa-signer')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, 'key.pem'), key + '\n', { mode: 0o600 })
    await writeFile(join(dir, 'cert.pem'), cert + '\n', { mode: 0o600 })
    return {
      kind: 'configured',
      alg: env.C2PA_ALG || 'es256',
      privateKey: join(dir, 'key.pem'),
      signCert: join(dir, 'cert.pem'),
      taUrl: env.C2PA_TA_URL || undefined,
    }
  }
  if (env.C2PA_ALLOW_TEST_CERT === '1') return { kind: 'test' }
  return null
}

function run(cmd, args, { cwd, timeoutMs = JOB_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${cmd} exited ${code ?? signal}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`))
    })
  })
}

// filtergraph 里的路径：反斜杠换成 /，冒号（Windows 盘符）和单引号转义
function filterPath(path) {
  return `'${path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`
}

async function probe(file) {
  let info
  try {
    info = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30_000 }))
  } catch {
    throw new HttpError(422, 'invalid_video')
  }
  const video = info.streams?.find((s) => s.codec_type === 'video')
  const duration = Number(info.format?.duration)
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new HttpError(422, 'invalid_video')
  if (duration > MAX_DURATION_SECONDS) throw new HttpError(422, 'video_too_long', `${duration}s`)
  return { width: video.width, height: video.height, duration, hasAudio: info.streams.some((s) => s.codec_type === 'audio') }
}

// 在任务目录（cwd）里执行：读 input.mp4、label.txt，写 main.mp4、preview.mp4、poster.jpg。
// 线程数要显式给：容器里 nproc 看到的是宿主机核数，x264 按核数开线程会在小实例上爆内存。
// 实例只有 1/4–1/2 vCPU，实测单线程比双线程 CPU 时间和峰值内存都更低（.tmp/postprocess/bench-results.json，只在作者本机）。
export function transcodeArgs({ labeled, duration, fontFile = FONT_FILE, preset = X264_PRESET, threads = FFMPEG_THREADS }) {
  const posterAt = Math.min(POSTER_AT_SECONDS, duration / 2)
  // 水印：右下角半透明底框，字号随画面高度变化。文字走 textfile 避免 filtergraph 转义；
  // expansion=none 必须加，否则文字里的 % 会被当成 %{...} 展开，整行静默不画
  let head = '[0:v]'
  if (labeled) {
    head +=
      `drawtext=fontfile=${filterPath(fontFile)}:textfile=label.txt:expansion=none:fontcolor=white:fontsize=h/40:` +
      `box=1:boxcolor=black@0.45:boxborderw=h/160:x=w-tw-h/40:y=h-th-h/40,`
  }
  const longSide480 = "scale='if(gt(iw,ih),480,-2)':'if(gt(iw,ih),-2,480)'"
  const graph = [
    `${head}split=3[main][pv][po]`,
    `[pv]trim=duration=${PREVIEW_SECONDS},setpts=PTS-STARTPTS,fps=15,${longSide480}[preview]`,
    `[po]trim=start=${posterAt},setpts=PTS-STARTPTS[poster]`,
  ].join(';')
  const x264 = ['-c:v', 'libx264', '-preset', preset, '-threads', String(threads), '-pix_fmt', 'yuv420p']
  return [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', '1', '-i', 'input.mp4', '-filter_complex', graph],
    ...['-map', '[main]', '-map', '0:a?', ...x264, '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', 'main.mp4'],
    ...['-map', '[preview]', '-an', ...x264, '-crf', '30', '-movflags', '+faststart', 'preview.mp4'],
    ...['-map', '[poster]', '-frames:v', '1', '-q:v', '3', 'poster.jpg'],
  ]
}

async function transcode(dir, label, meta) {
  if (label) await writeFile(join(dir, 'label.txt'), label)
  await run(FFMPEG, transcodeArgs({ labeled: Boolean(label), duration: meta.duration }), { cwd: dir })
}

async function sign(dir, file, out, { title, generator, model }) {
  const manifest = {
    claim_generator_info: [{ name: generator, version: '1' }],
    title,
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            { action: 'c2pa.created', digitalSourceType: AI_SOURCE_TYPE, ...(model ? { softwareAgent: { name: model } } : {}) },
          ],
        },
      },
    ],
  }
  if (signer.kind === 'configured') {
    Object.assign(manifest, { alg: signer.alg, private_key: signer.privateKey, sign_cert: signer.signCert })
    if (signer.taUrl) manifest.ta_url = signer.taUrl
  }
  const manifestFile = join(dir, `${out}.manifest.json`)
  await writeFile(manifestFile, JSON.stringify(manifest))
  await run(C2PATOOL, [file, '-m', manifestFile, '-o', out, '-f'], { cwd: dir })
}

async function processJob(req, url) {
  if (!signer) throw new HttpError(500, 'c2pa_not_configured')
  const length = Number(req.headers['content-length'] || 0)
  if (length > MAX_INPUT_BYTES) throw new HttpError(413, 'input_too_large')
  const label = (url.searchParams.get('label') || '').slice(0, 80)
  const title = (url.searchParams.get('title') || 'video.mp4').replace(/[^\w.-]/g, '_').slice(0, 80)
  const generator = (url.searchParams.get('generator') || 'video-template').slice(0, 80)
  const model = (url.searchParams.get('model') || '').slice(0, 80)

  const dir = join(tmpdir(), `job-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const t0 = performance.now()
  try {
    let received = 0
    const input = join(dir, 'input.mp4')
    await pipeline(
      req,
      async function* (source) {
        for await (const chunk of source) {
          received += chunk.length
          if (received > MAX_INPUT_BYTES) throw new HttpError(413, 'input_too_large')
          yield chunk
        }
      },
      createWriteStream(input),
    )
    const meta = await probe(input)
    const t1 = performance.now()
    await transcode(dir, label, meta)
    const t2 = performance.now()
    const stem = title.replace(/\.mp4$/i, '')
    await sign(dir, 'main.mp4', 'video.mp4', { title, generator, model })
    await sign(dir, 'preview.mp4', 'preview.signed.mp4', { title: `${stem}-preview.mp4`, generator, model })
    await sign(dir, 'poster.jpg', 'poster.signed.jpg', { title: `${stem}-poster.jpg`, generator, model })
    const t3 = performance.now()

    const files = { video: 'video.mp4', preview: 'preview.signed.mp4', poster: 'poster.signed.jpg' }
    const sizes = {}
    for (const [k, f] of Object.entries(files)) sizes[k] = (await stat(join(dir, f))).size
    const form = new FormData()
    form.set('video', await openAsBlob(join(dir, files.video), { type: 'video/mp4' }), files.video)
    form.set('preview', await openAsBlob(join(dir, files.preview), { type: 'video/mp4' }), 'preview.mp4')
    form.set('poster', await openAsBlob(join(dir, files.poster), { type: 'image/jpeg' }), 'poster.jpg')
    form.set(
      'meta',
      JSON.stringify({
        input: { bytes: received, ...meta },
        sizes,
        labeled: Boolean(label),
        c2pa: { signer: signer.kind, digitalSourceType: AI_SOURCE_TYPE },
        ms: { probe: Math.round(t1 - t0), transcode: Math.round(t2 - t1), sign: Math.round(t3 - t2), total: Math.round(t3 - t0) },
      }),
    )
    // Response 会把 FormData 编成 multipart 并给出带 boundary 的 content-type；读完再删临时目录
    const body = new Response(form)
    const bytes = Buffer.from(await body.arrayBuffer())
    return { type: body.headers.get('content-type'), bytes }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

let busy = false

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://container')
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, signer: signer?.kind ?? null })
  if (req.method !== 'POST' || url.pathname !== '/process') return sendJson(res, 404, { error: 'not_found' })
  if (busy) {
    req.resume()
    return sendJson(res, 503, { error: 'busy' })
  }
  busy = true
  try {
    const { type, bytes } = await processJob(req, url)
    res.writeHead(200, { 'content-type': type, 'content-length': bytes.length }).end(bytes)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status >= 500) console.error('[postprocess]', err)
    if (!req.complete) req.resume()
    sendJson(res, status, { error: err instanceof HttpError ? err.code : 'postprocess_failed', detail: status >= 500 ? String(err.message) : undefined })
  } finally {
    busy = false
  }
}

if (import.meta.main) {
  signer = await loadSigner()
  createServer(handle).listen(PORT, () => console.log(`[postprocess] listening on :${PORT}, signer=${signer?.kind ?? 'missing'}`))
}
