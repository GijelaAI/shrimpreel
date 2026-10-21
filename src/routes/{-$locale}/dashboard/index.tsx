import { createFileRoute } from '@tanstack/react-router'
import { Download, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AiBadge, ErrorText, Spinner, StatusPill, formatDate } from '#/components/ui'
import { site } from '#/config/site'
import { api, errorCode, isActiveGeneration, type Generation } from '#/lib/api'
import { useContent, useLocale, useLocalePath } from '#/lib/i18n'
import { captureSharePoster } from '#/lib/share-poster'
import { useSession } from '#/lib/session'

export const Route = createFileRoute('/{-$locale}/dashboard/')({
  component: VideosPage,
})

const TONES = { queued: 'muted', processing: 'warn', succeeded: 'ok', failed: 'bad', expired: 'muted', removed: 'bad' } as const

function VideosPage() {
  const c = useContent()
  const d = c.dashboard
  const locale = useLocale()
  const lp = useLocalePath()
  const { refresh } = useSession()
  const [items, setItems] = useState<Generation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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

  function setShareId(id: string, shareId: string | null) {
    setItems((list) => list?.map((g) => (g.id === id ? { ...g, shareId } : g)) ?? null)
  }

  // 分享：先在浏览器里截一帧做链接预览图（失败就不带，分享页用站点默认图），再生成公开链接
  async function share(g: Generation) {
    if (!g.videoUrl || !confirm(d.confirmShare)) return
    setSharing(g.id)
    try {
      const poster = await captureSharePoster(g.videoUrl, c.common.aiGenerated)
      const { shareId } = await api<{ shareId: string }>(`/api/generations/${g.id}/share`, { method: 'POST', blob: poster ?? undefined })
      setShareId(g.id, shareId)
      setError(null)
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setSharing(null)
    }
  }

  async function unshare(g: Generation) {
    if (!confirm(d.confirmStopSharing)) return
    try {
      await api(`/api/generations/${g.id}/share`, { method: 'DELETE' })
      setShareId(g.id, null)
      setCopied(null)
    } catch (err) {
      setError(errorCode(err))
    }
  }

  async function copyLink(shareId: string, id: string) {
    const url = `${window.location.origin}${lp(`/v/${shareId}`)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
    } catch {
      // 剪贴板不可用（非 https、权限被拒）时让用户手动复制
      prompt(d.copyPrompt, url)
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
                <div className="flex flex-wrap gap-2 pt-1">
                  {g.videoUrl ? (
                    <a href={`${g.videoUrl}?download=1`} className="btn-ghost px-3 py-1.5 text-xs" download>
                      <Download className="size-3.5" /> {d.download}
                    </a>
                  ) : null}
                  {g.videoUrl && site.share.enabled && !g.shareId ? (
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => share(g)}
                      disabled={sharing === g.id}
                      data-testid="share-button"
                    >
                      {sharing === g.id ? <Spinner className="size-3.5" /> : <Share2 className="size-3.5" />} {d.share}
                    </button>
                  ) : null}
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => remove(g.id)}>
                    <Trash2 className="size-3.5" /> {d.delete}
                  </button>
                </div>
              ) : null}
              {g.videoUrl && g.shareId ? (
                <div className="space-y-1.5 rounded-lg bg-bg-soft p-2.5 text-xs" data-testid="share-controls">
                  <p className="text-muted">{d.sharedNote}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <a href={lp(`/v/${g.shareId}`)} target="_blank" rel="noopener" className="underline underline-offset-2" data-testid="share-link">
                      {d.openSharePage}
                    </a>
                    <button type="button" className="underline underline-offset-2" onClick={() => copyLink(g.shareId!, g.id)}>
                      {copied === g.id ? d.linkCopied : d.copyLink}
                    </button>
                    <button type="button" className="underline underline-offset-2" onClick={() => unshare(g)} data-testid="stop-sharing">
                      {d.stopSharing}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
