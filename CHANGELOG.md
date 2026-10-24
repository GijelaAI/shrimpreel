# Changelog

Notable changes to the template. Derived sites pick them up with `git merge` from upstream (see the `sync-upstream` skill). Earlier changes are in the git history.

中文说明在每条下方。

## 2026-10-25

### Added: multiple dance styles

- A site can offer several dance styles (for example an elf dance and a Christmas party dance). `site.styles[]` replaces `template.id`, `durations[].source`, `site.examples.original/aiVersions/madeWith` and the per-style parts of `site.video.yir.scene`. Each style has its own `id` (written to `generations.template_id`, don't change it once published), `sources` (one source video per `durations[].id`), optional `prompt` (overrides `video.yir.prompt` and `video.nanoapi.prompt`), optional `scene` (yir two-step `{ frame, prompt }`) and its `examples`. The first style is the default. `template` keeps only `aspectRatio` and `fullSeconds`; `site.examples` keeps only `ideas`; `site.video.yir.scene` is now `site.video.yir.sceneImage` (shared `model`, `resolution`, `aspectRatio`, `costCents`, `routingOnly`, always present), and a style runs two-step when its own `scene` is set.
- `POST /api/generations` takes an optional `styleId` (default style when omitted, `400 invalid_style` for an unknown id). `VideoProvider.costCents(durationSeconds, styleId)` adds the scene image cost only for styles with a `scene`.
- UI: with more than one style the generator shows a style picker above the length (`?style=<id>` preselects) and the home hero gets style tabs synced with it; "Made with" shows one row per style. With one style nothing changes. Copy for each style goes in `styles[<id>]` of `src/content/en.ts` and `zh.ts` (`{ name, tagline }`) and `generator.stepStyle`.

Upgrading a site: merge upstream, then in `src/config/site.ts` move `template.id`, `durations[].source`, `examples.original/aiVersions/madeWith` and the `frame`/`prompt` of `video.yir.scene` into `styles[0]` (`id`, `sources` keyed by duration id, `examples`, `scene`); rename the other `video.yir.scene` fields (`model`, `resolution`, `aspectRatio`, `costCents`, `routingOnly`) to `video.yir.sceneImage` (keep the old values; a site without two-step keeps the template defaults). Add `styles: { '<id>': { name, tagline } }` to `en.ts` and `zh.ts`. Existing generations keep working because `template_id` already holds the style id. No new vars, secrets or migrations.

新增多舞蹈风格：一个站点可以提供多种舞（例如精灵舞和圣诞派对舞）。`site.styles[]` 取代 `template.id`、`durations[].source`、`site.examples.original/aiVersions/madeWith` 和 `site.video.yir.scene` 里随风格变化的部分。每种风格有自己的 `id`（写入 `generations.template_id`，发布后不要改）、`sources`（每个时长档位一段源视频）、可选的 `prompt`（覆盖 `video.yir.prompt` 和 `video.nanoapi.prompt`）、可选的 `scene`（yir 两步走的 `{ frame, prompt }`）和 `examples`，第一个是默认风格。`template` 只保留 `aspectRatio` 和 `fullSeconds`，`site.examples` 只保留 `ideas`，`site.video.yir.scene` 改名 `sceneImage`（共用的 `model`、`resolution`、`aspectRatio`、`costCents`、`routingOnly`，始终存在），某个风格设了自己的 `scene` 才走两步。`POST /api/generations` 接受可选的 `styleId`（缺省用默认风格，不存在返回 400 `invalid_style`）；`VideoProvider.costCents(durationSeconds, styleId)` 只对有 `scene` 的风格加合成图费用。界面：多于一种风格时生成器在时长上方出现风格选择（`?style=<id>` 预选），首页 hero 出现与之同步的风格标签，“Made with”每种风格一行；只有一种风格时界面不变。每种风格的文案写在 `en.ts`、`zh.ts` 的 `styles[<id>]`（`{ name, tagline }`）和 `generator.stepStyle`。站点升级：合并 upstream 后，在 `src/config/site.ts` 里把 `template.id`、`durations[].source`、`examples.original/aiVersions/madeWith` 和 `video.yir.scene` 的 `frame`/`prompt` 迁到 `styles[0]`（`id`、按时长 id 索引的 `sources`、`examples`、`scene`）；`video.yir.scene` 的其余字段（`model`、`resolution`、`aspectRatio`、`costCents`、`routingOnly`）改名为 `video.yir.sceneImage`，沿用原值（没用两步走的站点保留模板默认值）；`en.ts`、`zh.ts` 补 `styles`。已有的生成记录不受影响，因为 `template_id` 本来就存风格 id。没有新增 vars、密钥和迁移。

### Added: NanoAPI video provider

- A third optional video provider: `VIDEO_PROVIDER=nanoapi` with the `NANOAPI_API_KEY` secret and `site.video.nanoapi` (`genjutsu-1.0`; `mode` is `motion_control` or `replace_object`, plus `prompt`, `resolution` and `costCentsPerSecond`). The default provider is unchanged.
- NanoAPI has no idempotency key, so before creating a task the provider lists the last 3 hours of tasks and reuses the one with the same photo and source video URLs; a failed list request fails the submit instead of creating blindly. Polling every 30 seconds; the webhook (`/api/webhooks/nanoapi`) is only a "go check now" signal. Account errors (`nanoapi_invalid_api_key`, `nanoapi_insufficient_balance`, `nanoapi_account_suspended`) fire the "Video provider account" alert; the config check and "test connection" cover it.
- Tested with a real key at 480p: one order through the dev server and a tunnel (webhook, R2 copy, actual cost, dedupe list fields). `motion_control` keeps the face and the source scene but the photo's clothes; `replace_object` keeps the source outfit but not the face. Dressing the photo first with an image model and then running `motion_control` gives "you, in costume, dancing"; the template doesn't do that step for NanoAPI. NanoAPI reads the source video with Range requests and a browser User-Agent, so keep bot challenges away from `/media/*`; cut source videos to whole seconds (`replace_object` rounds up). Details in the README under "Video providers".

Upgrading a site: merge upstream. Nothing changes unless you set `VIDEO_PROVIDER=nanoapi`; then set the `NANOAPI_API_KEY` secret and review `site.video.nanoapi`. No new vars or migrations.

新增第三个可选视频服务商 NanoAPI（`VIDEO_PROVIDER=nanoapi`，密钥 `NANOAPI_API_KEY`，配置 `site.video.nanoapi`：`genjutsu-1.0`，`mode` 为 `motion_control` 或 `replace_object`）。NanoAPI 创建任务没有幂等键，所以创建前先列出最近 3 小时的任务，照片和源视频地址都相同就沿用旧任务，列表查不了则提交失败而不是盲目创建。轮询间隔 30 秒，webhook（`/api/webhooks/nanoapi`）只当“该查了”的信号。账户类错误触发“视频服务商账户”告警，配置检查和测试连接已覆盖。已用真实 key 在 480p 实测：经隧道跑通一单（webhook、转存 R2、实际成本、去重列表字段）。`motion_control` 保留人脸和源视频场景，但衣服是照片里的；`replace_object` 保留服装，但人脸不像本人。先用图片模型给照片换装，再跑 `motion_control`，才能做到“本人穿戏服跳舞”，模板的 NanoAPI 接入没有做这一步。NanoAPI 用浏览器 UA 和 Range 请求读源视频，`/media/*` 前面不要加人机验证；源视频剪成整秒（`replace_object` 向上取整）。站点升级：合并 upstream；不设 `VIDEO_PROVIDER=nanoapi` 行为不变，启用时配置 `NANOAPI_API_KEY` 并检查 `site.video.nanoapi`；没有新增 vars 和迁移。

## 2026-10-24

### Fixed: dev server always uses payment test environments

- `LOCAL_DEV_VARS` in `vite.config.ts` now sets `DODO_ENVIRONMENT`, `STRIPE_ENVIRONMENT` and `WAFFO_ENVIRONMENT` to `test`. A live site has `DODO_ENVIRONMENT=live` in `wrangler.jsonc`, so the dev server and `npm run test:sandbox` sent the test key from `.dev.vars` to the live API and checkout failed with HTTP 401. Builds and `wrangler deploy` are unaffected.

Upgrading a site: merge upstream. No new vars, secrets or migrations.

修复：站点上线后 `wrangler.jsonc` 里是 `DODO_ENVIRONMENT=live`，dev server 和 sandbox e2e 会拿 `.dev.vars` 里的 test key 去请求正式环境，下单返回 401。现在 `LOCAL_DEV_VARS` 把三家支付商的环境固定为 `test`，构建和部署不受影响。站点升级：合并 upstream；没有新增 vars、密钥和迁移。

### Fixed: e2e on sites with GA4 configured

- `playwright.config.ts` presets the analytics consent to `denied` in localStorage, so the consent banner no longer covers buttons at the bottom of the page and e2e runs never send hits to the site's real GA4 property. The attribution test grants consent itself and blocks gtag.js. No effect when `analytics.ga4Id` is empty.

Upgrading a site: merge upstream. Test-only change.

修复：站点填了 `analytics.ga4Id` 后 e2e 失败（同意横幅挡住后台按钮、归因 Cookie 要等同意才写）。现在 e2e 默认在 localStorage 预置“拒绝统计”，测试访问也不会发到真实的 GA4；归因用例自己改成同意并拦掉 gtag.js。没配 GA4 时不受影响。站点升级：合并 upstream，只改测试。

### Added: Dodo brand for products

- `node scripts/dodo-setup.mjs --apply --brand <brand_id>` creates the products under a brand of the Dodo business (Settings → Business → Brands). Several sites can share one verified business: each gets its own brand name, logo and statement descriptor on checkout and invoices, while KYC and payouts stay shared. Webhooks are business-level, so every site's endpoint also receives the other sites' events; those are already answered `ignored` with 200 (see docs/payments.md).

Upgrading a site: merge upstream. Only matters when creating Dodo products for a site that is a secondary brand. No new vars, secrets or migrations.

新增 Dodo 品牌：`dodo-setup.mjs --brand <brand_id>` 把商品建在 Dodo business 下这个站的品牌里。多个站可以共用一个已认证的 business，结账页和发票显示各站自己的名字、Logo 和账单描述，KYC 和打款共用。webhook 是 business 级的，每个站都会收到别站的事件，模板已按 `ignored` 回 200。站点升级：合并 upstream；只有给次级品牌建商品时才用得到；没有新增 vars、密钥和迁移。

### Fixed: yir unit tests on sites with `scene` configured

- `tests/unit/yir.test.ts` reset `site.video.yir.scene` and `routingOnly` to `null` before each test and restore the site's values after, so single-step tests no longer fail on a site that enables the two-step mode.

Upgrading a site: merge upstream. Test-only change.

修复：站点配了 `site.video.yir.scene` 后 yir 单步用例会失败。现在每个用例前把 `scene`、`routingOnly` 置空，结束后还原站点配置。站点升级：合并 upstream，只改测试。

### Changed: dev server always uses development vars

- `vite.config.ts` overrides `APP_ENV`, `SITE_URL`, the payment / video / moderation providers, `ADMIN_EMAILS`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID` and `TURNSTILE_SITE_KEY` with development values (`LOCAL_DEV_VARS`) when running `vite dev`. A site can keep production values in `wrangler.jsonc` `vars` and still run local dev, e2e and CI against mock providers and dev sign-in. `.dev.vars` still overrides them for trying a real provider locally. Builds and `wrangler deploy` are unaffected.

Upgrading a site: merge upstream. If your site already had production values in `wrangler.jsonc`, local dev and e2e now run in development mode again; if you had relied on `vars` to point dev at a real provider, move that to `.dev.vars`. No new vars, secrets or migrations.

dev server 一律使用开发值：`vite dev` 时用 `LOCAL_DEV_VARS` 覆盖 `APP_ENV`、`SITE_URL`、支付/视频/审核服务商、`ADMIN_EMAILS`、`EMAIL_FROM`、`GOOGLE_CLIENT_ID` 和 `TURNSTILE_SITE_KEY`，站点的 `wrangler.jsonc` 可以直接写生产值，本地开发、e2e、CI 仍走 mock 和开发登录；要在本地试真实服务商写进 `.dev.vars`。构建和部署不受影响。站点升级：合并 upstream；原来靠 `vars` 让本地连真实服务商的，改写到 `.dev.vars`；没有新增 vars、密钥和迁移。

### Added: two-step yir mode

- `site.video.yir.scene` (`null` by default): an image model first puts the person from the user's photo into the source video's first frame, then Kling Motion Control uses the composite as its reference, so the clip keeps the source video's scene instead of the photo's background.
- The composite is uploaded to the yir Files API and referenced by a fixed `file_id`, so resubmits send the same body and aren't billed twice. Estimated cost adds `scene.costCents` per order.
- Providers can return `{ state: 'pending', next }` from `status()`; `jobs.ts` writes the next provider job back with a compare-and-set on the previous request id, so a webhook and a scheduled poll advancing at the same time write once.
- `npm run seed:local` now uploads `.jpg` files in `seed/templates/` as well as `.mp4`.

Upgrading a site: merge upstream. Nothing changes unless you set `site.video.yir.scene`; then put the frame in `seed/templates/` and upload it to `templates/` in R2 (`--content-type image/jpeg`). No new vars, secrets or migrations.

新增 yir 两步走（`site.video.yir.scene`，默认关闭）：先用图片模型把照片里的人合成进源视频首帧，再用合成图做 Kling 动作参考，成片保留源视频场景。合成图传进 yir Files API，用固定 `file_id` 引用，重复提交不重复计费；每单估算成本加 `scene.costCents`。`status()` 可返回带 `next` 的 pending，jobs.ts 按旧任务 id 抢占写回，webhook 和轮询同时推进只写一次。`seed:local` 同时上传 jpg。站点升级：合并 upstream；不配 `scene` 行为不变，配了要把首帧图放进 `seed/templates/` 并上传到 R2 的 `templates/`；没有新增 vars、密钥和迁移。

### Added: Stripe payments

- `PAYMENT_PROVIDER=stripe`: credit packs and subscriptions through Stripe Checkout, partial refunds from the admin, order reconcile, cancel / resume renewal, and the customer portal. Webhook: `/api/webhooks/stripe`.
- Webhooks are verified with `STRIPE_WEBHOOK_SECRET` and the `livemode` flag must match `STRIPE_ENVIRONMENT`; checkout sessions and invoices are fetched again with a pinned API version before crediting. Subscriptions are credited on `invoice.paid`.
- `scripts/stripe-setup.mjs` creates Products, Prices and the webhook endpoint (re-runs reuse them by lookup key). The launch check compares the key prefix with `STRIPE_ENVIRONMENT`; "Test connections" checks each Price's amount, currency, type and interval.
- Tested in a Stripe sandbox: payment, declined card, partial refund and a monthly subscription (cancel, resume, portal) all pass with real webhooks.
- Stripe is not a Merchant of Record: you handle sales tax and invoices yourself.

Upgrading a site: merge upstream, add `STRIPE_ENVIRONMENT` and `STRIPE_PRODUCTS` to `vars` (already in the template's `wrangler*.jsonc`), and set the two secrets only if the site switches to Stripe. No migration. Setup: [docs/payments.md](docs/payments.md) → "Stripe".

新增 Stripe 支付：积分包、订阅、后台部分退款、主动查单、取消/撤销续费和客户门户。webhook 验签并核对 `livemode`，入账前按固定 API 版本重新取对象，订阅按 `invoice.paid` 入账。`scripts/stripe-setup.mjs` 建商品、价格和 webhook；上线检查核对 Key 前缀，“测试连接”核对每个 Price。已在 Stripe 沙盒用真实 webhook 测通付款、拒付、部分退款和月付订阅。Stripe 不是 MoR，销售税和发票自己处理。站点升级：合并 upstream，`vars` 里加 `STRIPE_ENVIRONMENT`、`STRIPE_PRODUCTS`；只有改用 Stripe 时才需要配两个密钥；没有新迁移。
