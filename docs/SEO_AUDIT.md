# SEO 审计与关键词规划（2026-10-20）

## 结论

模板的 SSR 输出现在满足基础 SEO 的全部硬性要求：每页一个 H1、title 不超过 60、canonical/hreflang 自指一致、首页与文章有完整 JSON-LD、sitemap 带 lastmod、尾斜杠 301、非公开页 noindex。上新词时只改 `src/config/site.ts` 和两份文案，结构化数据、sitemap、canonical 全部自动跟随。

`npm run seo:check` 把这些规则固化成脚本，`tests/e2e/seo.spec.ts` 在 e2e 里强制执行，模板改坏会直接失败。

剩下需要人工完成的事：每个新词都要重写趋势文案（不能只换关键词），以及上线后在 Search Console 验证并提交 sitemap。

## 关键词规划

一个热词站就是一个主关键词加 3–5 个长尾词，按搜索意图分配到页面，避免多个页面争同一个词：

| 搜索意图 | 示例查询 | 落地位置 | 关键词出现处 |
| --- | --- | --- | --- |
| 交易型（主词） | `{keyword} AI`、`{keyword} AI video generator` | 首页 `/` | title 开头、H1、meta description、hero 首段、og:title |
| 信息型 | `what is {keyword}`、`{keyword} trend` | 首页 What is 区块 + 文章 `/{slug}-ai-trend` | H2 `What is {keyword}?`、文章 title/H1 |
| 教程型 | `how to make {keyword} video` | 首页 How it works 区块 + 文章 `/how-to-make-{slug}-ai-video` | H2 `How to make a {keyword} AI video in 3 steps`、文章 title/H1 |
| 商业比较 | `{keyword} AI price` | `/pricing` | title、BreadcrumbList |

- 长尾词写在 `site.seo.secondaryKeywords`，seo-check 检查英文首页正文是否自然覆盖。不输出 `<meta name="keywords">`（Google 不使用）。
- 首页 title 不加品牌后缀（品牌名本身就含关键词，再加会超长），其他页用 `页面名 – 品牌`。
- 中文站 `/zh` 是同一结构的翻译版本，用 hreflang 互指，不和英文站争排名。

## 首页 one-page 结构

| 顺序 | 区块 | 标签 | 作用 |
| --- | --- | --- | --- |
| 1 | Hero + 生成器 | H1（含主词） | 首屏直接转化，生成器在 SSR HTML 中可见 |
| 2 | How it works | H2 + `<ol>` 三步 | 承接教程型查询，链接到教程文章 |
| 3 | Made with | H2 | 照片 → 成片示例，图片 alt 含关键词 |
| 4 | What is | H2 | 承接信息型查询，链接到趋势文章 |
| 5 | Features | H2 + H3 × 6 | 卖点 |
| 6 | Ideas | H2 + H3 × 3 | 使用场景 |
| 7 | Pricing | H2 | 价格（与 AggregateOffer 一致） |
| 8 | FAQ | H2 + FAQPage JSON-LD | 长尾问题 |
| 9 | Final CTA | H2 | 收尾转化 |

