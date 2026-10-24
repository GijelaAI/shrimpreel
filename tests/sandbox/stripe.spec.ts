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

// Stripe 沙盒（test 模式）：托管收银台 checkout.stripe.com，卡号输入框直接在页面上（不是跨域 iframe）
// 测试卡 https://docs.stripe.com/testing
const CHECKOUT_HOST = 'checkout.stripe.com'
// 付款直接进可用余额（跳过 pending），后面的退款用例不会因为余额不足挂起
const CARD_AVAILABLE = '4000000000000077'
const CARD_OK = '4242424242424242'
const CARD_DECLINED = '4000000000000002'
const starter = site.packages.find((p) => p.id === 'starter')!
const monthly = site.plans.find((p) => p.id === 'monthly')!

// 邮箱由下单时的 customer_email 预填并锁定；后台开了多种付款方式时先展开“Card”
async function payOnStripe(page: Page, card: string) {
  const cardNumber = page.locator('#cardNumber')
  const cardTab = page.getByTestId('card-accordion-item-button')
  await expect(cardNumber.or(cardTab).first()).toBeVisible({ timeout: 60_000 })
  if (await cardTab.isVisible()) await cardTab.click()
  await cardNumber.fill(card)
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Sandbox Buyer')
  const country = page.locator('#billingCountry')
  if (await country.isVisible()) await country.selectOption('US')
  const postal = page.locator('#billingPostalCode')
  if (await postal.isVisible()) await postal.fill('94105')
  // Link 的“保存信息”勾选框会要求手机号，取消掉
  const saveInfo = page.locator('#enableStripePass')
  if ((await saveInfo.isVisible()) && (await saveInfo.isChecked())) await saveInfo.uncheck()
  await page.getByTestId('hosted-payment-submit-button').click()
}

