import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OrderStatusPill } from '#/components/order-status'
import { ErrorText, LocalLink, Spinner, formatDate } from '#/components/ui'
import { formatPrice } from '#/config/site'
import { api, errorCode, type Order } from '#/lib/api'
import { useContent, useLocale } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/dashboard/orders/$id')({
  component: OrderDetailPage,
})

// 用户自己的订单凭证：只能看到自己的订单（他人订单接口返回 404）。
// 税务发票由支付商（Merchant of Record）出具并发邮件，这里只做站内凭证，可直接打印
function OrderDetailPage() {
  const { id } = Route.useParams()
  const c = useContent()
  const b = c.billing
  const t = b.order
  const locale = useLocale()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOrder(null)
    setError(null)
    api<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`)
      .then((data) => setOrder(data.order))
      .catch((err) => setError(errorCode(err)))
  }, [id])

  const back = (
    <LocalLink to="/dashboard/billing" className="btn-ghost px-3 py-1.5 text-sm print:hidden">
      <ArrowLeft className="size-4" /> {t.back}
    </LocalLink>
  )
  if (error)
    return (
      <div className="space-y-4" data-testid="order-detail-error">
        <ErrorText code={error} />
        {back}
      </div>
    )
  if (!order) return <Spinner className="size-5" />

  const currency = order.paidCurrency ?? order.currency
  const paid = order.status === 'paid' || order.status === 'refunded'
  const rows: [string, React.ReactNode][] = [
    [t.orderId, <span className="font-mono text-xs" data-testid="order-detail-id">{order.id}</span>],
    [t.status, <OrderStatusPill order={order} />],
    [t.pack, `${c.pricing.packages[order.packageId]?.name ?? order.packageId} · ${c.nav.credits(order.credits)}`],
    [t.price, formatPrice(order.amountCents, order.currency)],
    [t.amountPaid, paid ? <span data-testid="order-detail-paid">{formatPrice(order.paidAmountCents ?? order.amountCents, currency)}</span> : '—'],
    [t.created, formatDate(order.createdAt, locale)],
    [t.paidAt, formatDate(order.paidAt, locale)],
    [t.provider, t.providers[order.provider] ?? order.provider],
  ]
  if (order.refundedAmountCents > 0)
    rows.push(
      [t.refunded, <span data-testid="order-detail-refunded">{b.refundedLine(formatPrice(order.refundedAmountCents, currency), order.refundedCredits)}</span>],
      [t.refundedAt, formatDate(order.refundedAt, locale)],
    )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">{t.title}</h2>
        <div className="flex gap-2 print:hidden">
          {back}
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => window.print()}>
            <Printer className="size-4" /> {t.print}
          </button>
        </div>
      </div>
      <div className="card p-6" data-testid="order-detail">
        <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-6 gap-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-sm text-muted">{order.provider === 'mock' ? t.mockNote : paid ? t.invoiceNote : t.unpaidNote}</p>
      <LocalLink to="/contact" className="text-sm font-medium hover:underline print:hidden">
        {t.contact}
      </LocalLink>
    </div>
  )
}
