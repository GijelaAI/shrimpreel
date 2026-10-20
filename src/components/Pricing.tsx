import { useRouterState } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { formatPrice, site } from '#/config/site'
import { api, errorCode } from '#/lib/api'
import { track } from '#/lib/attribution'
import { useContent, useLocale, useLocalePath } from '#/lib/i18n'
import { signInHref, useSession } from '#/lib/session'
import { ErrorText, Spinner } from './ui'

export function Pricing() {
  const c = useContent()
  const p = c.pricing
  const locale = useLocale()
  const lp = useLocalePath()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user, config, loading } = useSession()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shortest = site.durations[0]!

  async function buy(packageId: string) {
    if (!user) {
      location.href = signInHref(config, pathname, lp('/sign-in'))
      return
    }
    setError(null)
    setPending(packageId)
    const pack = site.packages.find((p) => p.id === packageId)
    if (pack) {
      track('begin_checkout', {
        value: pack.priceCents / 100,
        currency: pack.currency,
        items: [{ item_id: pack.id, item_name: pack.id, quantity: 1 }],
      })
    }
    try {
      const data = await api<{ orderId: string; url: string }>('/api/checkout', { json: { packageId, locale } })
      location.href = data.url
    } catch (err) {
      setError(errorCode(err))
      setPending(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-3">
        {site.packages.map((pack) => {
          const info = p.packages[pack.id] ?? { name: pack.id, tagline: '' }
          const highlight = 'highlight' in pack && pack.highlight
          return (
            <div
              key={pack.id}
              className={`card relative flex flex-col p-6 ${highlight ? 'ring-2 ring-ink md:-translate-y-2' : ''}`}
              data-testid={`package-${pack.id}`}
            >
              {highlight ? (
                <span className="absolute -top-3 left-6 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-ink-fg">{p.popular}</span>
              ) : null}
              <h3 className="font-display text-2xl">{info.name}</h3>
              <p className="mt-1 text-sm text-muted">{info.tagline}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-4xl">{formatPrice(pack.priceCents, pack.currency)}</span>
              </p>
              <p className="mt-1 text-sm font-semibold">{p.credits(pack.credits)}</p>
              <p className="text-xs text-muted">{p.approx(Math.floor(pack.credits / shortest.credits), shortest.seconds)}</p>
              <ul className="my-6 space-y-2.5 text-sm">
                {p.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {bullet}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => buy(pack.id)}
                // 会话还在加载时 user 为空，此时点击会把已登录用户误送去登录页
                disabled={pending !== null || loading}
                className={`${highlight ? 'btn-primary' : 'btn-ghost'} mt-auto w-full`}
                data-testid={`buy-${pack.id}`}
              >
                {pending === pack.id ? (
                  <>
                    <Spinner /> {p.buying}
                  </>
                ) : (
                  p.buy
                )}
              </button>
            </div>
          )
        })}
      </div>
      <ErrorText code={error} />
      <p className="text-center text-xs text-muted">{p.note}</p>
    </div>
  )
}
