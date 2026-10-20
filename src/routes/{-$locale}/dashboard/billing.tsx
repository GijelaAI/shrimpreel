import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OrderStatusPill } from '#/components/order-status'
import { ErrorText, LocalLink, Spinner, formatDate } from '#/components/ui'
import { formatPrice } from '#/config/site'
import { api, errorCode, type LedgerEntry, type Order } from '#/lib/api'
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

  const error = orders.error ?? ledger.error
  if (error) return <ErrorText code={error} />
  if (!orders.items || !ledger.items) return <Spinner className="size-5" />

  return (
    <div className="grid gap-10 lg:grid-cols-2">
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
                      {c.pricing.packages[o.packageId]?.name ?? o.packageId}
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
