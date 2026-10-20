import { displayToMinor } from '#/server/payments/amount'
import { adminAction, money, promptNote } from './admin'

// /api/admin/orders 与 /api/admin/orders/:id 返回的订单行（orders 表 + 用户邮箱）
export type AdminOrder = {
  id: string
  user_id: string
  user_email: string
  provider: string
  package_id: string
  credits: number
  amount_cents: number
  currency: string
  status: string
  provider_order_id: string | null
  provider_payment_id: string | null
  paid_amount: string | null
  paid_currency: string | null
  paid_amount_cents: number | null
  refunded_amount_cents: number
  refunded_credits: number
  source: string | null
  medium: string | null
  campaign: string | null
  country: string | null
  device: string | null
  created_at: string
  paid_at: string | null
  refunded_at: string | null
}

export function orderStatus(o: Pick<AdminOrder, 'status' | 'refunded_amount_cents'>) {
  return o.status === 'paid' && o.refunded_amount_cents > 0 ? 'partially_refunded' : o.status
}

// provider：调用支付商退款 API 实际退钱，积分等退款 webhook 回来再回收；local：只本地记账（支付商后台已退但 webhook 丢失时用）
async function refund(order: AdminOrder, mode: 'provider' | 'local') {
  const currency = order.paid_currency ?? order.currency
  const remainingCents = Math.max(0, (order.paid_amount_cents ?? order.amount_cents) - order.refunded_amount_cents)
  const input = prompt(`退款订单 ${order.id}：退款金额（${currency}），最多 ${money(remainingCents, currency)}，留空 = 退全部剩余`, '')
  if (input === null) return false
  const amountCents = input.trim() ? displayToMinor(input, currency) : null
  if (input.trim() && (amountCents === null || amountCents <= 0 || amountCents > remainingCents)) {
    alert('退款金额无效')
    return false
  }
  const hint =
    mode === 'provider'
      ? `将调用 ${order.provider} 退款 API 实际退钱，积分在退款 webhook 到达后按金额比例回收。\nWaffo 每笔支付只能退款一次（14 天内）；Dodo 30 天内可多次部分退款，从商户钱包余额扣，余额不足会被拒。`
      : '仅本地记账并按比例回收积分，不会调用支付商（用于已在支付商后台退款但 webhook 丢失的情况）。'
  const note = promptNote(`${hint}\n请输入原因：`)
  if (!note) return false
  let refundId: string | null = null
  if (mode === 'local' && order.provider !== 'mock') {
    // 与退款 webhook 共用幂等键，webhook 迟到也不会重复回收积分
    refundId = promptNote(`请填写支付商退款单号（Waffo 为 REF_ 开头，不是 TKT_ 工单号；Dodo 为 refund_id）：`)
    if (!refundId) return false
  }
  if (!(await adminAction(`/api/admin/orders/${order.id}/refund`, { note, amountCents, mode, refundId }))) return false
  if (mode === 'provider') alert('退款已提交，订单与积分会在支付商回调后更新。')
  return true
}

async function markPaid(order: AdminOrder) {
  const note = promptNote(`补单 ${order.id}：发放 ${order.credits} 积分。\n请先在支付商后台确认已收款，并填写凭证（如支付流水号）：`)
  return Boolean(note && (await adminAction(`/api/admin/orders/${order.id}/mark-paid`, { note })))
}

// 订单列表与订单详情共用的退款 / 补单按钮；操作成功后调用 onDone 刷新
export function OrderActions({ order: o, onDone }: { order: AdminOrder; onDone: () => unknown }) {
  const run = async (action: Promise<boolean>) => {
    if (await action) await onDone()
  }
  return (
    <>
      {/* Waffo 每笔支付只能退一次，退过后只能"仅记账" */}
      {o.status === 'paid' && !(o.provider === 'waffo' && o.refunded_amount_cents > 0) ? (
        <button
          type="button"
          className="btn-ghost px-2.5 py-1 text-xs"
          onClick={() => run(refund(o, o.provider === 'mock' ? 'local' : 'provider'))}
          data-testid={`refund-${o.id}`}
        >
          退款
        </button>
      ) : null}
      {o.status === 'paid' && o.provider !== 'mock' ? (
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs text-muted" onClick={() => run(refund(o, 'local'))}>
          仅记账
        </button>
      ) : null}
      {o.status === 'pending' || o.status === 'failed' || o.status === 'canceled' ? (
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => run(markPaid(o))} data-testid={`mark-paid-${o.id}`}>
          补单
        </button>
      ) : null}
    </>
  )
}
