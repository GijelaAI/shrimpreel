// Dodo Payments（Merchant of Record）。Checkout Sessions API + Standard Webhooks 签名。
// 文档：https://docs.dodopayments.com/developer-resources/checkout-session
//       https://docs.dodopayments.com/developer-resources/webhooks
import { ApiError, base64Decode, base64Encode, cleanSecret, constantTimeEqual, hmacSha256, parseJsonRecord } from '../util'
import { minorToDisplay } from './amount'
import type { CheckoutInput, CheckoutResult, PaymentEvent, PaymentProvider, RefundRequest, RefundRequestResult } from './types'
import { WebhookVerificationError } from './types'

export function createDodoProvider(env: Env): PaymentProvider {
  const apiKey = cleanSecret(env.DODO_API_KEY)
  const products = parseJsonRecord(env.DODO_PRODUCTS)
  const baseUrl = env.DODO_ENVIRONMENT === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com'
  return {
    id: 'dodo',
    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      if (!apiKey) throw new ApiError(503, 'payment_not_configured', 'DODO_API_KEY missing')
      const productId = products[input.order.packageId]
      if (!productId) throw new ApiError(503, 'payment_not_configured', `No Dodo product for ${input.order.packageId}`)
      const response = await fetch(`${baseUrl}/checkouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_cart: [{ product_id: productId, quantity: 1 }],
          customer: { email: input.user.email, name: input.user.name ?? input.user.email },
          return_url: input.successUrl,
          metadata: { orderId: input.order.id, userId: input.user.id, packageId: input.order.packageId },
        }),
      })
      const body = (await response.json().catch(() => null)) as { session_id?: string; checkout_url?: string } | null
      if (!response.ok || !body?.checkout_url) {
        throw new ApiError(502, 'payment_provider_error', `Dodo checkout failed (HTTP ${response.status})`)
      }
      return { url: body.checkout_url, sessionId: body.session_id ?? null }
    },
    // 部分退款按商品行传 amount（Dodo 规定单位固定为 USD 美分，与支付币种无关）；同一笔支付同时只能有一笔退款在处理。
    // 退款从商户钱包余额扣（支付入账时已扣手续费），余额不足直接拒绝，所以全额退款往往需要账上有其他收入
    // https://docs.dodopayments.com/api-reference/refunds/post-refunds
    // https://docs.dodopayments.com/features/transactions/refunds#when-your-balance-cant-cover-a-refund
    async refund(input: RefundRequest): Promise<RefundRequestResult> {
      if (!apiKey) throw new ApiError(503, 'payment_not_configured', 'DODO_API_KEY missing')
      const productId = products[input.packageId]
      if (!input.fullAmount && (!productId || input.currency !== 'USD')) {
        throw new ApiError(409, 'partial_refund_unsupported', 'Dodo partial refunds need a USD product mapping')
      }
      const response = await fetch(`${baseUrl}/refunds`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: input.providerPaymentId,
          reason: input.reason,
          metadata: { orderId: input.orderId },
          ...(input.fullAmount ? {} : { items: [{ item_id: productId, amount: input.amountCents, tax_inclusive: true }] }),
        }),
      })
      const body = (await response.json().catch(() => null)) as { refund_id?: string; status?: string; message?: string } | null
      // 409 是业务冲突，原样透传给后台。实测（test 模式）：钱包余额不足时返回 "Insufficient funds in wallet"
      if (response.status === 409) throw new ApiError(409, 'payment_provider_conflict', `Dodo refund: ${body?.message ?? 'conflict'}`)
      if (!response.ok) {
        throw new ApiError(502, 'payment_provider_error', `Dodo refund failed (HTTP ${response.status}): ${body?.message ?? ''}`.trim())
      }
      return { refundId: body?.refund_id ?? null, status: body?.status ?? 'pending' }
    },
  }
}

const TOLERANCE_SECONDS = 5 * 60

export async function verifyDodoWebhook(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
  nowMs = Date.now(),
): Promise<Record<string, unknown>> {
  const cleaned = cleanSecret(secret)
  if (!cleaned) throw new WebhookVerificationError('DODO_WEBHOOK_SECRET missing')
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) throw new WebhookVerificationError('missing webhook headers')
  const age = Math.floor(nowMs / 1000) - Number(timestamp)
  if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) throw new WebhookVerificationError('timestamp outside tolerance')
  const key = base64Decode(cleaned.startsWith('whsec_') ? cleaned.slice(6) : cleaned)
  const expected = base64Encode(await hmacSha256(key, `${id}.${timestamp}.${rawBody}`))
  const matched = signatureHeader
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, signature]) => version === 'v1' && !!signature && constantTimeEqual(signature, expected))
  if (!matched) throw new WebhookVerificationError('invalid signature')
  const payload = JSON.parse(rawBody) as Record<string, unknown>
  // Standard Webhooks 的 webhook-id 对同一事件的重试保持不变，用作幂等键
  return { ...payload, __webhookId: id }
}

export function normalizeDodoEvent(payload: Record<string, unknown>): PaymentEvent {
  const eventType = String(payload.type ?? '')
  const eventId = String(payload.__webhookId ?? '')
  const data = (payload.data ?? {}) as Record<string, unknown>
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  const orderId = str(metadata.orderId)
  const currency = str(data.currency)
  // Dodo 金额是最小货币单位的整数（total_amount、refund.amount）
  switch (eventType) {
    case 'payment.succeeded': {
      const cents = int(data.total_amount)
      return {
        kind: 'paid',
        eventId,
        eventType,
        orderId,
        providerOrderId: str(data.checkout_session_id),
        providerPaymentId: str(data.payment_id),
        paidAmount: cents !== null && currency ? minorToDisplay(cents, currency) : str(data.total_amount),
        paidCurrency: currency,
        paidAmountCents: cents,
      }
    }
    case 'payment.failed':
    case 'payment.cancelled':
      return { kind: 'failed', eventId, eventType, orderId }
    case 'refund.succeeded':
      // 退款对象自带 metadata（通常为空），订单靠 payment_id 反查；is_partial=false 视为全额
      return {
        kind: 'refunded',
        eventId,
        eventType,
        orderId,
        providerPaymentId: str(data.payment_id),
        refundId: str(data.refund_id),
        refundAmountCents: data.is_partial === true ? int(data.amount) : null,
        originalAmountCents: null,
      }
    default:
      return { kind: 'ignored', eventId, eventType }
  }
}

function str(value: unknown) {
  return typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null
}

function int(value: unknown) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value ? Number(value) : NaN
  return Number.isInteger(n) ? n : null
}
