import { expect, test } from '@playwright/test'
import { ORIGIN, content, credits, devLogin, json, ledger, post, uniqueEmail } from './helpers'

type CodeRow = { code: string; used_count: number; max_uses: number; disabled_at: string | null }

const ADMIN_EMAIL = 'admin@example.com'
const raw = (display: string) => display.replace(/-/g, '')

// 兑换码全流程：后台生成一批并导出 CSV、停用其中一个；用户在设置页兑换（积分带有效期），重复兑换和停用的码被拒绝
test('兑换码：后台生成批次并导出 CSV，用户在设置页兑换，重复、用完、停用、非管理员都被拒绝', async ({ page, playwright }) => {
  const userEmail = uniqueEmail('redeem')
  const user = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    // 非管理员不能生成、查看、导出兑换码
    await devLogin(user, userEmail)
    expect((await post(user, '/api/admin/redeem-codes', { credits: 100, note: 'self', count: 1 })).status()).toBe(403)
    expect((await user.get('/api/admin/redeem-codes')).status()).toBe(403)
    expect((await user.get('/api/admin/redeem-codes.csv')).status()).toBe(403)

    // 后台生成 3 个：每个 7 积分、可用 1 次、积分 30 天有效
    await devLogin(page.request, ADMIN_EMAIL)
    page.on('dialog', (dialog) => dialog.accept())
    await page.goto('/admin/redeem-codes')
    await page.getByTestId('redeem-credits').fill('7')
    await page.getByTestId('redeem-count').fill('3')
    await page.getByTestId('redeem-valid-days').fill('30')
    const note = `e2e 渠道 ${Date.now()}`
    await page.getByTestId('redeem-note').fill(note)
    await page.getByTestId('redeem-submit').click()
    await expect(page.getByTestId('redeem-created')).toContainText('已生成 3 个兑换码')
    const codes = (await page.getByTestId('redeem-created-codes').inputValue()).split('\n')
    expect(codes).toHaveLength(3)
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    await expect(page.getByTestId('admin-redeem-row')).toHaveCount(3)

    // 导出本批 CSV：BOM + 表头 + 3 行，码按展示格式
    const href = await page.getByTestId('redeem-csv').getAttribute('href')
    const csv = await page.request.get(href!)
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    const text = await csv.text()
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe('code,batch_id,credits,max_uses,used_count,credit_valid_days,expires_at,note,disabled_at,created_at')
    expect(lines.slice(1).map((line) => line.split(',')[0]).sort()).toEqual([...codes].sort())
    expect(lines[1]).toContain(`,7,1,0,30,,${note},`)

    // 停用第 3 个
    const disabled = codes[2]!
    await page.locator(`[data-code="${raw(disabled)}"]`).getByTestId('redeem-disable').click()
    await expect(page.locator(`[data-code="${raw(disabled)}"]`)).toContainText('已停用')

    // 用户在设置页兑换第 1 个（小写、去掉横线也可以）
    await devLogin(page.request, userEmail)
    await page.goto('/dashboard/settings')
    await page.getByTestId('redeem-code').fill(raw(codes[0]!).toLowerCase())
    await page.getByTestId('redeem-submit').click()
    await expect(page.getByTestId('redeem-success')).toContainText('Added 7 credits, valid until')
    expect(await credits(user)).toBe(7)
    const expiring = await json<{ expiring: Array<{ credits: number; expiresAt: string }> }>(user.get('/api/credits/expiring'))
    expect(expiring.expiring).toHaveLength(1)
    expect(expiring.expiring[0]!.credits).toBe(7)
    const days = (Date.parse(expiring.expiring[0]!.expiresAt) - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)
    expect((await ledger(user)).map((e) => [e.reason, e.delta, e.ref_id])).toEqual([['redeem', 7, raw(codes[0]!)]])

    // 同一个码再兑换：409 already_redeemed，页面显示对应文案
    await page.getByTestId('redeem-code').fill(codes[0]!)
    await page.getByTestId('redeem-submit').click()
    await expect(page.getByText(content.en.errors.already_redeemed!)).toBeVisible()
    expect(await credits(user)).toBe(7)

    // 别人兑换已用完的码、停用的码、格式不对的码
    const other = await playwright.request.newContext({ baseURL: ORIGIN })
    try {
      await devLogin(other, uniqueEmail('redeem-other'))
      expect(await json(post(other, '/api/redeem', { code: codes[0] }), 409)).toMatchObject({ error: 'code_used_up' })
      expect(await json(post(other, '/api/redeem', { code: disabled }), 400)).toMatchObject({ error: 'invalid_code' })
      expect(await json(post(other, '/api/redeem', { code: 'no' }), 400)).toMatchObject({ error: 'invalid_code' })
      expect(await json(post(other, '/api/redeem', { code: 'NOSUCHCODE99' }), 400)).toMatchObject({ error: 'invalid_code' })
      expect(await credits(other)).toBe(0)
    } finally {
      await other.dispose()
    }

    // 账单页流水显示“兑换码”
    await page.goto('/dashboard/billing')
    await expect(page.getByTestId('ledger-table')).toContainText(content.en.billing.reasons.redeem!)
  } finally {
    await user.dispose()
  }
})

// 活动码：一个码多人可用，并发兑换不超出次数，每人只到账一次
test('活动码：指定码可被多人兑换，并发兑换不超出次数', async ({ request, playwright }) => {
  await devLogin(request, ADMIN_EMAIL)
  const code = `E2E${Date.now().toString(36).toUpperCase()}`
  const created = await json<{ batchId: string; codes: string[] }>(
    post(request, '/api/admin/redeem-codes', { credits: 2, maxUses: 3, note: 'e2e 活动码', code: code.toLowerCase() }),
    201,
  )
  expect(created.codes).toEqual([code])
  expect(await json(post(request, '/api/admin/redeem-codes', { credits: 2, note: 'dup', code }), 409)).toMatchObject({ error: 'code_exists' })
  expect(await json(post(request, '/api/admin/redeem-codes', { credits: 2, note: 'x', code: 'OTHER1234', count: 2 }), 400)).toMatchObject({
    error: 'invalid_count',
  })
  expect(await json(post(request, '/api/admin/redeem-codes', { credits: 2, note: 'x', count: 1001 }), 400)).toMatchObject({ error: 'invalid_count' })
  expect(await json(post(request, '/api/admin/redeem-codes', { credits: 2, note: '' }), 400)).toMatchObject({ error: 'note_required' })

  const users = await Promise.all(Array.from({ length: 5 }, () => playwright.request.newContext({ baseURL: ORIGIN })))
  try {
    for (const [i, ctx] of users.entries()) await devLogin(ctx, uniqueEmail(`promo${i}`))
    const results = await Promise.all(users.map((ctx) => post(ctx, '/api/redeem', { code })))
    expect(results.map((r) => r.status()).sort()).toEqual([200, 200, 200, 409, 409])
    for (const res of results.filter((r) => r.status() === 409)) expect(await res.json()).toMatchObject({ error: 'code_used_up' })
    expect((await Promise.all(users.map(credits))).sort()).toEqual([0, 0, 2, 2, 2])
  } finally {
    await Promise.all(users.map((ctx) => ctx.dispose()))
  }

  const list = await json<{ codes: CodeRow[] }>(request.get(`/api/admin/redeem-codes?batch=${created.batchId}`))
  expect(list.codes.map((c) => [c.code, c.used_count, c.max_uses])).toEqual([[code, 3, 3]])
})
