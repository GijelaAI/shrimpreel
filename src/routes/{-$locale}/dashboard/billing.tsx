import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ErrorText, Spinner, StatusPill, formatDate } from '#/components/ui'
import { formatPrice } from '#/config/site'
import { api, errorCode, type LedgerEntry, type Order } from '#/lib/api'
import { useContent, useLocale } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/dashboard/billing')({
  component: BillingPage,
})

const ORDER_TONES = { pending: 'muted', paid: 'ok', partially_refunded: 'warn', failed: 'bad', refunded: 'warn', canceled: 'muted' } as const

function BillingPage() {
  const c = useContent()
  const b = c.billing
  const locale = useLocale()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api<{ orders: Order[] }>('/api/orders'), api<{ entries: LedgerEntry[] }>('/api/credits/ledger')])
      .then(([o, l]) => {
        setOrders(o.orders)
        setLedger(l.entries)
      })
      .catch((err) => setError(errorCode(err)))
  }, [])

  if (error) return <ErrorText code={error} />
  if (!orders || !ledger) return <Spinner className="size-5" />

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h2 className="mb-4 font-display text-2xl">{b.orders}</h2>
        {orders.length ? (
          <div className="card overflow-x-auto">
            <table className="table-admin" data-testid="orders-table">
              <thead>
                <tr>
                  <th>{b.columns.date}</th>
                  <th>{b.columns.pack}</th>
                  <th>{b.columns.amount}</th>
                  <th>{b.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">{formatDate(o.createdAt, locale)}</td>
                    <td>
                      {c.pricing.packages[o.packageId]?.name ?? o.packageId}
                      <span className="block text-xs text-muted">{c.nav.credits(o.credits)}</span>
                    </td>
                    <td>{formatPrice(o.amountCents, o.currency)}</td>
                    <td>
                      <StatusPill tone={ORDER_TONES[displayStatus(o)]}>{b.orderStatus[displayStatus(o)] ?? o.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">{b.noOrders}</p>
        )}
      </section>
      <section>
        <h2 className="mb-4 font-display text-2xl">{b.ledger}</h2>
        {ledger.length ? (
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
                {ledger.map((entry) => (
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
      </section>
    </div>
  )
}

function displayStatus(o: Order) {
  return o.status === 'paid' && o.refundedAmountCents > 0 ? 'partially_refunded' : o.status
}
