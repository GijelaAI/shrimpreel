import { createFileRoute } from '@tanstack/react-router'
import { FlaskConical } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorText, Spinner } from '#/components/ui'
import { formatPrice } from '#/config/site'
import { api, errorCode, type Order } from '#/lib/api'
import { useContent, useLocalePath } from '#/lib/i18n'
import { useSession } from '#/lib/session'

type Search = { order?: string }

// 本地 mock 支付页：模拟支付商托管收银台，回调走真实入账逻辑
export const Route = createFileRoute('/{-$locale}/checkout/mock')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    order: typeof search.order === 'string' ? search.order : undefined,
  }),
  head: () => ({ meta: [{ title: 'Mock checkout' }, { name: 'robots', content: 'noindex' }] }),
  component: MockCheckoutPage,
})

function MockCheckoutPage() {
  const c = useContent()
  const t = c.checkout
  const lp = useLocalePath()
  const { order: orderId } = Route.useSearch()
  const { user, loading } = useSession()
  const [order, setOrder] = useState<Order | null>(null)
  const [pending, setPending] = useState<'paid' | 'failed' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId || !user) return
    api<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}`)
      .then((data) => setOrder(data.order))
      .catch((err) => setError(errorCode(err)))
  }, [orderId, user])

  async function complete(outcome: 'paid' | 'failed') {
    if (!orderId) return
    setPending(outcome)
    setError(null)
    try {
      await api('/api/mock-payments/complete', { json: { orderId, outcome } })
      location.href = `${lp('/checkout/success')}?order=${encodeURIComponent(orderId)}`
    } catch (err) {
      setError(errorCode(err))
      setPending(null)
    }
  }

  return (
    <div className="container-page grid max-w-md place-items-center py-24">
      <div className="card w-full space-y-5 p-8" data-testid="mock-checkout">
        <div className="flex items-center gap-3">
          <FlaskConical className="size-6 text-accent" />
          <h1 className="font-display text-2xl">{t.mockTitle}</h1>
        </div>
        <p className="text-sm text-muted">{t.mockBody}</p>
        {loading || (user && !order && !error) ? (
          <Spinner className="size-5" />
        ) : !user ? (
          <p className="text-muted">{c.common.signInRequired}</p>
        ) : order ? (
          <>
            <dl className="grid grid-cols-2 gap-y-2 rounded-xl bg-bg-soft p-4 text-sm">
              <dt className="text-muted">{t.orderId}</dt>
              <dd className="truncate text-right font-mono text-xs">{order.id}</dd>
              <dt className="text-muted">{c.billing.columns.pack}</dt>
              <dd className="text-right">{c.pricing.packages[order.packageId]?.name ?? order.packageId}</dd>
              <dt className="text-muted">{c.billing.columns.amount}</dt>
              <dd className="text-right font-semibold">{formatPrice(order.amountCents, order.currency)}</dd>
            </dl>
            {order.status === 'pending' ? (
              <div className="grid gap-2">
                <button type="button" className="btn-primary" disabled={!!pending} onClick={() => complete('paid')} data-testid="mock-pay">
                  {pending === 'paid' ? <Spinner /> : null} {t.mockPay}
                </button>
                <button type="button" className="btn-ghost" disabled={!!pending} onClick={() => complete('failed')} data-testid="mock-fail">
                  {pending === 'failed' ? <Spinner /> : null} {t.mockFail}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">{c.billing.orderStatus[order.status] ?? order.status}</p>
            )}
          </>
        ) : null}
        <ErrorText code={error} />
      </div>
    </div>
  )
}
