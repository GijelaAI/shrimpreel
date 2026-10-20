export type PaymentProviderId = 'waffo' | 'dodo' | 'mock'

export interface CheckoutInput {
  order: { id: string; packageId: string; credits: number; amountCents: number; currency: string }
  user: { id: string; email: string; name: string | null }
  successUrl: string
  cancelUrl: string
}

export interface CheckoutResult {
  url: string
  sessionId: string | null
}

// 各支付商 webhook 归一化后的事件；业务处理只认这个结构（见 src/server/orders.ts）
export type PaymentEvent =
  | {
      kind: 'paid'
      eventId: string
      eventType: string
      orderId: string | null
      providerOrderId: string | null
      providerPaymentId: string | null
      paidAmount: string | null
      paidCurrency: string | null
      paidAmountCents: number | null // 实收金额，最小货币单位
    }
  | {
      kind: 'refunded'
      eventId: string
      eventType: string
      orderId: string | null
      providerPaymentId: string | null
      refundId: string | null // 同一笔退款的重试保持不变，作为积分回收的幂等键
      refundAmountCents: number | null // null = 全额
      originalAmountCents: number | null // 退款事件里带的原始实收金额（与 refundAmountCents 同币种）
    }
  | { kind: 'failed'; eventId: string; eventType: string; orderId: string | null }
  | { kind: 'ignored'; eventId: string; eventType: string }

// 向支付商发起退款。只负责“提交”，积分回收与订单状态以之后的退款 webhook 为准（幂等）。
export interface RefundRequest {
  orderId: string
  packageId: string
  providerPaymentId: string
  amountCents: number // 本次退款金额（最小货币单位），已由调用方校验 ≤ 剩余可退
  fullAmount: boolean // 是否退满剩余全部金额
  currency: string
  reason: string
}

export interface RefundRequestResult {
  // 与退款 webhook 的幂等键一致的退款单号（Dodo 提交即返回；Waffo 要等 PSP 处理完才生成 REF_，此处为 null）
  refundId: string | null
  // Waffo 退款工单号 TKT_，只用于在支付商后台追踪，不能当作"仅记账"的退款单号
  ticketId?: string | null
  status: string
}

export interface PaymentProvider {
  id: PaymentProviderId
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>
  refund?(input: RefundRequest): Promise<RefundRequestResult>
}

export class WebhookVerificationError extends Error {}
