import { expect, test } from '@playwright/test'
import { ORIGIN, devLogin, json, post, uniqueEmail } from './helpers'

const ADMIN_EMAIL = 'admin@example.com'

type AdminOrder = { id: string; source: string | null; medium: string | null; campaign: string | null; device: string | null }
type Reports = {
  funnel: { visits: number; signups: number; checkout: number; paid: number }
  sources: Array<{ key: string; visits: number; signups: number; orders: number }>
}

// 广告/渠道落地 → 注册 → 下单 → 付款，来源贯穿全链路；direct 回访不覆盖最近一次有来源的触达
test('来源归因：UTM 落地后 direct 回访，注册与订单仍记在原渠道，报表与 CSV 可见', async ({ page, playwright }) => {
  const campaign = `e2e-${Date.now().toString(36)}`
  const source = `e2e${Math.random().toString(36).slice(2, 8)}`
  // 配了 GA4 的站点要先同意统计 Cookie 才写 vt_attr；gtag.js 直接拦掉，不往真实媒体资源发数据
  await page.addInitScript(() => localStorage.setItem('consent.analytics', 'granted'))
  await page.route('https://www.googletagmanager.com/**', (route) => route.abort())
  const visit = page.waitForResponse((r) => r.url().endsWith('/api/t/visit') && r.request().method() === 'POST')
  await page.goto(`/?utm_source=${source}&utm_medium=launch&utm_campaign=${campaign.toUpperCase()}`)
  expect((await visit).status()).toBe(204)

  const cookie = (await page.context().cookies()).find((c) => c.name === 'vt_attr')
  expect(cookie?.sameSite).toBe('Lax')
  const stored = JSON.parse(Buffer.from(cookie!.value, 'base64url').toString())
  expect(stored.first.utm_source).toBe(source)

  // 同一会话 direct 回访：不重复上报访问，也不覆盖 last touch
  let extraVisits = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/api/t/visit')) extraVisits++
  })
  await page.goto('/pricing')
  await expect(page.getByTestId('buy-starter')).toBeVisible()
  expect(extraVisits).toBe(0)

  await devLogin(page.request, uniqueEmail('attr'))
  const { orderId } = await json<{ orderId: string }>(post(page.request, '/api/checkout', { packageId: 'starter', locale: 'en' }))
  await json(post(page.request, '/api/mock-payments/complete', { orderId, outcome: 'paid' }))

  const admin = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    await devLogin(admin, ADMIN_EMAIL)
    const { orders } = await json<{ orders: AdminOrder[] }>(admin.get(`/api/admin/orders?q=${orderId}`))
    expect(orders[0]).toMatchObject({ id: orderId, source, medium: 'launch', campaign, device: 'desktop' })

    const reports = await json<Reports>(admin.get('/api/admin/reports?days=1'))
    expect(reports.sources.find((s) => s.key === `${source} / launch`)).toMatchObject({ visits: 1, signups: 1, orders: 1 })
    expect(reports.funnel.paid).toBeGreaterThanOrEqual(1)
    expect(reports.funnel.signups).toBeGreaterThanOrEqual(reports.funnel.paid)

    const csv = await admin.get('/api/admin/orders.csv?days=1')
    expect(csv.headers()['content-type']).toContain('text/csv')
    const lines = (await csv.text()).split('\r\n')
    expect(lines[0]).toContain('source,medium,campaign')
    expect(lines.find((l) => l.startsWith(orderId))).toContain(`${source},launch,${campaign}`)
  } finally {
    await admin.dispose()
  }
})

test('后台报表页渲染漏斗与来源表；普通用户无权访问报表接口', async ({ page }) => {
  await devLogin(page.request, uniqueEmail('noadmin'))
  expect((await page.request.get('/api/admin/reports')).status()).toBe(403)
  expect((await page.request.get('/api/admin/orders.csv')).status()).toBe(403)

  await devLogin(page.request, ADMIN_EMAIL)
  await page.goto('/admin/reports')
  await expect(page.getByTestId('report-funnel')).toContainText('完成付款')
  await expect(page.getByTestId('report-sources')).toBeVisible()
  await expect(page.getByTestId('orders-csv')).toHaveAttribute('href', '/api/admin/orders.csv?days=30')
})

// 经 cloudflared 等隧道暴露本地服务时，请求带 cf-connecting-ip；ngrok 改写 Host 为 localhost 时仍带 x-forwarded-for：
// 两种情况下 dev 登录和 mock 支付都必须不可用
test('dev 登录与 mock 支付只接受本机直连', async ({ request }) => {
  const viaTunnel = await request.post('/api/auth/dev-login', {
    data: { email: uniqueEmail('tunnel') },
    headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7' },
  })
  expect(viaTunnel.status()).toBe(404)
  const viaProxy = await request.post('/api/auth/dev-login', {
    data: { email: uniqueEmail('proxy') },
    headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' },
  })
  expect(viaProxy.status()).toBe(404)

  await devLogin(request, uniqueEmail('local'))
  const { orderId } = await json<{ orderId: string }>(post(request, '/api/checkout', { packageId: 'starter', locale: 'en' }))
  const mock = await request.post('/api/mock-payments/complete', {
    data: { orderId, outcome: 'paid' },
    headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7' },
  })
  expect(mock.status()).toBe(404)
})
