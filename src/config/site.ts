// 上新词时主要改这个文件：关键词、品牌、模板视频、时长档位、积分包、文章 slug。
// 文案在 src/content/<locale>.ts，通过 {keyword} 等变量自动套用。

export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

// 每种语言的 BCP 47 标签（<html lang>、日期格式、Turnstile）、og:locale 和切换器里显示的自称。
// 加语言时在这里补一行，并在 src/lib/i18n.ts 的 loaders 里登记文案文件
export const LOCALE_META: Record<Locale, { tag: string; ogLocale: string; name: string }> = {
  en: { tag: 'en', ogLocale: 'en_US', name: 'English' },
  zh: { tag: 'zh-CN', ogLocale: 'zh_CN', name: '简体中文' },
}

export const site = {
  keyword: 'Neon Shuffle',
  brandName: 'Neon Shuffle AI',
  logoMark: 'NS',
  domain: 'example.com',
  supportEmail: 'support@example.com',
  // 社媒平台名称（用于 “Viral on TikTok” 之类标签）
  trendPlatform: 'TikTok',
  ogImage: '/og.png',

  // 生成模板：provider 输出时长 = 源视频时长，所以每个时长档位各有一段剪好的源视频。
  // 源视频上传到 R2 的 templates/<文件名>，由 /media/templates/<文件名> 公开提供给 provider 拉取。
  template: {
    id: 'neon-shuffle-v1',
    aspectRatio: '9:16',
    fullSeconds: 18,
  },

  // 首页展示素材（public/demo/）。换成真实素材时必须拥有授权，credit 写原作者，例如 '@handle · TikTok'。
  examples: {
    original: { video: '/demo/original.mp4', poster: '/demo/original.jpg', credit: 'Demo clip · original' },
    aiVersions: [
      { video: '/demo/ai1.mp4', poster: '/demo/ai1.jpg', credit: 'Demo clip · AI render' },
      { video: '/demo/ai2.mp4', poster: '/demo/ai2.jpg', credit: 'Demo clip · AI render' },
    ],
    madeWith: { photo: '/demo/sample-photo.jpg', video: '/demo/madeWith.mp4', poster: '/demo/madeWith.jpg' },
    // “创意”区块：每条 = 一张示例照片 + 一段成片
    ideas: [
      { photo: '/demo/sample-photo.jpg', video: '/demo/ai1.mp4', poster: '/demo/ai1.jpg' },
      { photo: '/demo/sample-photo.jpg', video: '/demo/ai2.mp4', poster: '/demo/ai2.jpg' },
      { photo: '/demo/sample-photo.jpg', video: '/demo/madeWith.mp4', poster: '/demo/madeWith.jpg' },
    ],
  },

  // 视频模型（fal.ai queue API）。换模型时同时检查 src/server/video/fal.ts 的入参与出参。
  video: {
    falModel: 'fal-ai/wan/v2.2-14b/animate/replace',
    resolution: '480p',
    // 成本估算，只用于后台毛利；实际扣费以 fal 账单为准。换模型、分辨率或源视频帧率时同步更新。
    // fal 按帧计费：16 帧 = 1 个“视频秒”，480p $0.04/视频秒（https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace）
    costCentsPerVideoSecond: 4,
    sourceFps: 24,
  },

  durations: [
    { id: 'short', seconds: 6, credits: 6, source: 'neon-shuffle-v1-6s.mp4' },
    { id: 'medium', seconds: 12, credits: 12, source: 'neon-shuffle-v1-12s.mp4' },
    { id: 'full', seconds: 18, credits: 18, source: 'neon-shuffle-v1-18s.mp4', isFull: true },
  ],

  // 积分包：一次性购买，积分永不过期。价格用于展示与订单记录，实际收费以支付商后台为准。
  packages: [
    { id: 'starter', credits: 20, priceCents: 990, currency: 'USD' },
    { id: 'party', credits: 60, priceCents: 1990, currency: 'USD', highlight: true },
    { id: 'squad', credits: 100, priceCents: 2990, currency: 'USD' },
  ],

  signupBonusCredits: 0,

  upload: {
    maxBytes: 10 * 1024 * 1024,
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },

  // 数据保留（天）：Cron 到期删除 R2 对象并标记 expired；隐私政策与个人中心按这里的值展示。
  // 另在 R2 配同前缀的生命周期规则兜底（README「数据保留」）。0 = 不自动删除。
  retention: {
    uploadDays: 7,
    outputDays: 30,
  },

  // 举报下架的处理时限（小时），TAKE IT DOWN Act 要求 48 小时内删除
  takedownSlaHours: 48,

  // SEO 文章（指南），按展示顺序排列。slug 是根路径：/<slug> 与 /zh/<slug>；正文在 src/content/<locale>.ts 的 articles[key]。
  // 新增文章：这里加一项，各语言 content 的 articles 补同名 key（缺了 typecheck 会报错）。
  // trend、howTo 两篇被首页直接链接，不要删。related 不填时推荐其余文章里最近更新的。
  // 日期写进 Article 的 datePublished/dateModified、页面上的“最后更新”和 sitemap lastmod，改正文时同步改 updatedAt
  articles: [
    { key: 'trend', slug: 'neon-shuffle-ai-trend', publishedAt: '2026-10-20', updatedAt: '2026-10-20' },
    { key: 'howTo', slug: 'how-to-make-neon-shuffle-ai-video', publishedAt: '2026-10-20', updatedAt: '2026-10-20' },
  ],

  seo: {
    // 长尾词：不输出 meta keywords（Google 不用），由 npm run seo:check 检查首页正文是否覆盖
    secondaryKeywords: ['Neon Shuffle AI', 'Neon Shuffle video', 'Neon Shuffle trend', 'AI dance video'],
    // 首次上线日期与站点页面（首页、价格、法律页等）最近一次内容更新日期：首页视频 uploadDate、sitemap lastmod。文章用各自的日期
    publishedAt: '2026-10-20',
    updatedAt: '2026-10-20',
    // Search Console / Bing Webmaster 选“HTML 标记”验证时填 content 值；用 DNS 验证则留空
    googleVerification: '',
    bingVerification: '',
    // IndexNow key（8–128 位字母数字）：填了才会公开 /<key>.txt，配合 npm run seo:indexnow 推送
    indexNowKey: '',
    // 品牌社媒主页，写进 Organization.sameAs
    sameAs: [] as string[],
    ogImageSize: { width: 1200, height: 630 },
  },

  // 统计：推荐只填 cfBeaconToken（Cloudflare Web Analytics，不写 Cookie，不需要同意横幅）。
  // 填了 ga4Id 才启用 GA4：同时出现同意横幅和页脚“Cookie 设置”，访客接受前不加载 gtag.js（Consent Mode v2 basic 模式，见 lib/consent.ts）。
  // 隐私政策的“Cookie 与统计”一节按这两项自动调整
  analytics: {
    ga4Id: '',
    cfBeaconToken: '',
  },
} as const

