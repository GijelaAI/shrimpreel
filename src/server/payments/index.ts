import { ApiError, isProduction } from '../util'
import { createDodoProvider } from './dodo'
import type { PaymentProvider, PaymentProviderId } from './types'
import { createWaffoProvider } from './waffo'

// mock：本地与 e2e 用，跳转到站内 /checkout/mock 页面模拟付款（生产环境禁止）
// 与 successUrl 保持同一语言前缀（/zh/checkout/success → /zh/checkout/mock）
function createMockProvider(): PaymentProvider {
  return {
    id: 'mock',
    async createCheckout(input) {
      const url = new URL(input.successUrl)
      url.pathname = url.pathname.replace(/\/checkout\/success$/, '/checkout/mock')
      url.search = ''
      url.searchParams.set('order', input.order.id)
      return { url: `${url.pathname}${url.search}`, sessionId: `mock_${input.order.id}` }
    },
  }
}

export function activePaymentProviderId(env: Env): PaymentProviderId {
  const id = env.PAYMENT_PROVIDER as PaymentProviderId
  if (id === 'waffo' || id === 'dodo') return id
  if (id === 'mock' && !isProduction(env)) return 'mock'
  throw new ApiError(503, 'payment_not_configured', `Unsupported PAYMENT_PROVIDER: ${env.PAYMENT_PROVIDER}`)
}

// 退款按订单所属支付商走（切换 PAYMENT_PROVIDER 后，旧订单仍向原支付商退款）；mock 没有远端退款，返回 null
export function getRefundProvider(env: Env, id: string): PaymentProvider | null {
  if (id === 'waffo') return createWaffoProvider(env)
  if (id === 'dodo') return createDodoProvider(env)
  return null
}

export function getPaymentProvider(env: Env): PaymentProvider {
  const id = activePaymentProviderId(env)
  if (id === 'waffo') return createWaffoProvider(env)
  if (id === 'dodo') return createDodoProvider(env)
  return createMockProvider()
}
