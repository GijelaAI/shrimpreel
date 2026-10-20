import type { Order } from '#/lib/api'
import { useContent } from '#/lib/i18n'
import { StatusPill } from './ui'

const ORDER_TONES = { pending: 'muted', paid: 'ok', partially_refunded: 'warn', failed: 'bad', refunded: 'warn', canceled: 'muted' } as const

function displayStatus(o: Order) {
  return o.status === 'paid' && o.refundedAmountCents > 0 ? 'partially_refunded' : o.status
}

export function OrderStatusPill({ order }: { order: Order }) {
  const b = useContent().billing
  const status = displayStatus(order)
  return <StatusPill tone={ORDER_TONES[status]}>{b.orderStatus[status] ?? order.status}</StatusPill>
}
