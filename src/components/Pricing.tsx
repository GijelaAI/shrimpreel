import { useRouterState } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { anchorPrice, formatPrice, sellingPlans, site, type SubscriptionPlan } from '#/config/site'
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
    const pack = site.packages.find((p) => p.id === packageId) ?? site.plans.find((p) => p.id === packageId)
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

  function buyButton(id: string, primary: boolean, label: string) {
    return (
      <button
        type="button"
        onClick={() => buy(id)}
        // 会话还在加载时 user 为空，此时点击会把已登录用户误送去登录页
        disabled={pending !== null || loading}
        className={`${primary ? 'btn-primary' : 'btn-ghost'} mt-auto w-full`}
        data-testid={`buy-${id}`}
      >
        {pending === id ? (
          <>
            <Spinner /> {p.buying}
          </>
        ) : (
          label
        )}
      </button>
    )
  }

  return (
    <div className="space-y-6">
      {sellingPlans.length ? (
        <>
          <div className="mx-auto max-w-2xl text-center">
            <h3 className="font-display text-2xl">{p.plansTitle}</h3>
            <p className="mt-2 text-sm text-muted">{p.plansBody}</p>
          </div>
          <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-2">
            {sellingPlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} button={buyButton(plan.id, !!plan.highlight, p.subscribe)} />
            ))}
          </div>
          <p className="text-center text-xs text-muted">{p.renewalNote}</p>
          <h3 className="pt-6 text-center font-display text-2xl">{p.packsTitle}</h3>
        </>
      ) : null}
      <div className="grid gap-5 md:grid-cols-3">
        {site.packages.map((pack) => {
          const info = p.packages[pack.id] ?? { name: pack.id, tagline: '' }
          const highlight = 'highlight' in pack && pack.highlight
          const anchor = anchorPrice(pack)
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
              <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display text-4xl">{formatPrice(pack.priceCents, pack.currency)}</span>
                {anchor ? (
                  <>
                    <s className="text-lg text-muted" data-testid={`anchor-${pack.id}`}>
                      <span className="sr-only">{p.was} </span>
                      {formatPrice(anchor.cents, pack.currency)}
                    </s>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{p.save(anchor.percentOff)}</span>
                  </>
                ) : null}
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
              {buyButton(pack.id, !!highlight, p.buy)}
            </div>
          )
        })}
      </div>
      <ErrorText code={error} />
      <p className="text-center text-xs text-muted">{p.note}</p>
    </div>
  )
}

// 年付相对“同积分、同币种月付 × 12”省多少（百分比），没有可比的月付时不显示
function yearlySaving(plan: SubscriptionPlan) {
  if (plan.interval !== 'year') return null
  const monthly = site.plans.find((m) => m.interval === 'month' && m.credits === plan.credits && m.currency === plan.currency)
  if (!monthly) return null
  const percent = Math.round((1 - plan.priceCents / (monthly.priceCents * 12)) * 100)
  return percent > 0 ? percent : null
}

function PlanCard({ plan, button }: { plan: SubscriptionPlan; button: ReactNode }) {
  const p = useContent().pricing
  const info = p.plans[plan.id] ?? { name: plan.id, tagline: '' }
  const saving = yearlySaving(plan)
  return (
    <div className={`card relative flex flex-col p-6 ${plan.highlight ? 'ring-2 ring-ink' : ''}`} data-testid={`plan-${plan.id}`}>
      {plan.highlight ? (
        <span className="absolute -top-3 left-6 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-ink-fg">{p.popular}</span>
      ) : null}
      <h3 className="font-display text-2xl">{info.name}</h3>
      <p className="mt-1 text-sm text-muted">{info.tagline}</p>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-4xl">{formatPrice(plan.priceCents, plan.currency)}</span>
        <span className="text-sm text-muted">{plan.interval === 'year' ? p.perYear : p.perMonth}</span>
        {saving ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            {p.save(saving)}
          </span>
        ) : null}
      </p>
      {plan.interval === 'year' ? (
        <p className="mt-1 text-xs text-muted">{p.yearlyMonthly(formatPrice(Math.round(plan.priceCents / 12), plan.currency))}</p>
      ) : null}
      <p className="mt-1 text-sm font-semibold">{p.monthlyCredits(plan.credits)}</p>
      <ul className="my-6 space-y-2.5 text-sm">
        {p.planBullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {bullet}
          </li>
        ))}
      </ul>
      {button}
    </div>
  )
}
