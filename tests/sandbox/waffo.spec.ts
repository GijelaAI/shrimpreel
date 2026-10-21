import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { site } from '../../src/config/site'
import { credits, devLogin, json, post, uniqueEmail } from '../e2e/helpers'
import {
  WEBHOOK,
  adminContext,
  expectMonthlyPeriod,
  expectResult,
  openCheckout,
  orderDetail,
  subscriptionState,
  waitForSubscription,
  waitForWebhook,
  type SandboxSubscription,
} from './sandbox'

// Waffo test 模式：先到 pancake.waffo.ai 填邮箱和国家，再跳到 Waffo 收银台（顶层页面，不是 iframe）填卡
const CHECKOUT_HOST = 'pancake.waffo.ai'
const CARD_OK = '4576750000000110'
const CARD_DECLINED = '4576750000000220'
const starter = site.packages.find((p) => p.id === 'starter')!
const monthly = site.plans.find((p) => p.id === 'monthly')!

// 退款不放进这里：Waffo 退款异步（实测 12–22 分钟才回 refund.succeeded），且每笔支付只能退一次，跑一次就废一笔订单。
// 退款按比例回收积分由 tests/unit/refunds.test.ts 和 Dodo sandbox 的部分退款用例覆盖

async function payOnWaffo(page: Page, card: string) {
  // 邮箱由下单时的 buyerEmail 预填，国家默认 United States
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\.waffo\.com\//, { timeout: 60_000 })
  const pan = page.locator('input[name="payMethodProperties.card.pan"]')
  await pan.waitFor({ timeout: 60_000 })
  // 收银台加载完之前会重新渲染：先填的卡被清空，点 Pay 也不提交。所以填完确认值还在、点完确认进入处理中，不行就重来
  await expect(async () => {
    await pan.fill(card)
    await page.locator('input[name="payMethodProperties.card.expiry"]').fill('12/30')
    await page.locator('input[name="payMethodProperties.card.cvv"]').fill('123')
    await page.locator('input[name="payMethodProperties.card.name"]').fill('Sandbox Buyer')
    await page.waitForTimeout(1000)
    await expect(pan).not.toHaveValue('', { timeout: 1000 })
    await page.locator('button[type=submit]').click()
    await expect(page.getByText(/Processing|Payment (Successful|Failed)|Subscription successful/).first()).toBeVisible({ timeout: 10_000 })
  }).toPass({ timeout: 90_000 })
}