HowTo 富结果 Google 已下线，所以三步流程只用语义化有序列表，不输出 HowTo JSON-LD。FAQ 富结果目前只对权威政府/医疗站展示，保留 FAQPage 是为了让搜索引擎和 AI 摘要理解问答内容（[Google 公告](https://developers.google.com/search/blog/2023/08/howto-faq-changes)）。

## 修复前后（本地 SSR，curl 抓取）

工件（只在作者本机，`.tmp/` 不进仓库）：修复前 `.tmp/template-review/ssr/before/`，修复后 `.tmp/template-review/ssr/after/`，检查报告 `.tmp/template-review/seo-check-1/report.md`。

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| 首页 title | 82 字符（被截断） | 46：`Neon Shuffle AI Video Generator from One Photo` |
| 中文首页 title 宽度 | 66 字符，约 100 宽 | 约 48 宽 |
| 首页含关键词的 H2 | 2 | 4（新增 How to / What is） |
| 首页 JSON-LD | SoftwareApplication（单一 Offer）、FAQPage | Organization、WebSite、SoftwareApplication（AggregateOffer）、VideoObject、FAQPage |
| 文章 JSON-LD | Article（缺 datePublished、image、author） | Article（完整）+ BreadcrumbList，页面可见面包屑 |
| 价格页 JSON-LD | 无 | BreadcrumbList |
| 法律页 description | 只重复标题（32 字符） | 独立描述（约 120 字符） |
| 图片 alt | 首页 4 张为空 | 全部有描述 |
| og:image 尺寸、og:image:alt、twitter:title/description | 无 | 有 |
| sitemap lastmod | 无 | 文章取各自 `updatedAt`，`/guides` 取最新一篇，其余页面取 `site.seo.updatedAt` |
| `/pricing/` | TanStack 307 | 301 → `/pricing`（保留查询参数） |
| HSTS | 无 | production + https 下发 |
| 站长验证、IndexNow | 无 | `site.seo` 配置后自动输出 |

## 已落地的技术项

- **SSR**：所有公开页的 title/meta/canonical/hreflang/JSON-LD/正文都在首次 HTML 中，不依赖 JS。e2e 验证中英文首页水合无报错，并验证客户端路由切换后 head 同步更新（canonical 不残留上一页、JSON-LD 跟随页面）。
- **canonical / hreflang**：基于 `site.domain` 生成，自指 + `en`/`zh`/`x-default`，与 sitemap 中的 `xhtml:link` 一致。
- **内链**：导航和页脚链到 `/guides`（文章枢纽，链到全部文章），页脚另列前 3 篇；文章页有可见面包屑（首页 → 指南 → 文章）和"相关指南"（默认取最近更新的其他文章，可用 `related` 指定）。FAQ 答案（`faq.items[].guide`）、价格页和联系页也链到文章或 `/guides`，锚文本用与文章标题不同的长尾词。语言切换是带 `hreflang` 的普通链接，页脚始终渲染，爬虫可跟随。
- **索引控制**：dashboard、checkout、sign-in、admin 带 noindex；`robots.txt` 只在 `APP_ENV=production` 放开，预览环境整站禁止抓取。
- **结构化数据**：`src/lib/seo.ts` 统一生成，`<` 转义防止提前闭合 script。不编造 aggregateRating/review（违反 [Google 评价摘要政策](https://developers.google.com/search/docs/appearance/structured-data/review-snippet#guidelines)），有真实评价后再加。
- **IndexNow**：`site.seo.indexNowKey` 非空时站点在 `/<key>.txt` 返回 key；`npm run seo:indexnow` 默认只打印 URL，`--submit` 才提交。Google 不支持 IndexNow，用 Search Console。
- **性能**：示例视频 `preload="metadata"` + poster + 固定宽高比容器（无 CLS），进入视口才播放；单个示例视频约 100 KB。`public/_headers` 给带哈希的 `/assets/*` 一年 immutable 缓存，`/demo/*`、`/og.png` 缓存 7 天。文案按语言拆包，浏览器只下载当前语言。

## 工具

| 命令 | 用途 |
| --- | --- |
| `npm run seo:check` | 按 sitemap 抓取全部公开页，检查 title/description 宽度、H1、canonical、hreflang、OG、JSON-LD、alt、noindex、长尾词、尾斜杠 301、soft 404、robots；报告写到 `.tmp/seo-check/` |
| `npm run seo:check -- --base https://<domain> --production` | 上线后检查正式站，占位域名、robots 禁抓、缺 HSTS 都会升级为问题 |
| `npm run seo:indexnow [-- --submit]` | 推送 sitemap URL 到 IndexNow |
| `npx playwright test tests/e2e/seo.spec.ts` | 规则 + 水合 + 客户端路由 head 同步 |

外部审计 skill：[AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo)（MIT，19.3k stars，2026-10-04 仍在更新；GitHub 上同类 SEO skill 均不足 10 stars）。作者在本机把它装在项目的 `.claude/skills/seo*`（`.claude/` 不入库，需要的话按该仓库的说明自行安装）。本次用它的 seo-audit / seo-technical / seo-schema / seo-hreflang / seo-sitemap 检查项作为清单，对本地 SSR 输出逐项核对。它的抓取和 PageSpeed 脚本需要公网 URL，部署后运行 `/seo-audit https://<domain>`，可以拿到含 Core Web Vitals 的完整评分。

## 每个新词上线前后

上线前：

1. `node scripts/new-site.mjs --keyword "..." --domain ... --write` 改好配置。
2. 重写 `src/content/en.ts`、`zh.ts` 的 hero、whatIs、ideas、faq 和两篇文章。只换关键词的整站模板内容容易被判为 [scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content)。
3. 换 `public/og.png`（1200×630）和示例素材。
4. `npm run seo:check` 无 error。

上线后：

1. `npm run seo:check -- --base https://<domain> --production`。
2. Search Console 与 Bing Webmaster 验证（DNS 或填 `site.seo.googleVerification` / `bingVerification`），提交 `https://<domain>/sitemap.xml`。
3. 配置了 IndexNow key 时运行 `npm run seo:indexnow -- --submit`。
4. 热度变化后更新文案：改了哪篇文章就改 `site.articles` 里那篇的 `updatedAt`（页面"最后更新"、Article dateModified、sitemap lastmod 跟随）；改首页等站点页面时更新 `site.seo.updatedAt`。
5. 新增文章：在 `site.articles` 加一条（key、slug、日期），再在两份文案的 `articles` 里加同名 key 的正文；`/guides`、页脚、sitemap、相关文章自动跟随。

## 未覆盖

- 真实域名下的 Core Web Vitals、抓取与收录情况（未部署）。
- 外链、社媒 `sameAs` 等站外信号需要每个站单独建设。
- 程序化批量页（例如每个风格一页）：在内容足够差异化之前不建议做。
