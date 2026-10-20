import { expect, test } from '@playwright/test'
import { buyPackage, credits, devLogin, json, ledger, post, uniqueEmail, uploadPhoto } from './helpers'

type Result = { status: 'processed' | 'duplicate' | 'ignored' }

test('并发、重放、退款后迟到的支付事件：积分只入账一次、只回收一次', async ({ request }) => {
  await devLogin(request, uniqueEmail('idem'))
  const { orderId } = await json<{ orderId: string }>(post(request, '/api/checkout', { packageId: 'party', locale: 'en' }))
  // 事件 id 在 provider 内全局唯一（与真实支付商一致），按订单加前缀，避免多次运行之间互相命中
  const complete = (outcome: string, eventId: string) =>
    json<Result>(post(request, '/api/mock-payments/complete', { orderId, outcome, eventId: `${orderId}_${eventId}` }))

  // 支付商重试：5 个不同 event id 的 paid 事件同时到达
  const results = await Promise.all([0, 1, 2, 3, 4].map((i) => complete('paid', `evt_paid_${i}`)))
  expect(results.filter((r) => r.status === 'processed')).toHaveLength(1)
  expect(await credits(request)).toBe(60)

  // 同一事件原样重放
  expect((await complete('paid', 'evt_paid_0')).status).toBe('duplicate')

  expect((await complete('refunded', 'evt_refund_1')).status).toBe('processed')
  expect(await credits(request)).toBe(0)
  expect((await complete('refunded', 'evt_refund_2')).status).toBe('duplicate')

  // 退款之后又来一条迟到的 paid：订单不能被“复活”
  expect((await complete('paid', 'evt_paid_late')).status).toBe('duplicate')
  expect(await credits(request)).toBe(0)

  const { order } = await json<{ order: { status: string } }>(request.get(`/api/orders/${orderId}`))
  expect(order.status).toBe('refunded')
  const entries = await ledger(request)
  expect(entries.map((e) => [e.reason, e.delta]).sort()).toEqual([
    ['order_refund', -60],
    ['purchase', 60],
  ])
})

test('积分已部分消费后退款：最多扣到 0，流水记录实际扣除量', async ({ request }) => {
  await devLogin(request, uniqueEmail('clawback'))
  const orderId = await buyPackage(request, 'starter')
  const { upload } = await json<{ upload: { id: string } }>(uploadPhoto(request), 201)
  await json(post(request, '/api/generations', { uploadId: upload.id, durationId: 'short' }), 201)
  expect(await credits(request)).toBe(14)

  await json(post(request, '/api/mock-payments/complete', { orderId, outcome: 'refunded' }))
  expect(await credits(request)).toBe(0)
  const refund = (await ledger(request)).find((e) => e.reason === 'order_refund')
  expect(refund?.delta).toBe(-14)
})

test('两次部分退款：按金额比例回收积分，重放幂等，累计退满后订单转 refunded', async ({ page }) => {
  await devLogin(page.request, uniqueEmail('partial'))
  const orderId = await buyPackage(page.request, 'party') // 60 积分 / $19.90
  const refund = (eventId: string, amountCents: number) =>
    json<Result>(post(page.request, '/api/mock-payments/complete', { orderId, outcome: 'refunded', eventId: `${orderId}_${eventId}`, amountCents }))

  expect((await refund('rf_1', 500)).status).toBe('processed')
  expect(await credits(page.request)).toBe(45) // round(60 × 500 / 1990) = 15
  expect((await refund('rf_1', 500)).status).toBe('duplicate')
  expect(await credits(page.request)).toBe(45)

  type OrderView = { status: string; refundedAmountCents: number; refundedCredits: number }
  let { order } = await json<{ order: OrderView }>(page.request.get(`/api/orders/${orderId}`))
  expect(order).toMatchObject({ status: 'paid', refundedAmountCents: 500, refundedCredits: 15 })
  await page.goto('/dashboard/billing')
  await expect(page.getByTestId('orders-table')).toContainText('Partially refunded')

  // 第二笔退款超过剩余金额：按全额处理，只回收剩余积分
  expect((await refund('rf_2', 5000)).status).toBe('processed')
  expect(await credits(page.request)).toBe(0)
  ;({ order } = await json<{ order: OrderView }>(page.request.get(`/api/orders/${orderId}`)))
  expect(order).toMatchObject({ status: 'refunded', refundedAmountCents: 1990, refundedCredits: 60 })
  expect((await refund('rf_3', 100)).status).toBe('duplicate')

  const refunds = (await ledger(page.request)).filter((e) => e.reason === 'order_refund').map((e) => e.delta)
  expect(refunds.sort((a, b) => a - b)).toEqual([-45, -15])
})

test('支付失败：结果页显示失败，订单 failed，余额不变', async ({ page }) => {
  await devLogin(page.request, uniqueEmail('fail'))
  await page.goto('/pricing')
  await page.getByTestId('buy-starter').click()
  await page.getByTestId('mock-fail').click()
  await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-status', 'failed')
  expect(await credits(page.request)).toBe(0)
})

test('未登录回到结果页：提示登录，不无限转圈；支付商回跳带的邮箱从地址栏移除', async ({ page }) => {
  await page.goto('/checkout/success?order=ord_signed_out&email=buyer%40example.com&status=succeeded')
  await expect(page.getByTestId('checkout-result')).toContainText('Please sign in to continue.')
  await expect(page).toHaveURL(/\/checkout\/success\?order=ord_signed_out$/)
})

test('未带同源 Origin 的写请求被 CSRF 校验拒绝', async ({ request }) => {
  const response = await request.post('/api/auth/dev-login', { data: { email: uniqueEmail('csrf') } })
  expect(response.status()).toBe(403)
  const cross = await request.post('/api/auth/dev-login', { data: { email: uniqueEmail('csrf') }, headers: { origin: 'https://evil.example' } })
  expect(cross.status()).toBe(403)
})