test.describe.serial('Waffo sandbox', () => {
  let admin: APIRequestContext

  test.beforeAll(async () => {
    admin = await adminContext()
  })
  test.afterAll(async () => {
    await admin.dispose()
  })

  test('测试卡付款：点 Done 跳回结果页显示到账，积分只入账一次，再次查单不重复入账', async ({ page }) => {
    await devLogin(page.request, uniqueEmail('sandbox-waffo'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnWaffo(page, CARD_OK)
    await expect(page.getByText('Payment Successful')).toBeVisible({ timeout: 120_000 })
    // Waffo 付款成功后停在自己的结果页，点 Done 才跳回 successUrl
    await page.getByText('Done', { exact: true }).click()
    await expectResult(page, orderId, 'paid')
    await expect(page.getByTestId('checkout-result')).toContainText(String(starter.credits))
    expect(await credits(page.request)).toBe(before + starter.credits)

    const again = await json<{ reconcile: string; credits: number }>(post(page.request, `/api/orders/${orderId}/reconcile`))
    expect(again).toMatchObject({ reconcile: 'skipped', credits: before + starter.credits })

    const detail = WEBHOOK ? await waitForWebhook(admin, orderId, /^order\.completed$/) : await orderDetail(admin, orderId)
    expect(detail.order).toMatchObject({ status: 'paid', provider: 'waffo' })
    expect(detail.order.provider_payment_id).toBeTruthy()
    expect(detail.ledger.map((e) => e.delta)).toEqual([starter.credits])
    expect(detail.events.filter((e) => e.status === 'processed')).toHaveLength(1)
    expect(detail.events.every((e) => e.status === 'processed' || e.status === 'duplicate')).toBe(true)
    expect(await credits(page.request)).toBe(before + starter.credits)
  })

  test('拒付卡：Waffo 显示付款失败，查单不会把失败的付款当成到账，订单留在 pending', async ({ page }) => {
    await devLogin(page.request, uniqueEmail('sandbox-waffo-declined'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnWaffo(page, CARD_DECLINED)
    // 拒付后 Waffo 停在自己的失败页，不跳回本站；本站也不处理 Waffo 的失败事件，订单保持 pending
    await expect(page.getByText('Payment Failed')).toBeVisible({ timeout: 120_000 })
    const lookup = await json<{ reconcile: string; order: { status: string } }>(post(page.request, `/api/orders/${orderId}/reconcile`))
    expect(lookup).toMatchObject({ reconcile: 'unpaid', order: { status: 'pending' } })

    const detail = await orderDetail(admin, orderId)
    expect(detail.order.status).toBe('pending')
    expect(detail.ledger).toEqual([])
    expect(await credits(page.request)).toBe(before)
  })

  test('订阅：月付走真实收银台，webhook 激活订阅并发当月积分；门户地址可打开，取消续费后 Waffo 回 canceling', async ({ page }) => {
    test.skip(!WEBHOOK, '订阅状态靠 webhook 同步，需要 SANDBOX_WEBHOOK=1')
    await devLogin(page.request, uniqueEmail('sandbox-waffo-sub'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'monthly', CHECKOUT_HOST)
    await payOnWaffo(page, CARD_OK)
    // 订阅的成功页文案和一次性付款不同
    await expect(page.getByText('Subscription successful')).toBeVisible({ timeout: 120_000 })
    await page.getByText('Done', { exact: true }).click()
    await expectResult(page, orderId, 'paid')
    expect(await credits(page.request)).toBe(before + monthly.credits)

    // 订阅首付不发 order.completed，而是 subscription.payment_succeeded；和结果页的查单谁先到都只入账一次
    const detail = await waitForWebhook(admin, orderId, /^subscription\.payment_succeeded$/)
    expect(detail.ledger.map((e) => e.delta)).toEqual([monthly.credits])
    const state = await waitForSubscription(page.request, { status: 'active', planId: 'monthly' })
    expectMonthlyPeriod(state.subscription!)
    // Waffo 的撤销取消只接受买家 token，本站不提供撤销按钮
    expect(state.canResume).toBe(false)
    const { expiring } = await json<{ expiring: Array<{ credits: number; expiresAt: string }> }>(page.request.get('/api/credits/expiring'))
    expect(expiring).toEqual([{ credits: monthly.credits, expiresAt: state.subscription!.currentPeriodEnd }])

    // 门户 token 按 WAFFO_STORE_ID 和本站用户 ID 签发
    const { url } = await json<{ url: string }>(post(page.request, '/api/subscription/portal', { locale: 'en' }))
    expect(new URL(url).host).toMatch(/waffo\.(ai|com)$/)
    const portal = await page.goto(url)
    expect(portal?.status()).toBeLessThan(400)

    // 取消续费（同时是收尾，避免 test 订阅一直续费）：当期仍可用，等 subscription.canceling 回来状态不变
    const canceled = await json<{ subscription: SandboxSubscription }>(post(page.request, '/api/subscription/cancel', {}))
    expect(canceled.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    await waitForWebhook(admin, orderId, /^subscription\.canceling$/)
    const final = await subscriptionState(page.request)
    expect(final.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    expect(await credits(page.request)).toBe(before + monthly.credits)
    const events = (await orderDetail(admin, orderId)).events
    await test.info().attach('payment-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
    expect(events.every((e) => e.status !== 'failed' && e.status !== 'mismatch')).toBe(true)
  })
})