test.describe.serial('Stripe sandbox', () => {
  let admin: APIRequestContext
  let paidOrder = ''
  let buyerEmail = ''

  test.beforeAll(async () => {
    admin = await adminContext()
  })
  test.afterAll(async () => {
    await admin.dispose()
  })

  test('测试卡付款：跳回结果页显示到账，积分只入账一次，再次查单不重复入账', async ({ page }) => {
    buyerEmail = uniqueEmail('sandbox-stripe')
    await devLogin(page.request, buyerEmail)
    const before = await credits(page.request)

    paidOrder = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnStripe(page, CARD_AVAILABLE)
    // 有 webhook 时秒到；没有隧道时靠结果页第 15 秒的查单入账
    await expectResult(page, paidOrder, 'paid')
    await expect(page.getByTestId('checkout-result')).toContainText(String(starter.credits))
    expect(await credits(page.request)).toBe(before + starter.credits)

    const again = await json<{ reconcile: string; credits: number }>(post(page.request, `/api/orders/${paidOrder}/reconcile`))
    expect(again).toMatchObject({ reconcile: 'skipped', credits: before + starter.credits })

    const detail = WEBHOOK ? await waitForWebhook(admin, paidOrder, /^checkout\.session\.completed$/) : await orderDetail(admin, paidOrder)
    expect(detail.order).toMatchObject({ status: 'paid', provider: 'stripe' })
    expect(detail.order.provider_payment_id).toMatch(/^pi_/)
    // 查单和 webhook 谁先到都只入账一次：后到的记为 duplicate
    expect(detail.ledger.map((e) => e.delta)).toEqual([starter.credits])
    expect(detail.events.filter((e) => e.status === 'processed')).toHaveLength(1)
    expect(detail.events.every((e) => e.status === 'processed' || e.status === 'duplicate')).toBe(true)
    expect(await credits(page.request)).toBe(before + starter.credits)
  })

  test('拒付卡：收银台提示被拒、留在收银台，不加积分，查单不会把失败的付款当成到账', async ({ page }) => {
    await devLogin(page.request, uniqueEmail('sandbox-stripe-declined'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnStripe(page, CARD_DECLINED)
    // Stripe 拒付后不跳转，session 仍可换卡重试，所以订单保持 pending
    await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 60_000 })
    expect(new URL(page.url()).host).toBe(CHECKOUT_HOST)
    const lookup = await json<{ reconcile: string; order: { status: string } }>(post(page.request, `/api/orders/${orderId}/reconcile`))
    expect(lookup.reconcile).not.toBe('paid')
    expect(lookup.order.status).toBe('pending')
    expect((await orderDetail(admin, orderId)).ledger).toEqual([])
    expect(await credits(page.request)).toBe(before)
  })

  test('部分退款：退款 webhook 到达后按比例回收积分，订单仍是 paid；重放同一退款不重复回收', async ({ page }) => {
    test.skip(!WEBHOOK, '积分在退款 webhook 到达时才回收，需要 SANDBOX_WEBHOOK=1')
    test.skip(!paidOrder, '依赖第一个用例的付款')
    await devLogin(page.request, buyerEmail)
    const before = await credits(page.request)

    const res = await post(admin, `/api/admin/orders/${paidOrder}/refund`, { note: 'sandbox e2e partial refund', mode: 'provider', amountCents: 330 })
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toMatchObject({ requested: true })

    const detail = await waitForWebhook(admin, paidOrder, /^refund\.(created|updated)$/)
    const clawback = -Math.round((starter.credits * 330) / starter.priceCents)
    // refund.created 和 refund.updated 可能都到：同一个 re_ 只回收一次
    await page.waitForTimeout(10_000)
    const settled = await orderDetail(admin, paidOrder)
    expect(settled.ledger.map((e) => e.delta)).toEqual([starter.credits, clawback])
    expect(settled.order.status).toBe('paid')
    expect(detail.events.every((e) => e.status !== 'failed' && e.status !== 'mismatch')).toBe(true)
    expect(await credits(page.request)).toBe(before + clawback)
  })

  test('订阅：月付走真实收银台，invoice.paid 建订阅并发当月积分；取消续费和撤销同步到 Stripe，门户地址可打开，最后取消续费', async ({ page }) => {
    test.skip(!WEBHOOK, '订阅首付和状态都靠 webhook 同步，需要 SANDBOX_WEBHOOK=1')
    await devLogin(page.request, uniqueEmail('sandbox-stripe-sub'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'monthly', CHECKOUT_HOST)
    await payOnStripe(page, CARD_OK)
    await expectResult(page, orderId, 'paid')
    expect(await credits(page.request)).toBe(before + monthly.credits)

    // 首付以 invoice.paid 入账（subscription 模式的 checkout.session.completed 记为 ignored），带订阅号和本期周期
    const detail = await waitForWebhook(admin, orderId, /^invoice\.paid$/)
    expect(detail.ledger.map((e) => e.delta)).toEqual([monthly.credits])
    const { subscription: sub } = await waitForSubscription(page.request, { status: 'active', planId: 'monthly' })
    expectMonthlyPeriod(sub!)
    const { expiring } = await json<{ expiring: Array<{ credits: number; expiresAt: string }> }>(page.request.get('/api/credits/expiring'))
    expect(expiring).toEqual([{ credits: monthly.credits, expiresAt: sub!.currentPeriodEnd }])

    // 客户门户要先在 Stripe 后台保存一次配置
    const portalRes = await post(page.request, '/api/subscription/portal', { locale: 'en' })
    expect(portalRes.status(), `门户打不开：到 Stripe 后台 Settings → Billing → Customer portal 保存一次配置 → ${await portalRes.text()}`).toBe(200)
    const { url } = (await portalRes.json()) as { url: string }
    expect(new URL(url).host).toBe('billing.stripe.com')
    const portal = await page.goto(url)
    expect(portal?.status()).toBeLessThan(400)

    // 本站取消续费 → Stripe 的 cancel_at_period_end；撤销同理。随后的 customer.subscription.updated 不应把状态改回去
    const canceled = await json<{ subscription: SandboxSubscription }>(post(page.request, '/api/subscription/cancel', {}))
    expect(canceled.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    const resumed = await json<{ subscription: SandboxSubscription }>(post(page.request, '/api/subscription/resume', {}))
    expect(resumed.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false })

    // 收尾：取消续费，避免 test 订阅一直续费；等 webhook 回来后状态仍是到期取消
    await json(post(page.request, '/api/subscription/cancel', {}))
    await page.waitForTimeout(30_000)
    const final = await subscriptionState(page.request)
    expect(final.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    const events = (await orderDetail(admin, orderId)).events
    await test.info().attach('payment-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
    expect(events.every((e) => e.status !== 'failed' && e.status !== 'mismatch')).toBe(true)
  })
})
