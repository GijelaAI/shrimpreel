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

// Dodo test 模式：test.checkout.dodopayments.com，卡表单是 Hyperswitch 的跨域 iframe
const CHECKOUT_HOST = 'test.checkout.dodopayments.com'
const CARD_OK = '4242424242424242'
const CARD_DECLINED = '4000000000000002'
const starter = site.packages.find((p) => p.id === 'starter')!
const monthly = site.plans.find((p) => p.id === 'monthly')!

// 收银台第一步要完整的美国账单地址才会显示卡表单；姓名和邮箱由下单时的 customer 预填并锁定
async function payOnDodo(page: Page, card: string) {
  await page.locator('#step1').waitFor()
  const fullName = page.locator('input[name=fullName]')
  if (await fullName.isEditable()) await fullName.fill('Sandbox Buyer')
  await page.locator('select[name=country]').selectOption('US')
  const manual = page.getByRole('button', { name: 'Enter address manually' })
  if (await manual.isVisible()) await manual.click()
  await page.locator('input[name=addressLine]').fill('100 Test Street')
  await page.locator('input[name=city]').fill('San Francisco')
  await page.locator('input[name=state]').fill('CA')
  await page.locator('input[name=zipCode]').fill('94105')
  await page.locator('#step1').click()

  const form = page.frameLocator('#dodo-checkout-iframe-payment')
  await form.getByLabel('Card number').fill(card, { timeout: 60_000 })
  await form.getByLabel('Expiry').fill('06 / 32')
  await form.getByLabel('Security code').fill('123')
  await page.locator('#submit').click()
}

test.describe.serial('Dodo sandbox', () => {
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
    buyerEmail = uniqueEmail('sandbox-dodo')
    await devLogin(page.request, buyerEmail)
    const before = await credits(page.request)

    paidOrder = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnDodo(page, CARD_OK)
    // 有 webhook 时秒到；没有隧道时靠结果页第 15 秒的查单入账
    await expectResult(page, paidOrder, 'paid')
    await expect(page.getByTestId('checkout-result')).toContainText(String(starter.credits))
    expect(await credits(page.request)).toBe(before + starter.credits)

    const again = await json<{ reconcile: string; credits: number }>(post(page.request, `/api/orders/${paidOrder}/reconcile`))
    expect(again).toMatchObject({ reconcile: 'skipped', credits: before + starter.credits })

    const detail = WEBHOOK ? await waitForWebhook(admin, paidOrder, /^payment\.succeeded$/) : await orderDetail(admin, paidOrder)
    expect(detail.order).toMatchObject({ status: 'paid', provider: 'dodo' })
    expect(detail.order.provider_payment_id).toMatch(/^pay_/)
    // 查单和 webhook 谁先到都只入账一次：后到的记为 duplicate
    expect(detail.ledger.map((e) => e.delta)).toEqual([starter.credits])
    expect(detail.events.filter((e) => e.status === 'processed')).toHaveLength(1)
    expect(detail.events.every((e) => e.status === 'processed' || e.status === 'duplicate')).toBe(true)
    expect(await credits(page.request)).toBe(before + starter.credits)
  })

  test('拒付卡：不加积分，查单不会把失败的付款当成到账；有 webhook 时订单转 failed', async ({ page }) => {
    await devLogin(page.request, uniqueEmail('sandbox-dodo-declined'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'starter', CHECKOUT_HOST)
    await payOnDodo(page, CARD_DECLINED)
    // Dodo 拒付后也会跳回 return_url（带 status=failed），结果页以订单状态为准
    await page.waitForURL(new RegExp(`/checkout/success\\?order=${orderId}`), { timeout: 120_000 })
    const lookup = await json<{ reconcile: string; order: { status: string } }>(post(page.request, `/api/orders/${orderId}/reconcile`))
    expect(lookup.reconcile).not.toBe('paid')
    expect(lookup.order.status).not.toBe('paid')

    if (WEBHOOK) {
      await expectResult(page, orderId, 'failed')
      const detail = await waitForWebhook(admin, orderId, /^payment\.failed$/)
      expect(detail.order.status).toBe('failed')
    } else {
      await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'pending')
      expect((await orderDetail(admin, orderId)).order.status).toBe('pending')
    }
    expect((await orderDetail(admin, orderId)).ledger).toEqual([])
    expect(await credits(page.request)).toBe(before)
  })

  test('部分退款：退款 webhook 到达后按比例回收积分，订单仍是 paid', async ({ page }) => {
    test.skip(!WEBHOOK, '积分在退款 webhook 到达时才回收，需要 SANDBOX_WEBHOOK=1')
    test.skip(!paidOrder, '依赖第一个用例的付款')
    await devLogin(page.request, buyerEmail)
    const before = await credits(page.request)

    const res = await post(admin, `/api/admin/orders/${paidOrder}/refund`, { note: 'sandbox e2e partial refund', mode: 'provider', amountCents: 330 })
    // 退款从商户钱包扣，付款后要等几分钟才入账：余额不足时 Dodo 返回 409，稍后重跑这个用例
    test.skip(res.status() === 409, `Dodo 拒绝退款（多半是 test 钱包余额还没入账）：${await res.text()}`)
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toMatchObject({ requested: true, refunded: false })

    const detail = await waitForWebhook(admin, paidOrder, /^refund\.succeeded$/)
    const clawback = -Math.round((starter.credits * 330) / starter.priceCents)
    expect(detail.ledger.map((e) => e.delta)).toEqual([starter.credits, clawback])
    expect(detail.order.status).toBe('paid')
    expect(await credits(page.request)).toBe(before + clawback)
  })

  test('订阅：月付走真实收银台，webhook 激活订阅并发当月积分；取消续费和撤销同步到 Dodo，门户地址可打开，最后取消续费', async ({ page }) => {
    test.skip(!WEBHOOK, '订阅状态靠 webhook 同步，需要 SANDBOX_WEBHOOK=1')
    await devLogin(page.request, uniqueEmail('sandbox-dodo-sub'))
    const before = await credits(page.request)

    const orderId = await openCheckout(page, 'monthly', CHECKOUT_HOST)
    await payOnDodo(page, CARD_OK)
    await expectResult(page, orderId, 'paid')
    expect(await credits(page.request)).toBe(before + monthly.credits)

    // 首付带订阅号和本期周期；积分在当期结束时作废
    const detail = await waitForWebhook(admin, orderId, /^payment\.succeeded$/)
    expect(detail.ledger.map((e) => e.delta)).toEqual([monthly.credits])
    const { subscription: sub } = await waitForSubscription(page.request, { status: 'active', planId: 'monthly' })
    expectMonthlyPeriod(sub!)
    const { expiring } = await json<{ expiring: Array<{ credits: number; expiresAt: string }> }>(page.request.get('/api/credits/expiring'))
    expect(expiring).toEqual([{ credits: monthly.credits, expiresAt: sub!.currentPeriodEnd }])

    // 门户地址按订阅的客户现取
    const { url } = await json<{ url: string }>(post(page.request, '/api/subscription/portal', { locale: 'en' }))
    expect(new URL(url).host).toMatch(/dodopayments\.com$/)
    const portal = await page.goto(url)
    expect(portal?.status()).toBeLessThan(400)

    // 本站取消续费 → Dodo 的 cancel_at_next_billing_date；撤销同理。随后的 subscription.updated webhook 不应把状态改回去
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
