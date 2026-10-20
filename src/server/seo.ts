import { Hono } from 'hono'
import { ARTICLES, DEFAULT_LOCALE, LOCALES, localePath, site } from '#/config/site'
import { absoluteUrl } from '#/lib/i18n'
import type { AppContext } from './types'
import { isIndexable } from './util'

export const seoRoutes = new Hono<AppContext>()

// IndexNow 验证文件：site.seo.indexNowKey 非空时在 /<key>.txt 返回 key 本身（npm run seo:indexnow 用它提交 URL）
const INDEXNOW_PATH = site.seo.indexNowKey ? `/${site.seo.indexNowKey}.txt` : null

// server.ts 用它决定交给 Hono 还是 TanStack
export function isSeoPath(pathname: string) {
  return pathname === '/sitemap.xml' || pathname === '/robots.txt' || pathname === INDEXNOW_PATH
}

const ARTICLE_PATHS = ARTICLES.map((article) => `/${article.slug}`)

// 可被索引的公开页面（账户、结账、后台页都带 noindex，不进 sitemap）
export const PUBLIC_PATHS = ['/', '/pricing', '/guides', '/contact', '/report', '/privacy-policy', '/terms-of-service', '/refund-policy', ...ARTICLE_PATHS]

// lastmod 按页面取：文章用各自的 updatedAt，/guides 随最新文章变化，其余页面用 site.seo.updatedAt
function lastModified(path: string) {
  const article = ARTICLES.find((a) => `/${a.slug}` === path)
  if (article) return article.updatedAt
  if (path === '/guides') return [site.seo.updatedAt, ...ARTICLES.map((a) => a.updatedAt)].sort().at(-1)!
  return site.seo.updatedAt
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// URL 与页面 canonical 同源（site.domain），避免 sitemap 与 canonical 不一致
seoRoutes.get('/sitemap.xml', (c) => {
  const urls = PUBLIC_PATHS.flatMap((path) =>
    LOCALES.map((locale) => {
      const alternates = [
        ...LOCALES.map((alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${escapeXml(absoluteUrl(localePath(alt, path)))}"/>`),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(absoluteUrl(localePath(DEFAULT_LOCALE, path)))}"/>`,
      ].join('')
      return `<url><loc>${escapeXml(absoluteUrl(localePath(locale, path)))}</loc><lastmod>${lastModified(path)}</lastmod>${alternates}</url>`
    }),
  )
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

if (INDEXNOW_PATH) {
  seoRoutes.get(INDEXNOW_PATH, (c) => c.text(site.seo.indexNowKey, 200, { 'Cache-Control': 'public, max-age=86400' }))
}

// 只有正式站（APP_ENV=production）允许抓取；staging 和本地整体禁止，避免与正式站重复收录
seoRoutes.get('/robots.txt', (c) => {
  const body = isIndexable(c.env)
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        ...LOCALES.map((locale) => `Disallow: ${localePath(locale, '/checkout/')}`),
        '',
        `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
      ].join('\n')
    : ['User-agent: *', 'Disallow: /'].join('\n')
  return c.text(`${body}\n`, 200, { 'Cache-Control': 'public, max-age=3600' })
})
