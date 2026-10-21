import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OrderStatusPill } from '#/components/order-status'
import { ErrorText, LocalLink, Spinner, StatusPill, formatDate } from '#/components/ui'
import { formatPrice } from '#/config/site'
import { api, errorCode, type ExpiringCredits, type LedgerEntry, type Order, type Subscription } from '#/lib/api'
import { useContent, useLocale } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/dashboard/billing')({
  component: BillingPage,
})

// 与服务端 /api/orders、/api/credits/ledger 的默认页大小一致：满一页才可能还有下一页
const PAGE_SIZE = 50

// 分页列表：首屏加载第 1 页，“加载更多”逐页追加
function usePagedList<T>(path: string, key: 'orders' | 'entries') {
  const [items, setItems] = useState<T[] | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(next: number) {
    setLoading(true)
    try {
      const data = await api<Record<string, T[]>>(`${path}?page=${next}`)
      const rows = data[key] ?? []
      setItems((prev) => (next === 1 ? rows : [...(prev ?? []), ...rows]))
      setPage(next)
      setHasMore(rows.length === PAGE_SIZE)
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(1)
  }, [path])

  return { items, error, loading, hasMore, loadMore: () => load(page + 1) }
}

function BillingPage() {
  const c = useContent()
  const b = c.billing
  const locale = useLocale()
  const orders = usePagedList<Order>('/api/orders', 'orders')
  const ledger = usePagedList<LedgerEntry>('/api/credits/ledger', 'entries')
  const [expiring, setExpiring] = useState<ExpiringCredits[]>([])

  // 到期提示只是附加信息，加载失败不影响账单
  useEffect(() => {
    api<{ expiring: ExpiringCredits[] }>('/api/credits/expiring')
      .then((data) => setExpiring(data.expiring))
      .catch(() => setExpiring([]))
  }, [])

  const error = orders.error ?? ledger.error
  if (error) return <ErrorText code={error} />
  if (!orders.items || !ledger.items) return <Spinner className="size-5" />

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <SubscriptionCard />
      {expiring.length ? (
        <div className="card p-4 text-sm lg:col-span-2" data-testid="credits-expiring">
          {expiring.map((row) => (
            <p key={row.expiresAt}>{b.expiring(row.credits, formatDate(row.expiresAt, locale))}</p>
          ))}
          <p className="mt-1 text-muted">{b.expiringHint}</p>
        </div>
      ) : null}
      <section>
        <h2 className="mb-4 font-display text-2xl">{b.orders}</h2>
        {orders.items.length ? (
          <div className="card overflow-x-auto">
            <table className="table-admin" data-testid="orders-table">
              <thead>
                <tr>
                  <th>{b.columns.date}</th>
                  <th>{b.columns.pack}</th>
                  <th>{b.columns.amount}</th>
                  <th>{b.columns.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.items.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">{formatDate(o.createdAt, locale)}</td>
                    <td>
                      {c.pricing.packages[o.packageId]?.name ?? c.pricing.plans[o.packageId]?.name ?? o.packageId}
                      <span className="block text-xs text-muted">{c.nav.credits(o.credits)}</span>
                    </td>
                    <td>
                      {formatPrice(o.paidAmountCents ?? o.amountCents, o.paidCurrency ?? o.currency)}
                      {o.refundedAmountCents > 0 ? (
                        <span className="block text-xs text-muted">
                          {b.refundedLine(formatPrice(o.refundedAmountCents, o.paidCurrency ?? o.currency), o.refundedCredits)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <OrderStatusPill order={o} />
                    </td>
                    <td className="text-right">
                      <LocalLink to={`/dashboard/orders/${o.id}`} className="text-sm font-medium hover:underline" data-testid={`order-details-${o.id}`}>
                        {b.details}
                      </LocalLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">{b.noOrders}</p>
        )}
        <LoadMore list={orders} label={b.loadMore} testId="orders-load-more" />
      </section>
      <section>
        <h2 className="mb-4 font-display text-2xl">{b.ledger}</h2>
        {ledger.items.length ? (
          <div className="card overflow-x-auto">
            <table className="table-admin" data-testid="ledger-table">
              <thead>
                <tr>
                  <th>{b.columns.date}</th>
                  <th>{b.columns.reason}</th>
                  <th className="text-right">{b.columns.change}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap">{formatDate(entry.created_at, locale)}</td>
                    <td>{b.reasons[entry.reason] ?? entry.reason}</td>
                    <td className={`text-right font-mono ${entry.delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">{b.noLedger}</p>
        )}
        <LoadMore list={ledger} label={b.loadMore} testId="ledger-load-more" />
      </section>
    </div>
  )
}

type SubscriptionState = { subscription: Subscription | null; canResume: boolean; canPortal: boolean }

// 订阅卡片：没有订阅时不显示。取消续费在本站完成；恢复要看支付商是否允许商户操作，不允许的引导去客户门户
function SubscriptionCard() {
  const c = useContent()
  const s = c.billing.subscription
  const locale = useLocale()
  const [state, setState] = useState<SubscriptionState | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<SubscriptionState>('/api/subscription')
      .then(setState)
      .catch((err) => setError(errorCode(err)))
  }, [])

  const sub = state?.subscription
  if (!sub) return error ? <ErrorText code={error} /> : null

  async function run(action: 'cancel' | 'resume' | 'portal') {
    if (action === 'cancel' && !confirm(s.confirmCancel)) return
    setError(null)
    setPending(action)
    try {
      if (action === 'portal') {
        const data = await api<{ url: string }>('/api/subscription/portal', { json: { locale } })
        location.href = data.url
        return
      }
      const data = await api<{ subscription: Subscription }>(`/api/subscription/${action}`, { json: {} })
      setState((prev) => (prev ? { ...prev, subscription: data.subscription } : prev))
    } catch (err) {
      setError(errorCode(err))
    }
    setPending(null)
  }

  const plan = c.pricing.plans[sub.planId]?.name ?? sub.planId
  const price = formatPrice(sub.amountCents, sub.currency)
  const ended = sub.status === 'canceled' || sub.status === 'expired'
  const periodEnd = sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, locale) : null
  const tone = sub.status === 'active' ? (sub.cancelAtPeriodEnd ? 'warn' : 'ok') : sub.status === 'past_due' ? 'bad' : 'muted'
  const button = (action: 'cancel' | 'resume' | 'portal', label: string, primary = false) => (
    <button
      type="button"
      className={`${primary ? 'btn-primary' : 'btn-ghost'} px-4 py-2 text-sm`}
      disabled={pending !== null}
      onClick={() => run(action)}
      data-testid={`subscription-${action}`}
    >
      {pending === action ? <Spinner className="size-4" /> : label}
    </button>
  )

  return (
    <section className="card p-6 lg:col-span-2" data-testid="subscription-card" data-status={sub.status}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl">{s.title}</h2>
        <StatusPill tone={tone}>{s.status[sub.status] ?? sub.status}</StatusPill>
      </div>
      <p className="mt-2 font-semibold">
        {plan} · {price} {sub.interval === 'year' ? c.pricing.perYear : c.pricing.perMonth}
      </p>
      <p className="text-sm text-muted">{s.monthlyCredits(sub.creditsPerMonth)}</p>
      <div className="mt-3 space-y-1 text-sm">
        {ended ? (
          <p>{s.ended(formatDate(sub.endedAt ?? sub.currentPeriodEnd ?? sub.createdAt, locale))}</p>
        ) : sub.cancelAtPeriodEnd ? (
          periodEnd ? <p data-testid="subscription-ends">{s.endsOn(periodEnd)}</p> : null
        ) : periodEnd && sub.status !== 'past_due' ? (
          <p data-testid="subscription-renews">{s.renewsOn(periodEnd, price)}</p>
        ) : null}
        {!ended && sub.nextGrantAt ? <p className="text-muted">{s.nextGrant(formatDate(sub.nextGrantAt, locale))}</p> : null}
        {sub.status === 'past_due' ? (
          <p className="text-red-700 dark:text-red-400" data-testid="subscription-past-due">
            {s.pastDue}
          </p>
        ) : null}
        {!ended && sub.cancelAtPeriodEnd && !state.canResume && state.canPortal ? <p className="text-muted">{s.resumeInPortal}</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {ended ? (
          <LocalLink to="/pricing" className="btn-primary px-4 py-2 text-sm">
            {s.seePlans}
          </LocalLink>
        ) : (
          <>
            {sub.cancelAtPeriodEnd ? (state.canResume ? button('resume', s.resume, true) : null) : button('cancel', s.cancel)}
            {state.canPortal ? button('portal', s.portal, sub.status === 'past_due') : null}
          </>
        )}
      </div>
      <ErrorText code={error} />
    </section>
  )
}

function LoadMore({ list, label, testId }: { list: { hasMore: boolean; loading: boolean; loadMore: () => unknown }; label: string; testId: string }) {
  if (!list.hasMore) return null
  return (
    <div className="mt-4 text-center">
      <button type="button" className="btn-ghost px-4 py-2 text-sm" disabled={list.loading} onClick={list.loadMore} data-testid={testId}>
        {list.loading ? <Spinner className="size-4" /> : label}
      </button>
    </div>
  )
}
