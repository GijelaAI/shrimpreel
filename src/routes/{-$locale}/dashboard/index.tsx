import { createFileRoute } from '@tanstack/react-router'
import { Download, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AiBadge, ErrorText, Spinner, StatusPill, formatDate } from '#/components/ui'
import { api, errorCode, isActiveGeneration, type Generation } from '#/lib/api'
import { useContent, useLocale } from '#/lib/i18n'
import { useSession } from '#/lib/session'

export const Route = createFileRoute('/{-$locale}/dashboard/')({
  component: VideosPage,
})

const TONES = { queued: 'muted', processing: 'warn', succeeded: 'ok', failed: 'bad', expired: 'muted', removed: 'bad' } as const

function VideosPage() {
  const c = useContent()
  const d = c.dashboard
  const locale = useLocale()
  const { refresh } = useSession()
  const [items, setItems] = useState<Generation[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api<{ generations: Generation[] }>('/api/generations')
      setItems(data.generations)
      setError(null)
      return data.generations
    } catch (err) {
      setError(errorCode(err))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 有进行中的任务时每 5 秒刷新；结束后同步余额（失败退款）
  const hasActive = items?.some(isActiveGeneration) ?? false
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(async () => {
      const next = await load()
      if (next && !next.some(isActiveGeneration)) await refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [hasActive, load, refresh])

  async function remove(id: string) {
    if (!confirm(d.confirmDelete)) return
    try {
      await api(`/api/generations/${id}`, { method: 'DELETE' })
      setItems((list) => list?.filter((g) => g.id !== id) ?? null)
    } catch (err) {
      setError(errorCode(err))
    }
  }

  if (!items) return error ? <ErrorText code={error} /> : <Spinner className="size-5" />
  if (!items.length) return <p className="text-muted">{d.empty}</p>

  return (
    <div className="space-y-4">
      <ErrorText code={error} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="video-list">
        {items.map((g) => (
          <div
            key={g.id}
            className="card overflow-hidden"
            data-testid="video-item"
            data-status={g.status}
            data-media={g.removed ? 'removed' : g.expired ? 'expired' : g.videoUrl ? 'available' : 'none'}
          >
            <div className="relative grid aspect-[9/16] place-items-center bg-bg-soft">
              {g.status === 'succeeded' && g.videoUrl ? (
                <>
                  <AiBadge />
                  <video src={g.videoUrl} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
                </>
              ) : isActiveGeneration(g) ? (
                <Spinner className="size-6 text-muted" />
              ) : g.removed || g.expired ? (
                <span className="px-4 text-center text-sm text-muted">{g.removed ? d.removed : d.expired}</span>
              ) : (
                <span className="px-4 text-center text-sm text-muted">{g.refunded ? d.refundedNote : d.status.failed}</span>
              )}
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                {(() => {
                  // 成片被下架或过期后，任务状态仍是 succeeded，标签按媒体状态显示
                  const shown = g.removed ? 'removed' : g.expired ? 'expired' : g.status
                  return <StatusPill tone={TONES[shown]}>{d.status[shown] ?? shown}</StatusPill>
                })()}
                <span className="text-xs text-muted">
                  {d.seconds(g.durationSeconds)} · {c.nav.credits(g.creditsCost)}
                </span>
              </div>
              <p className="text-xs text-muted">{formatDate(g.createdAt, locale)}</p>
              {g.expiresAt ? <p className="text-xs text-muted">{d.expiresOn(formatDate(g.expiresAt, locale))}</p> : null}
              {g.status === 'failed' && g.refunded ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{d.refundedNote}</p> : null}
              {!isActiveGeneration(g) ? (
                <div className="flex gap-2 pt-1">
                  {g.videoUrl ? (
                    <a href={`${g.videoUrl}?download=1`} className="btn-ghost px-3 py-1.5 text-xs" download>
                      <Download className="size-3.5" /> {d.download}
                    </a>
                  ) : null}
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => remove(g.id)}>
                    <Trash2 className="size-3.5" /> {d.delete}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