export type DurationOption = (typeof site.durations)[number]
export type CreditPackage = (typeof site.packages)[number]

export function findDuration(id: string) {
  return site.durations.find((d) => d.id === id)
}

export function findPackage(id: string) {
  return site.packages.find((p) => p.id === id)
}

export type ArticleKey = (typeof site.articles)[number]['key']
export interface Article {
  key: ArticleKey
  slug: string
  publishedAt: string
  updatedAt: string
  related?: readonly ArticleKey[]
}
export const ARTICLES: readonly Article[] = site.articles

export function findArticle(slug: string) {
  return ARTICLES.find((a) => a.slug === slug)
}

export function articlePath(key: ArticleKey) {
  const article = ARTICLES.find((a) => a.key === key)
  if (!article) throw new Error(`Unknown article: ${key}`)
  return `/${article.slug}`
}

export function relatedArticles(article: Article, limit = 3): Article[] {
  if (article.related) return article.related.flatMap((key) => ARTICLES.filter((a) => a.key === key)).slice(0, limit)
  return ARTICLES.filter((a) => a.key !== article.key)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
}

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

export function localePath(locale: Locale, path: string) {
  const clean = path.startsWith('/') ? path : `/${path}`
  if (locale === DEFAULT_LOCALE) return clean
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`
}

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}
