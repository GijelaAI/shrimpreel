import { useEffect, useRef, type ReactNode } from 'react'

// 竖屏示例视频：进入视口自动静音播放，离开暂停；尊重“减少动态效果”设置
export function VideoCard({
  video,
  poster,
  label,
  credit,
  className = '',
}: {
  video: string
  poster: string
  label?: ReactNode
  credit?: string
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) element.play().catch(() => {})
        else element.pause()
      },
      { threshold: 0.35 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <figure className={className}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-bg-soft shadow-sm ring-1 ring-line">
        <video
          ref={ref}
          src={video}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
        {label ? (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {label}
          </span>
        ) : null}
      </div>
      {credit ? <figcaption className="mt-2 truncate text-xs text-muted">{credit}</figcaption> : null}
    </figure>
  )
}
