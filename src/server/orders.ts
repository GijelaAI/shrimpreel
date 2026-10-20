import { clawbackStatements, ledgerStatements } from './credits'
import { notifyOrderPaid } from './notifications'
import type { PaymentEvent, PaymentProviderId } from './payments/types'
import type { OrderRow } from './types'
import { ApiError, createId, isUniqueConstraintError, nowIso } from './util'

export type FulfillmentResult = { status: 'processed' | 'duplicate' | 'ignored'; orderId: string | null; note?: string }

// 处理归一化后的支付事件。幂等性两层保证：
// 1) payment_events(provider, event_id) 唯一：同一事件重放直接返回 duplicate
// 2) credit_ledger.idempotency_key：order:<id> / order_refund:<id>，即使事件 id 不同也不会重复加/扣积分
export async function processPaymentEvent(
  env: Env,
  provider: PaymentProviderId,
  event: PaymentEvent,
  rawPayload: string,
): Promise<FulfillmentResult> {
  const db = env.DB
  const seen = await db
    .prepare('SELECT status FROM payment_events WHERE provider = ? AND event_id = ?')
    .bind(provider, event.eventId)
    .first<{ status: string }>()
  if (seen && seen.status !== 'failed') return { status: 'duplicate', orderId: null }

  let result: FulfillmentResult
  try {
    result = await applyEvent(db, provider, event)
  } catch (error) {
    await recordEvent(db, provider, event, null, 'failed', error instanceof Error ? error.message : String(error), rawPayload)
    throw error
  }
  await recordEvent(
    db,
    provider,
    event,
    result.orderId,
    result.status === 'ignored' ? 'ignored' : 'processed',
    result.note ?? null,
    rawPayload,
  )
  if (event.kind === 'paid' && result.status === 'processed' && result.orderId) await notifyOrderPaid(env, result.orderId)
  return result
}

