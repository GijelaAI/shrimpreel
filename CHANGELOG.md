# Changelog

Notable changes to the template. Derived sites pick them up with `git merge` from upstream (see the `sync-upstream` skill). Earlier changes are in the git history.

中文说明在每条下方。

## 2026-10-24

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
