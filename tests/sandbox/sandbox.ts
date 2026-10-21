import { expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { ORIGIN, devLogin, json, post } from '../e2e/helpers'

// 公网隧道已把支付商的 test webhook 转到本机时设为 1：用例会等 webhook 到达，并跑依赖 webhook 的退款用例
export const WEBHOOK = process.env.SANDBOX_WEBHOOK === '1'

export type OrderDetail = {
  order: { id: string; status: string; provider: string; provider_payment_id: string | null; user_credits: number }
  events: Array<{ event_id: string; event_type: string; status: string }>
  ledger: Array<{ delta: number; reason: string }>
}

export async function adminContext() {
  const admin = await playwrightRequest.newContext({ baseURL: ORIGIN })
  await devLogin(admin, 'admin@example.com')
  return admin
}

export function orderDetail(admin: APIRequestContext, orderId: string) {
  return json<OrderDetail>(admin.get(`/api/admin/orders/${orderId}`))
}

// 走真实下单接口，打开支付商收银台。收银台域名不对说明 dev server 没切到这家支付商，或连到了 live 环境
export async function openCheckout(page: Page, packageId: string, checkoutHost: string) {
  const res = await post(page.request, '/api/checkout', { packageId, locale: 'en' })
  expect(res.status(), `下单失败：检查 .dev.vars 里的凭据和 *_PRODUCTS → ${await res.text()}`).toBe(200)
  const { orderId, url } = (await res.json()) as { orderId: string; url: string }
  expect(new URL(url).host).toBe(checkoutHost)
  await page.goto(url)
  return orderId
}

// 支付商跳回本站结果页（只保留 order 参数），等订单进入预期状态
export async function expectResult(page: Page, orderId: string, status: string, timeout = 120_000) {
  await page.waitForURL(new RegExp(`/checkout/success\\?order=${orderId}`), { timeout })
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', status, { timeout })
}

// 等某个 webhook 事件写进 payment_events（查单入账的事件 ID 以 reconcile: 开头，不算）
export async function waitForWebhook(admin: APIRequestContext, orderId: string, eventType: RegExp, timeout = 180_000) {
  let detail: OrderDetail | undefined
  await expect
    .poll(
      async () => {
        detail = await orderDetail(admin, orderId)
        return detail.events.some((e) => !e.event_id.startsWith('reconcile:') && eventType.test(e.event_type))
      },
      { timeout, intervals: [3000], message: `等 ${eventType} webhook：检查隧道、webhook-proxy 和支付商后台的 webhook 地址` },
    )
    .toBe(true)
  return detail!
}

export type SandboxSubscription = {
  status: string
  planId: string
  cancelAtPeriodEnd: boolean
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
}
type SubscriptionState = { subscription: SandboxSubscription | null; canResume: boolean; canPortal: boolean }

export const subscriptionState = (request: APIRequestContext) => json<SubscriptionState>(request.get('/api/subscription'))

// 订阅状态靠 webhook 同步：等本站的订阅进入预期状态
export async function waitForSubscription(request: APIRequestContext, match: Partial<SandboxSubscription>, timeout = 180_000) {
  let state: SubscriptionState | undefined
  await expect
    .poll(
      async () => {
        state = await subscriptionState(request)
        return Object.entries(match).every(([key, value]) => state?.subscription?.[key as keyof SandboxSubscription] === value)
      },
      { timeout, intervals: [3000], message: `等订阅变成 ${JSON.stringify(match)}：检查隧道和 webhook 订阅的事件` },
    )
    .toBe(true)
  return state!
}

// 当期大约一个月：首付的周期来自支付商，不是本站推算
export function expectMonthlyPeriod(sub: SandboxSubscription) {
  const days = (Date.parse(sub.currentPeriodEnd!) - Date.parse(sub.currentPeriodStart!)) / 86400_000
  expect(days).toBeGreaterThanOrEqual(28)
  expect(days).toBeLessThanOrEqual(31.1)
}