async function applyEvent(db: D1Database, provider: PaymentProviderId, event: PaymentEvent): Promise<FulfillmentResult> {
  if (event.kind === 'ignored') return { status: 'ignored', orderId: null, note: 'unhandled event type' }

  const order = await findOrder(db, provider, event)
  if (!order) return { status: 'ignored', orderId: null, note: 'order not found' }

  if (event.kind === 'paid') {
    if (order.status === 'paid' || order.status === 'refunded') return { status: 'duplicate', orderId: order.id }
    const now = nowIso()
    try {
      await db.batch([
        ...ledgerStatements(db, {
          userId: order.user_id,
          delta: order.credits,
          reason: 'purchase',
          refId: order.id,
          idempotencyKey: `order:${order.id}`,
        }),
        db
          .prepare(
            `UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ?,
             provider_order_id = COALESCE(?, provider_order_id), provider_payment_id = COALESCE(?, provider_payment_id),
             paid_amount = ?, paid_currency = ?, paid_amount_cents = ? WHERE id = ?`,
          )
          .bind(
            now,
            now,
            event.providerOrderId,
            event.providerPaymentId,
            event.paidAmount,
            event.paidCurrency,
            event.paidAmountCents,
            order.id,
          ),
      ])
    } catch (error) {
      if (isUniqueConstraintError(error)) return { status: 'duplicate', orderId: order.id }
      throw error
    }
    return { status: 'processed', orderId: order.id }
  }

  if (event.kind === 'refunded') {
    const refunded = await refundOrder(db, order, {
      refundKey: event.refundId ?? event.eventId,
      amountCents: event.refundAmountCents,
      originalAmountCents: event.originalAmountCents,
      note: 'provider refund',
    })
    return { status: refunded ? 'processed' : 'duplicate', orderId: order.id }
  }

  // failed：只把仍在 pending 的订单标记失败
  await db
    .prepare(`UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(nowIso(), order.id)
    .run()
  return { status: 'processed', orderId: order.id }
}

export interface RefundInput {
  refundKey: string // 同一笔退款重试时不变（支付商 refund id）
  amountCents: number | null // null = 全额退剩余部分
  originalAmountCents?: number | null
  note: string
}

// 按退款金额占实收金额的比例回收积分（最多扣到 0），累计退满后订单置为 refunded，否则保持 paid。
// 返回 false 表示订单不可退或这笔退款已处理过。
export async function refundOrder(db: D1Database, order: OrderRow, refund: RefundInput) {
  const plan = planRefund(order, refund)
  if (!plan) return false
  const now = nowIso()
  try {
    await db.batch([
      ...clawbackStatements(db, {
        userId: order.user_id,
        maxAmount: plan.credits,
        reason: 'order_refund',
        refId: order.id,
        idempotencyKey: `order_refund:${order.id}:${refund.refundKey}`,
        note: plan.full ? refund.note : `${refund.note} (partial ${plan.amountCents}/${plan.paidCents})`,
      }),
      db
        .prepare(
          `UPDATE orders SET refunded_credits = refunded_credits + ?, refunded_amount_cents = refunded_amount_cents + ?,
           status = ?, refunded_at = ?, updated_at = ? WHERE id = ? AND status = 'paid'`,
        )
        .bind(plan.credits, plan.amountCents, plan.full ? 'refunded' : 'paid', now, now, order.id),
    ])
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
  return true
}

// 后台"仅记账"退款的幂等键（与退款 webhook 共用 order_refund:<orderId>:<key>）：
// - mock 订单没有退款单号，由当前已退金额派生：并发连点拿到同一个键不会重复扣，下一笔部分退款又能拿到新键
// - 真实支付商订单必须填支付商退款单号（Dodo refund_id / Waffo REF_），webhook 迟到时不会重复回收积分
// - Waffo 的 webhook 用 REF_ 退款单号；误填 TKT_ 工单号会和迟到的 webhook 各扣一次
export function localRefundKey(order: Pick<OrderRow, 'provider' | 'refunded_amount_cents'>, refundId: string | undefined, amountCents: number) {
  const id = refundId?.trim()
  if (order.provider === 'mock') return id || `admin:${order.refunded_amount_cents}:${amountCents}`
  if (!id) throw new ApiError(400, 'refund_id_required')
  if (order.provider === 'waffo' && !id.startsWith('REF_')) throw new ApiError(400, 'invalid_refund_id')
  return id
}

// 支付商退款规则，超出后 API 直接拒绝；提前拦截给出明确错误码：
// - Waffo：支付后 14 天内，每笔支付只能有一次退款（可部分），第二次返回 409。已退过还要再退只能线下处理，再用"仅记账"补登
// - Dodo：支付后 30 天内，可多次部分退款（同一时间只能有一笔处理中）https://docs.dodopayments.com/features/transactions/refunds
const REFUND_WINDOW_DAYS: Record<string, number> = { waffo: 14, dodo: 30 }
export function assertProviderRefundAllowed(order: Pick<OrderRow, 'provider' | 'refunded_amount_cents' | 'paid_at'>, now = Date.now()) {
  if (order.provider === 'waffo' && order.refunded_amount_cents > 0) throw new ApiError(409, 'waffo_refund_exists')
  const days = REFUND_WINDOW_DAYS[order.provider]
  if (days && order.paid_at && now - Date.parse(order.paid_at) > days * 86400_000) throw new ApiError(409, 'refund_window_expired')
}

type RefundableOrder = Pick<
  OrderRow,
  'status' | 'credits' | 'amount_cents' | 'paid_amount_cents' | 'refunded_amount_cents' | 'refunded_credits'
>

export function planRefund(order: RefundableOrder, refund: Pick<RefundInput, 'amountCents' | 'originalAmountCents'>) {
  if (order.status !== 'paid') return null
  const paidCents = refund.originalAmountCents || order.paid_amount_cents || order.amount_cents
  const remainingCredits = order.credits - order.refunded_credits
  const remainingCents = Math.max(0, paidCents - order.refunded_amount_cents)
  const full = refund.amountCents === null || refund.amountCents >= remainingCents || paidCents <= 0
  // 全额时退款金额封顶到剩余实收，避免净收入被记成负数
  if (full) return { full, paidCents, credits: remainingCredits, amountCents: remainingCents }
  const credits = Math.min(remainingCredits, Math.round((order.credits * refund.amountCents!) / paidCents))
  return { full, paidCents, credits, amountCents: refund.amountCents! }
}

async function findOrder(db: D1Database, provider: PaymentProviderId, event: Exclude<PaymentEvent, { kind: 'ignored' }>) {
  if (event.orderId) {
    const order = await db
      .prepare('SELECT * FROM orders WHERE id = ? AND provider = ?')
      .bind(event.orderId, provider)
      .first<OrderRow>()
    if (order) return order
  }
  if ('providerPaymentId' in event && event.providerPaymentId) {
    const order = await db
      .prepare('SELECT * FROM orders WHERE provider = ? AND provider_payment_id = ?')
      .bind(provider, event.providerPaymentId)
      .first<OrderRow>()
    if (order) return order
  }
  if (event.kind === 'paid' && event.providerOrderId) {
    return db
      .prepare('SELECT * FROM orders WHERE provider = ? AND (provider_session_id = ? OR provider_order_id = ?)')
      .bind(provider, event.providerOrderId, event.providerOrderId)
      .first<OrderRow>()
  }
  return null
}

async function recordEvent(
  db: D1Database,
  provider: PaymentProviderId,
  event: PaymentEvent,
  orderId: string | null,
  status: 'processed' | 'ignored' | 'failed',
  error: string | null,
  payload: string,
) {
  await db
    .prepare(
      `INSERT INTO payment_events (id, provider, event_id, event_type, order_id, status, error, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider, event_id) DO UPDATE SET status = excluded.status, error = excluded.error, order_id = excluded.order_id`,
    )
    .bind(createId('pev'), provider, event.eventId, event.eventType, orderId, status, error, payload.slice(0, 20000), nowIso())
    .run()
}
