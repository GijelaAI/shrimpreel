import { expect, test, type Page } from '@playwright/test'
import { ARTICLES, LOCALE_META, articlePath, site } from '../../src/config/site'
// 与 npm run seo:check 共用同一套规则
import { runSeoCheck } from '../../scripts/seo-check.mjs'
import { ORIGIN, content } from './helpers'

const { en, zh } = content

async function headSnapshot(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    canonicalCount: document.querySelectorAll('link[rel="canonical"]').length,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
      const data = JSON.parse(s.textContent ?? '{}')
      return ((data['@graph'] ?? [data]) as Array<{ '@type': string }>).map((n) => n['@type'])
    }),
  }))
}

test('SSR 输出满足 seo-check 全部 error 级规则', async ({}, testInfo) => {
  const result = await runSeoCheck({ base: ORIGIN })
  await testInfo.attach('seo-check.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  expect(result.findings.filter((f) => f.level === 'error')).toEqual([])
  // 8 个固定公开页（含 /guides）+ 每篇文章，中英各一份
  expect(result.pages.length).toBeGreaterThanOrEqual(2 * (8 + ARTICLES.length))
})

test('中英文首页水合无报错，H1/标题与 SSR 一致', async ({ page }, testInfo) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydrat|did not match/i.test(message.text())) problems.push(`${message.type()}: ${message.text()}`)
  })

  for (const [path, content] of [
    ['/', en],
    ['/zh', zh],
  ] as const) {
    await page.goto(path)
    // 生成器里的登录按钮在会话加载后才出现，可作为"已水合"的信号
    await expect(page.getByTestId('generator-sign-up')).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText(content.hero.title)
    await expect(page).toHaveTitle(content.meta.homeTitle)
    await expect(page.getByRole('heading', { level: 2, name: content.howTo.title })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: content.whatIs.title })).toBeVisible()
  }
  await testInfo.attach('home-zh', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(problems).toEqual([])
})

test('客户端路由切换后 head 同步更新（canonical 不残留上一页）', async ({ page }, testInfo) => {
  const origin = `https://${site.domain}`
  await page.goto('/')
  await expect(page.getByTestId('generator-sign-up')).toBeVisible()

  // 首页 → 文章：走 SPA 导航（不整页刷新）
  await page.evaluate(() => ((window as unknown as { __spaMarker: boolean }).__spaMarker = true))
  await page.getByRole('link', { name: en.whatIs.guide }).click()
  await expect(page).toHaveURL(new RegExp(`${articlePath('trend')}$`))
  await expect(page).toHaveTitle(`${en.articles.trend.title} | ${site.brandName}`)
  const article = await headSnapshot(page)
  expect(await page.evaluate(() => (window as unknown as { __spaMarker?: boolean }).__spaMarker)).toBe(true)
  expect(article.canonicalCount).toBe(1)
  expect(article.canonical).toBe(`${origin}${articlePath('trend')}`)
  expect(article.description).toBe(en.articles.trend.description)
  expect(article.jsonLd).toEqual(expect.arrayContaining(['Article', 'BreadcrumbList']))
  expect(article.jsonLd).not.toContain('FAQPage')

  // 面包屑回首页：首页的结构化数据恢复，文章的消失
  await page.getByRole('navigation', { name: en.common.breadcrumb }).getByRole('link', { name: en.meta.breadcrumbHome }).click()
  await expect(page).toHaveTitle(en.meta.homeTitle)
  const home = await headSnapshot(page)
  expect(home.canonicalCount).toBe(1)
  expect(home.canonical).toBe(origin)
  expect(home.jsonLd).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']))
  expect(home.jsonLd).not.toContain('Article')
  await testInfo.attach('head-after-spa', { body: JSON.stringify({ article, home }, null, 2), contentType: 'application/json' })
})

test('语言链接：SSR 中可抓取，点击后保留路径、查询参数和 hash', async ({ page, request }) => {
  const path = articlePath('howTo')
  // 不执行 JS 的 HTML 里就有指向另一语言同一页面的链接
  const html = await (await request.get(`${path}?ref=e2e`)).text()
  // HTML 属性名不区分大小写，React 输出的是 hrefLang
  expect(html).toMatch(new RegExp(`<a href="/zh${path}\\?ref=e2e" hreflang="zh"`, 'i'))

  await page.goto(`${path}?ref=e2e#step-2`)
  await expect(page.getByTestId('nav-sign-in')).toBeVisible()

  // 顶部下拉：Esc 关闭
  const header = page.getByRole('banner')
  await header.getByRole('button', { name: en.nav.language }).click()
  await expect(header.getByRole('link', { name: LOCALE_META.zh.name })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(header.getByRole('link', { name: LOCALE_META.zh.name })).toHaveCount(0)

  await page.getByRole('contentinfo').getByRole('navigation', { name: en.nav.language }).getByRole('link', { name: LOCALE_META.zh.name }).click()
  await expect(page).toHaveURL(new RegExp(`/zh${path}\\?ref=e2e#step-2$`))
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('h1')).toHaveText(zh.articles.howTo.title)
})
