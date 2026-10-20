# ShrimpReel（虾片）

[English](README.md) | 简体中文

作者：[浅水虾](https://x.com/qianshuixia2026)，一只朝着深海出发的浅水虾。

开源的“一张照片 → 跟拍某个爆款视频模板”AI 视频 SaaS 模板。每追一个新热词就建一个站：从本模板建仓库，改配置、文案和素材即可上线。全部跑在 Cloudflare 上：Workers + D1 + R2 + KV + Queues + Rate Limiting + Cron。

> 状态：本地全流程可用（单元测试 + Playwright e2e），尚未作为正式站点部署。哪些已用真实服务验证、哪些还没有，见 [ROADMAP.md](ROADMAP.md)。

- 前端/SSR：TanStack Start（React 19）+ Tailwind 4，`/` 英文、`/zh` 中文
- API：Hono（`/api/*`、`/media/*`、`/sitemap.xml`、`/robots.txt`、IndexNow key 文件），入口 `src/server.ts`
- 支付：Waffo Pancake（默认）、Dodo Payments，均为 MoR；`mock` 仅用于本地和 e2e
- 视频：fal.ai queue API（`mock` 仅用于本地和 e2e）
- 已具备：
  - 用户与积分：Google 登录（含 One Tap）、积分包与积分流水、个人中心（视频/账单/设置/注销/导出我的数据）
  - 订单与生成：订单与部分/全额退款回收、生成任务队列（含死信队列）与失败退积分
  - 增长与运营：来源归因（UTM 与广告点击 ID，首次和最近触达）、访问 → 注册 → 下单 → 支付 → 生成漏斗、GA4 事件（带同意横幅）
  - 管理后台：概览（含服务商成本与毛利）、用户、订单、生成、举报下架、留言、支付事件、邮件、审计、经营报表与订单 CSV
  - 交易邮件：积分到账、成片完成、生成失败退积分、举报回执与处理结果；管理员收新举报、超时提醒和新留言（Cloudflare Email Service，发件箱去重与重试）
  - 合规与内容安全：成片 AI 标识；照片 7 天、成片 30 天自动清理；举报下架（48 小时队列，同一张原图的全部成片一并删除并拉黑）；上传图片审核；联系和举报表单的 Turnstile 人机验证
  - 运维与安全：健康检查告警邮件、前端错误上报到 Workers 日志、CSP（Report-Only，每次请求一个 nonce）与 Permissions-Policy
  - 内容与 SEO：one-page 首页（How it works / What is 区块）、可扩展的文章集合（`/guides` 列表页、相关文章）、法律页、联系表单；SSR 输出完整的 canonical、hreflang、JSON-LD 和 sitemap；文案按语言拆包；`npm run seo:check` 检查全站

功能建议与后续规划见 [docs/SAAS_VIDEO_FEATURES.md](docs/SAAS_VIDEO_FEATURES.md) 和 [ROADMAP.md](ROADMAP.md)。SEO 规则、关键词规划和审计结果见 [docs/SEO_AUDIT.md](docs/SEO_AUDIT.md)。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars       # 至少填 SESSION_SECRET
npm run seed:local                   # 应用 D1 迁移 + 把 seed/templates/*.mp4 上传到本地 R2
npm run dev -- --host 127.0.0.1      # http://127.0.0.1:3000
```

- 本地默认 `PAYMENT_PROVIDER=mock`、`VIDEO_PROVIDER=mock`：点购买会进入模拟收银台，生成会复制模板视频作为结果，不花钱。
- 登录页在非 production 环境有“开发登录”（`POST /api/auth/dev-login`），production 返回 404。开发登录、mock 支付和 `/api/dev/*` 只接受本机直连：经过隧道或代理的请求（带 `cf-connecting-ip`、`X-Forwarded-For` 等头）一律返回 404。局域网里的人能伪造这些条件，所以不要用 `--host 0.0.0.0` 启动，也不要把 dev server 直接暴露到公网；联调 webhook 用 `scripts/webhook-proxy.mjs`（见下文）。
- 本地默认 `MODERATION_PROVIDER=mock`：上传表单带 `mockOutcome=reject` 时模拟审核不通过。`TURNSTILE_SITE_KEY` 留空表示不启用人机验证。
- `POST /api/dev/sweep {"days": 8}`（仅本机）：模拟 N 天后的清理，只处理当前登录用户的媒体，用来验证保留期。
- `ADMIN_EMAILS` 里的邮箱登录后可进 `/admin`，本地默认是 `admin@example.com`。这些邮箱是在登录时被设为管理员的，之后从列表里删掉不会撤销角色，要同时在 `/admin/users` 的用户详情页点“取消管理员”。
- 本地发信只是模拟，不会真的发出，结果以发件箱为准：`GET /api/dev/emails?to=<邮箱>&ref=<订单号/举报编号>`（仅本机）。`POST /api/dev/takedown-reminders {"takedownId": "tdr_…", "hours": 37}` 模拟 N 小时后对某条举报跑一次超时提醒。
- Windows：用 `--host 127.0.0.1` 启动，否则 Playwright 等工具连 `localhost` 可能解析到 IPv6 连不上。`npm install` 前先停掉 dev server，否则 `.wrangler` / miniflare 文件被占用会报 `EBUSY`。
- `src/server.ts` 里的 `drainUnreadBody` 只在 dev 生效：当前 miniflare 5 beta 在 Worker 不读完请求体就返回时，会让同一连接上的下一个请求 500 `fetch failed`。升级 `@cloudflare/vite-plugin` 后可以去掉它，再用 `npm run test:e2e` 验证 CSRF 用例。

## 上新词流程

每个热词站是一个独立仓库，把本模板设为 `upstream`。支付、安全和框架的修复在模板里改一次，各站点合并即可。

1. **建站点仓库**：
   ```bash
   git clone https://github.com/qianshuixia/shrimpreel.git moonhop && cd moonhop
   git remote rename origin upstream
   git remote add origin git@github.com:<owner>/moonhop.git
   ```
   不要用 GitHub 的 “Use this template”：它生成的仓库和模板没有共同历史，之后无法 `git merge upstream/main`。公开仓库的 fork 不能设为私有，站点仓库一般也不用 fork。
2. **跑脚手架**：
   ```bash
   node scripts/new-site.mjs --keyword "Moon Hop" --domain moonhop.ai --keywords "AI dance video,Moon Hop filter"          # 预览
   node scripts/new-site.mjs --keyword "Moon Hop" --domain moonhop.ai --keywords "AI dance video,Moon Hop filter" --write  # 写入
   ```
   脚本一次改好以下内容，并列出剩下必须人工完成的清单：
   - `site.ts`：关键词、品牌、域名、邮箱、`template.id`、文章 slug、长尾词、发布/更新日期；同时清空旧站的站长验证、IndexNow key 和统计 ID。
   - `wrangler.jsonc`：资源名和 ratelimit `namespace_id`，D1/KV id 重置为占位值。
   - `package.json`：`name`。
   - 删除 `wrangler.staging.jsonc`（模板自身的预发配置）。

   积分包价格（`packages`）、`durations`、`video.falModel` 按需在 `src/config/site.ts` 手改。
3. **改文案**：`src/content/en.ts`、`src/content/zh.ts`。文案通过 `{keyword}` 等变量套用。每个词至少要重写 hero、whatIs、ideas、FAQ 和两篇文章，首页正文要自然覆盖长尾词。整站只换关键词会被 Google 判为 [scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content)。
   - **文章**：在 `site.ts` 的 `articles` 加一项（`key`、`slug`、发布和更新日期，可选 `related`），再在每种语言的 `articles` 里补同名 key，缺了 typecheck 会报错。文章页地址是 `/<slug>`，自动进入 `/guides` 列表、sitemap 和其它文章的“相关文章”。`trend`、`howTo` 两篇被首页直接链接，不要删。建议每站至少一篇 1,200 词以上的支柱页，加 4–6 篇长尾页（教程、灵感、排错、对比）。
   - 文案按语言拆包，浏览器只下载当前语言（含法律页全文）。组件里照常用 `getContent(locale)`；只有在根路由之外、渲染之前要用文案时，才需要先 `await loadContent(locale)`。
   - 加一种语言：在 `site.ts` 的 `LOCALES` 和 `LOCALE_META` 里登记，新建 `src/content/<locale>.ts`（类型与 `en.ts` 一致），再在 `src/lib/i18n.ts` 的 `loaders` 里加一行动态 import。
4. **换素材**：
   - `seed/templates/<template.id>-<秒数>s.mp4`：生成用的源视频，部署后上传到 R2 的 `templates/`。
   - `public/demo/*`：首页展示视频和海报。必须是自有或已获授权的素材，在 `site.examples.*.credit` 写明来源。
   - `public/og.png`、`public/favicon.svg`。
   - `node scripts/generate-placeholder-media.mjs`（需要 ffmpeg）可以重新生成原创占位素材。
5. **改 `wrangler.jsonc` 的 `vars`**：`SITE_URL`、`APP_ENV=production`、`PAYMENT_PROVIDER`、`VIDEO_PROVIDER`、`MODERATION_PROVIDER`、`TURNSTILE_SITE_KEY`、`ADMIN_EMAILS`、`EMAIL_FROM`、`*_PRODUCTS`、`GOOGLE_CLIENT_ID`；创建资源后把 D1/KV id 写回（见下文）。
6. **在支付商后台建商品**：每个积分包一个一次性商品，product id 写进 `WAFFO_PRODUCTS` 或 `DODO_PRODUCTS`，例如 `{"starter":"prod_xxx","party":"prod_yyy","squad":"prod_zzz"}`。Waffo 可用 `node scripts/waffo-setup.mjs --store STO_xxx --apply` 批量创建，Dodo 可用 `node scripts/dodo-setup.mjs --apply --write-dev-vars`（加 `--webhook <url>` 同时建 webhook 并把签名密钥写进 `.dev.vars`）。页面价格只用于展示，实际收费以支付商后台为准，两边要一致。
7. **本地验证**：`npm run typecheck && npm test && npm run test:e2e && npm run seo:check`，然后部署。
8. **上线后**：
   - 运行 `npm run seo:check -- --base https://<domain> --production`。
   - 在 Search Console 和 Bing Webmaster 验证站点，提交 `https://<domain>/sitemap.xml`。
   - 配置了 `site.seo.indexNowKey` 时，运行 `npm run seo:indexnow -- --submit`。

### 合并模板更新

```bash
git fetch upstream
git merge upstream/main
npm install && npm run typecheck && npm test && npm run test:e2e
npm run db:migrate:remote   # 模板新增了 migrations/ 时，部署前先应用
```

- 站点差异只放在 `src/config/site.ts`、`src/content/*`、`public/*`、`seed/`、`wrangler.jsonc` 和 `package.json` 的 `name`。其它文件和模板保持一致：共用代码的 bug 在模板里修，再合并到各站，不要只改一个站。
- 这些文件冲突时，保留站点自己的值，同时接受模板新增的键；文案缺键时 typecheck 会报错。
- 模板改了 `wrangler.staging.jsonc` 时，站点里会出现“修改/删除”冲突，用 `git rm wrangler.staging.jsonc` 解决。

## 部署到 Cloudflare

首次为一个新站创建资源（名称与 `wrangler.jsonc` 保持一致）：

```bash
npx wrangler d1 create <name>                  # 把输出的 database_id 写进 wrangler.jsonc
npx wrangler r2 bucket create <name>-media
npx wrangler kv namespace create <name>-kv     # 把 id 写进 wrangler.jsonc；标题在账号内唯一，不要都叫 KV
npx wrangler queues create <name>-jobs
npx wrangler queues create <name>-jobs-dlq
npm run db:migrate:remote                      # 0003 保留期、举报下架和图片拉黑；0004 邮件发件箱
npx wrangler r2 object put <name>-media/templates/<file>.mp4 --file seed/templates/<file>.mp4 --content-type video/mp4 --remote
```

- `ratelimits[].namespace_id` 在同一账号内要唯一，多个站点不要共用同一组数字。
- 密钥用 `npx wrangler secret put <NAME>` 写入：`SESSION_SECRET`、`GOOGLE_CLIENT_SECRET`、`WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`、`DODO_API_KEY`、`DODO_WEBHOOK_SECRET`、`FAL_KEY`；按需加 `OPENAI_API_KEY`（图片审核）、`TURNSTILE_SECRET_KEY`。
  - `SESSION_SECRET` 用于签名交给视频服务商的图片地址和 fal 回调 token，用 `openssl rand -hex 32` 生成。production 和 staging 下，缺失、短于 32 个字符或仍是 `.dev.vars.example` 里的值时会被拒绝：任务提交不出去（队列重试完后判失败并退积分，Workers Logs 写明原因），`/media/uploads/*` 返回 503。
- 同时配好 R2 生命周期规则，见下文“合规与内容安全”。
- 发信域名要在 Email Service 完成 Onboard，见下文“交易邮件”。
- 部署：`npm run deploy`。在 Cloudflare 控制台给 Worker 绑定自定义域名，`SITE_URL` 和 `site.domain` 要与之一致（canonical、sitemap 和 CSRF 同源校验都依赖它）。
- `APP_ENV=production` 或 `staging` 时，若仍配置 `mock` 支付、`mock` 视频或 `mock` 审核，下单、生成和上传会返回 503；开发登录返回 404。`robots.txt` 只在 production 放开抓取。
- 自定义域名可用后，在站点的 `wrangler.jsonc` 里设 `"workers_dev": false` 和 `"preview_urls": false`。否则正式 Worker 还会在 `*.workers.dev` 上响应，绕过你在域名上配置的 WAF 和限流规则；每个版本还有一个公开的 [Version URL](https://developers.cloudflare.com/workers/configuration/previews/)，用同一套 D1、R2 运行该版本的代码。模板默认开着 `workers_dev`，是为了新站在绑定域名前也能访问。

### 模板预发（workers.dev）

没有域名时，用 [wrangler.staging.jsonc](wrangler.staging.jsonc) 把模板本身部署到 `https://video-template-staging.<子域名>.workers.dev`，用来验证真实绑定、Google 登录、支付商 test 模式和 fal 回调。

- `APP_ENV=staging`：和 production 一样禁用 mock 与开发登录，Cookie 加 Secure；但 `robots.txt` 禁止抓取。canonical 仍指向 `site.domain`。
- 资源名都带 `-staging`，与正式站隔离。`tests/unit/staging.test.ts` 会检查它和 `wrangler.jsonc` 的绑定、vars 键是否一致。new-site 会删除这个文件。
- 不发交易邮件（`EMAIL_FROM` 为空），默认不做图片审核（`MODERATION_PROVIDER=none`）。

```bash
npx wrangler d1 create video-template-staging                # database_id 写进 wrangler.staging.jsonc
npx wrangler r2 bucket create video-template-staging-media
npx wrangler kv namespace create video-template-staging-kv   # id 写进 wrangler.staging.jsonc
npx wrangler queues create video-template-staging-jobs
npx wrangler queues create video-template-staging-jobs-dlq
npx wrangler r2 bucket lifecycle add video-template-staging-media expire-uploads uploads/ --expire-days 8
npx wrangler r2 bucket lifecycle add video-template-staging-media expire-outputs outputs/ --expire-days 31
npx wrangler d1 migrations apply DB --remote -c wrangler.staging.jsonc
npx wrangler r2 object put video-template-staging-media/templates/<file>.mp4 --file seed/templates/<file>.mp4 --content-type video/mp4 --remote
npx vite build --mode staging && npx wrangler deploy         # deploy 读取构建产物里的 staging 配置
npx wrangler secret put <NAME> -c wrangler.staging.jsonc     # 或 secret bulk，从 stdin 读 JSON
```

- 除 `deploy` 外，staging 的 wrangler 命令都要带 `-c wrangler.staging.jsonc`：不带时，`deploy` 这类命令会跟随最近一次构建产物里的配置。`npm run deploy` 会先按 `wrangler.jsonc` 重新构建。
- 下表的回调地址把 `<domain>` 换成 workers.dev 地址。Waffo 和 Dodo 只用 test 店铺。

### 第三方回调地址

| 服务 | 配置位置 | 地址 |
| --- | --- | --- |
| Google OAuth | Google Cloud Console → Authorized redirect URIs | `https://<domain>/api/auth/google/callback` |
| Waffo Pancake | Dashboard → Settings → Webhooks | `https://<domain>/api/webhooks/waffo` |
| Dodo Payments | Dashboard → Webhooks | `https://<domain>/api/webhooks/dodo` |
| fal.ai | 代码自动带上 | `https://<domain>/api/webhooks/fal` |

- **Waffo**：`WAFFO_ENVIRONMENT` 为 `test` 或 `prod`。webhook 用 Waffo 公开的 RSA 公钥验签（已内置在 `src/server/payments/waffo.ts`），无需另配密钥。`WAFFO_PRIVATE_KEY` 支持 PKCS1/PKCS8，可以写成单行带 `\n` 的形式。
  - 退款是异步的：后台发起后只拿到工单号 `TKT_`，PSP 处理完才生成 `REF_` 并推送 `refund.succeeded`，test 模式实测要等 12–22 分钟。积分在 webhook 到达时才回收。
  - 每笔支付只能退款一次（可部分），且须在支付后 14 天内。后台会提前拦截，错误码为 `waffo_refund_exists` / `refund_window_expired`。
  - webhook 丢失时用“仅记账”补登，必须填 `REF_` 退款单号（填 `TKT_` 会被拒绝，否则迟到的 webhook 会再扣一次）。
  - webhook 由 Upstash QStash 投递，失败重试只发往创建时填的 URL，所以必须用固定域名。
- **本地联调真实 webhook**：`node scripts/webhook-proxy.mjs --port 3100` 只转发 `POST /api/webhooks/{waffo,dodo}`，把隧道指向它，不要直接暴露 dev server。实测 Pinggy 可用（`ssh -p 443 -R0:127.0.0.1:3100 qr@a.pinggy.io`，免费版 60 分钟），localhost.run 经常断线。
- **Dodo**：`DODO_ENVIRONMENT` 为 `test` 或 `live`。webhook 按 Standard Webhooks 规范验签，`DODO_WEBHOOK_SECRET` 填控制台给的 `whsec_...`。
  - API 密钥按资源授权：`dodo-setup.mjs` 需要 Products 写入，加 `--webhook` 还要 Webhooks 写入；运行时需要 Checkout sessions 和 Refunds 写入。
  - 商户只能在支付后 30 天内退款，可分多次部分退款，但同一时间只能有一笔在处理（[文档](https://docs.dodopayments.com/features/transactions/refunds)）。超过 30 天时后台返回 `refund_window_expired`。
  - 退款从商户钱包余额扣。每笔支付扣掉税费和手续费后才入账，test 模式实测要等约 4–5 分钟。余额不够时 Dodo 返回 409 “Insufficient funds in wallet”，后台显示为 `payment_provider_conflict`。新店或刚提现之后，全额退款经常因此失败。
  - test 模式下退款接口直接返回 `succeeded`，`refund.succeeded` 约 2 秒后到达。积分仍以 webhook 为准回收。
  - webhook 由 Svix 投递。支付事件的 metadata（`orderId` 等）会原样回传；退款事件不带 metadata，靠 `payment_id` 反查订单。隧道换域名后用 `--webhook-id` 改 URL，签名密钥不变。
  - 支付成功或失败都会跳回 `return_url`，并追加 `payment_id`、`status`、`email`（买家邮箱）。GA4 的 `page_location` 已去掉 email。
  - 收银台显示的商户名取自 Dodo 注册信息。上 live 前在后台改成品牌名。
- **fal**：webhook 只当作“该查一下了”的信号，结果总是用 `FAL_KEY` 重新拉取。另外每 5 分钟的 Cron 会补查卡住的任务，超过 45 分钟判失败并退积分。

## 关键设计

- **积分**：`users.credits` 是 `credit_ledger` 的缓存余额，有 `CHECK (credits >= 0)`。每笔变动都写流水，`idempotency_key` 唯一（`order:<id>`、`order_refund:<id>`、`generation:<id>` 等），与余额更新在同一个 D1 batch 里，重复入账会整体回滚。
- **支付事件**：`payment_events (provider, event_id)` 唯一。重放、并发重试、退款后迟到的 paid 都只生效一次。退款按 `MIN(余额, 包内积分)` 回收，流水记录实际扣除量。
- **生成**：先扣积分再入队，失败、超时或管理员判失败时自动退回。fal webhook 和定时轮询可能同时处理同一个任务，只有一路能把任务置为成功，另一路不会删掉已落库的成片。
- **成本与毛利**：出片时按 `site.video` 里的单价估算服务商成本，写入 `generations.provider_cost_cents`。
  - fal 按帧计费，16 帧算 1 个视频秒，480p 为 $0.04/视频秒（[价格](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace)）。模板源视频是 24fps，所以成片每秒 6 美分，18 秒约 $1.08。换模型、分辨率或源视频帧率时更新 `costCentsPerVideoSecond` 和 `sourceFps`。
  - 出片后才被判失败的任务（超时、管理员判失败）照样记成本；没出片的失败任务不记。mock 记 0。
  - 后台概览显示近 30 天的服务商成本、消耗积分折算的收入和估算毛利；生成列表逐条显示成本和毛利。每积分实收 = USD 已支付订单的净实收 ÷ 未回收的积分。实际扣费以服务商账单为准。
- **安全**：非 GET 的 `/api/*`（webhook、CSP 报告和前端错误上报除外）要求 `Origin` 与站点同源；上传按文件头校验真实类型；上传和生成按用户限流；封禁用户会立即使会话失效；管理操作写入 `admin_audit`。
  - 登录后的 `redirect`（登录页和 Google 回调）只接受站内路径：`src/lib/redirect.ts` 拒绝反斜杠、控制字符，以及规范化后以 `//` 开头的地址，所以 `/sign-in?redirect=/\evil.com` 这类链接会落到个人中心。
  - 5xx 错误只对管理员返回 `message`；其他人只拿到错误码，详情以 `[api] <method> <path> <code>: <message>` 写入 Workers Logs。
  - 报告安全漏洞见 [SECURITY.md](SECURITY.md)。
- **CSP**：页面响应带 `Content-Security-Policy-Report-Only`，策略在 `src/server/csp.ts`。
  - 每次请求生成 nonce（`src/server.ts` → `src/router.tsx` 的 `ssr.nonce`），框架输出的内联脚本都会带上它，`script-src` 不放开 `'unsafe-inline'`。自定义内联脚本放进 `__root.tsx` 的 `headScripts()`，不要直接写 `<script>`。
  - 已按官方文档放行 GA4、Cloudflare Web Analytics、Turnstile、Google 登录；接入新的第三方脚本、iframe 或接口时要在 `csp.ts` 里补来源。
  - 违规报告发到 `/api/csp-report`，只写 Workers 日志 `[csp] <指令> blocked=… page=…`（URL 去掉 query，按 IP 限流）。上线观察一段时间没有误报后，把 `server.ts` 里的头名改成 `Content-Security-Policy` 即可强制执行。
  - 所有响应都带 `Permissions-Policy`，关闭摄像头、麦克风、定位、支付和 USB。

## 合规与内容安全

- **AI 标识**：生成器和个人中心的播放器左上角有 “AI-generated” 角标，下方提示分享时保留标识。下载文件名为 `<brand>-ai-video-<视频 ID>.mp4`，举报人凭文件名即可定位。成片里没有烧录水印，也没有写入 C2PA（需要 Containers，见 [FEATURES P0-1](docs/SAAS_VIDEO_FEATURES.md)）。
- **数据保留**：由 `site.retention` 控制，默认原图 7 天、成片 30 天，隐私政策文案自动读取这两个天数。
  - 每 5 分钟的 Cron 删除到期的 R2 对象，并在 D1 记 `expired_at`，每类每次最多处理 90 条。进行中任务用到的原图不删。
  - 过期后个人中心显示“已过期”，视频接口返回 410 `media_expired`。订单和积分流水不受影响。
  - 另配 R2 生命周期规则兜底，天数比代码多 1 天，避免抢在 D1 标记之前删除。不要给 `templates/` 配规则。
    ```bash
    npx wrangler r2 bucket lifecycle add <name>-media expire-uploads uploads/ --expire-days 8
    npx wrangler r2 bucket lifecycle add <name>-media expire-outputs outputs/ --expire-days 31
    ```
- **举报下架**：页脚 “Report content” 进入 `/report`，无需登录。
  - 表单字段：签名、邮箱、内容定位、原因、未同意声明。提交后写入 `takedown_requests`，截止时间为 48 小时后（`site.takedownSlaHours`）。内容定位里能识别出 `gen_` 视频 ID 时自动关联。
  - 管理员在 `/admin/takedowns` 处理，概览页显示待处理数和超时数。
  - 下架：按原图 SHA-256 找出同一张照片的全部上传和成片，然后：
    - 进行中的任务判失败并退积分；
    - 删除 R2 对象并标记 `removed_at`；
    - 哈希写入 `blocked_media`，此后再上传同一张图返回 422 `content_rejected`。
  - 驳回：必须填写原因。
  - 两种处理都写入 `admin_audit`。新举报、截止前 12 小时和超时时会给 `ADMIN_EMAILS` 发邮件（见“交易邮件”），但仍需要有人每天看队列。
- **上传审核**：用 `MODERATION_PROVIDER` 选择。审核在写 R2 之前完成，不通过的图片不落盘，也不扣积分。
  - `openai`：调用 OpenAI `omni-moderation-latest`（免费），需要 `OPENAI_API_KEY`。拦截 sexual、violence/graphic、self-harm 类别。接口失败时拒绝上传，返回 503。
  - `none`：不审核。
  - `mock`：仅限非 production。
  - 未成年人和名人识别不在 OpenAI 的图片类别里，这两类仍依赖同意声明和举报下架。
- **Turnstile**：在 Cloudflare 控制台创建 widget，站点密钥写进 `vars.TURNSTILE_SITE_KEY`，再执行 `npx wrangler secret put TURNSTILE_SECRET_KEY`。
  - 目前只保护联系和举报两个匿名表单。登录和生成依靠 Google 登录加限流；开放免费试用时再接入。
  - 配了站点密钥但没配 secret 时，两个表单返回 503，不会静默放行。
- **统计与 Cookie**：在 `site.analytics` 配置，隐私政策的“Cookie 与统计”一节会按配置自动调整。
  - 推荐只填 `cfBeaconToken`（Cloudflare Web Analytics）：不写 Cookie，不需要同意横幅。
  - 填了 `ga4Id` 才启用 GA4，同时出现同意横幅和页脚 “Cookie settings”。采用 Consent Mode v2 basic 模式：访客接受前不加载 gtag.js，事件只进 `dataLayer`；广告类同意项始终为 denied。拒绝或撤回时删除 `_ga`、`_ga_*`、`_gid`（当前主机和各级父域）。选择存在 `localStorage` 的 `consent.analytics`，逻辑见 `src/lib/consent.ts`。
  - 来源归因写第一方 Cookie `vt_attr`（90 天），不经过同意横幅。按欧盟 ePrivacy 的严格解释，非必要的第一方 Cookie 也需要事先同意；主要面向欧盟用户时，应把它也放到同意之后。
- **导出我的数据**（GDPR 第 15、20 条）：个人中心设置页可下载 JSON（`GET /api/account/export`），包含账号、会话、订单、积分流水、上传与生成记录、留言、本人提交的举报和发信记录；按用户限流。不含 R2 路径、服务商请求 ID、内部错误信息和成本，也不含他人针对本人视频的举报。媒体文件不打包，仍在保留期内的可从个人中心下载。字段清单见 `src/server/account-export.ts`。
- **数据库备份**：D1 Time Travel 可以恢复到 30 天内的任意时间点（Workers Free 为 7 天），但恢复会原地覆盖数据库：`npx wrangler d1 time-travel restore <db> --timestamp=<unix>`。长期留档用 `npx wrangler d1 export <db> --remote --output backup-<date>.sql` 定期导出；自动导出到 R2 的 Workflow 还没做。

## 交易邮件

用 [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)（public beta）从 Worker 直接发信：`send_email` binding 名为 `EMAIL`，发件地址是 `vars.EMAIL_FROM`。

- **发给用户**：积分到账、成片完成（附保留截止日期）、生成失败退积分、举报回执、举报处理结果、视频因举报被删除。语言跟随用户最近一次下单或生成时所用的界面语言，举报相关邮件用举报时的页面语言。已注销或封禁的用户不发。
- **发给管理员**（`ADMIN_EMAILS`，中文）：新举报；截止前 12 小时和超时后各提醒一次；新留言（Reply-To 是留言人）。留言人不会收到自动回复，避免表单被用来向任意邮箱发信。
- **发送方式**：业务事件先写入 D1 的 `email_outbox` 表，`dedupe_key` 唯一（如 `order_paid:<订单号>`）。webhook 重放、队列重投、Cron 重叠都只发一封。
  - 写入后立即发送。遇到限流、日配额或服务端错误时，按 5、15、45… 分钟退避，最多 5 次，由每 5 分钟的 Cron 补发；发件人未验证等永久错误直接记为失败。
  - 发送语义是“至少一次”：邮件已发出、但 Worker 在写回状态前中断时，可能多发一封。
  - 发件箱保留 30 天，注销账号时删除该用户的记录。
- **后台**：`/admin/emails` 可以按收件人、订单号、举报编号搜索，失败或未发送的邮件可以重发；概览页显示发送失败数。
- **上线配置**：
  1. Cloudflare 控制台 → Compute > Email Service → Onboard Domain，添加站点域名（DNS 必须托管在 Cloudflare），按提示添加 SPF/DKIM 记录。
  2. 账号需要 Workers Paid 才能发给任意收件人。每月含 3,000 封，超出部分每千封 $0.35（[价格](https://developers.cloudflare.com/email-service/platform/pricing/)）。
  3. `vars.EMAIL_FROM` 改成 `noreply@<domain>`（`new-site.mjs` 会自动改），然后运行 `npm run db:migrate:remote` 应用 0004。
- `EMAIL_FROM` 留空或没有 binding 时不发信，邮件记为“未发送”；配好后可在后台重发。本地 `wrangler dev` 只模拟发送，不要给 binding 加 `"remote": true`。

## 监控告警

每 5 分钟的 Cron 跑一次健康检查（`src/server/alerts.ts`），超过阈值就给 `ADMIN_EMAILS` 发中文告警邮件，同时写一条 `console.error('[alert] …')` 到 Workers 日志：

| 告警 | 条件 | 后台页面 |
| --- | --- | --- |
| 生成失败率 | 最近 1 小时完成的任务里失败 ≥ 3 个且占比 ≥ 30%（不含管理员手动失败、举报下架） | `/admin/generations` |
| 死信 | 最近 1 小时有任务因队列消息重试耗尽被判失败 | `/admin/generations` |
| 任务积压 | 有任务创建超过 30 分钟仍未完成 | `/admin/generations` |
| 支付回调 | 最近 24 小时有处理失败的支付回调 | `/admin/events` |
| 邮件 | 最近 6 小时有 ≥ 3 封邮件失败或重试 3 次仍未发出（不含告警邮件本身） | `/admin/emails` |

- **去重**：同一类告警每 6 小时（UTC 时间桶）最多发一次，`dedupe_key` 为 `admin_alert:<类型>:<桶>:<管理员邮箱>`。问题持续存在时，下一个时间桶再提醒。
- **死信队列**：主队列消息重试 10 次（约 35 分钟）仍失败会进入 `<name>-jobs-dlq`。同一个 Worker 消费死信队列（`src/server.ts` 按队列名的 `-dlq` 后缀分流），把任务判为失败（`error_code = dead_letter`）并退积分，用户会收到生成失败邮件。新站点要同时创建两个队列（见“部署到 Cloudflare”），`new-site.mjs` 会一并改名。
- 发信本身出问题（域名未验证、配额用完）时告警邮件也可能发不出去，此时以 Workers 日志里的 `[alert]` 为准。需要第二通道时，可以用 Workers Logpush 把日志推到外部监控服务，按 `[alert]` 设置通知。
- **前端错误**：浏览器里未捕获的异常、未处理的 Promise 拒绝和错误页渲染失败，由 `src/lib/error-report.ts` 用 `sendBeacon` 发到 `/api/client-error`，只写 Workers 日志：`[client-error] id=… kind=error|rejection|boundary page=… message=… stack=…`。
  - 错误页显示错误编号，用户反馈时在 Workers Logs 里搜 `id=<编号>` 即可找到堆栈。
  - 日志里邮箱打码，URL 去掉账号密码、query 和 hash，堆栈只留前 6 行；同一页面同一个错误只报一次，每页最多 5 条，接口按 IP 限流。跨域脚本的 `Script error.` 不报。
  - 线上是打包后的代码，堆栈对应压缩文件的行列号；需要还原源码位置或聚合告警时，可以把发送部分换成 Sentry 等平台的 SDK（记得在 `csp.ts` 的 `connect-src` 里放行）。

## 测试

```bash
npm run typecheck
npm test            # vitest：Waffo/Dodo 验签与事件映射、退款比例与退款单号规则、归因解析、生产环境禁用 mock、Turnstile 与图片审核的错误分支、邮件模板与发送重试判定、告警阈值与时间桶、GA4 同意前不加载与撤回删 Cookie、CSP 报告和前端错误上报的摘要与脱敏、登录跳转校验、5xx 详情不对非管理员返回、生产环境拒绝弱 SESSION_SECRET
npm run test:e2e    # Playwright：需要先 npm run seed:local；会复用已运行在 127.0.0.1:3000 的 dev server
E2E_PORT=3200 npm run test:e2e   # 3000 被其它程序占用时换端口
npm run seo:check   # 需要 dev server 在跑；报告写到 .tmp/seo-check/
```

e2e 覆盖（39 个用例）：
- 购买与生成：完整主路径（含中文站路径和 AI 角标）、支付失败、未登录回到结果页（含地址栏去掉邮箱）、余额不足、生成失败退款；3 路轮询并发处理同一任务时只落库一次、成片不被误删，后台显示成本与毛利。
- 合规：
  - 保留期：进行中任务的原图不清理；到期原图不能再用；成片过期返回 410，个人中心显示已过期；重复清理是幂等的。
  - 举报下架：匿名在 `/report` 举报，管理员在后台下架。同一张原图的两条成片都被删除，无关成片保留，重新上传同一张图被拦截；已处理的举报不能再处理，处理结果写入审计。
  - 审核：不通过的上传返回 422。
  - 导出我的数据：设置页下载的 JSON 含本人全部记录，不含他人数据和内部字段；未登录和注销后返回 401。
- 告警与死信：任务进死信后判失败、只退一次积分；健康检查触发失败率和死信告警，同一时间桶重复执行不重发。
- 交易邮件：支付回调重放只发一封、语言跟随用户；生成成功与失败各一封，重复判失败不重发；举报回执、临近截止与超时提醒各一次、下架后通知举报人和作者且不再提醒；留言只提醒管理员；注销清除发件记录；后台邮件页。
- 支付事件与退款：并发和重放支付事件、部分消费后退款、两次部分退款、管理员退款时补登后迟到的同号 webhook 不重复扣。
- 安全与权限：CSRF、伪造上传和越权、后台权限、积分调整和封禁、dev 登录与 mock 支付只接受本机直连；登录后的站外 `redirect` 回退到个人中心，登录页遇到未知错误码（如 `__proto__`）显示通用提示。
- 安全响应头：内联脚本都带本次请求的 nonce；公开页、登录后生成和后台浏览器内零 CSP 违规；注入不带 nonce 的脚本会被报告；报告接口不受同源校验影响。
- 前端错误上报：全局异常和未处理的拒绝各报一次、页面地址不带 query，重复错误不重报，每页最多 5 条；渲染出错时错误页显示的编号与上报一致，接口恢复后点重试回到正常页面。
- 归因与报表：UTM 归因跨会话保持、报表和 CSV。
- SEO：seo-check 全部规则、中英文首页水合、客户端路由切换后 head 同步、语言链接可抓取。

产物在 `.tmp/video-template-e2e/`：`report/`（HTML 报告，含每步截图和 trace）、`results.json`、`test-results/`。

## 目录

```text
src/config/site.ts      每个词要改的配置
src/content/            中英文文案
src/routes/             页面（{-$locale} 为可选语言前缀，admin/ 为后台）
src/server/             API：auth、credits、orders、payments/、video/、jobs（队列、死信与 Cron）、alerts（健康检查告警）、admin、seo、retention、takedown、moderation、turnstile、email（发件箱）、notifications（业务事件 → 邮件）、csp（内容安全策略）、client-error（前端错误上报）
migrations/             D1 迁移
containers/postprocess/ 成片后处理容器：烧录水印、C2PA 签名、封面和预览（实验阶段，Worker 尚未接入，见 ROADMAP）
seed/templates/         生成用的模板源视频
scripts/                new-site（上新词）、seo-check、indexnow、waffo-setup、dodo-setup、webhook-proxy、seed-local、占位素材生成
tests/unit, tests/e2e   测试
```

## 许可证

[MIT](LICENSE)
