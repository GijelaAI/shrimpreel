# Changelog

Notable changes to the template. Derived sites pick them up with `git merge` from upstream (see the `sync-upstream` skill). Earlier changes are in the git history.

中文说明在每条下方。

## 2026-10-24

### Added: Stripe payments

- `PAYMENT_PROVIDER=stripe`: credit packs and subscriptions through Stripe Checkout, partial refunds from the admin, order reconcile, cancel / resume renewal, and the customer portal. Webhook: `/api/webhooks/stripe`.
- Webhooks are verified with `STRIPE_WEBHOOK_SECRET` and the `livemode` flag must match `STRIPE_ENVIRONMENT`; checkout sessions and invoices are fetched again with a pinned API version before crediting. Subscriptions are credited on `invoice.paid`.
- `scripts/stripe-setup.mjs` creates Products, Prices and the webhook endpoint (re-runs reuse them by lookup key). The launch check compares the key prefix with `STRIPE_ENVIRONMENT`; "Test connections" checks each Price's amount, currency, type and interval.
- Tested in a Stripe sandbox: payment, declined card, partial refund and a monthly subscription (cancel, resume, portal) all pass with real webhooks.
- Stripe is not a Merchant of Record: you handle sales tax and invoices yourself.

Upgrading a site: merge upstream, add `STRIPE_ENVIRONMENT` and `STRIPE_PRODUCTS` to `vars` (already in the template's `wrangler*.jsonc`), and set the two secrets only if the site switches to Stripe. No migration. Setup: [docs/payments.md](docs/payments.md) → "Stripe".

新增 Stripe 支付：积分包、订阅、后台部分退款、主动查单、取消/撤销续费和客户门户。webhook 验签并核对 `livemode`，入账前按固定 API 版本重新取对象，订阅按 `invoice.paid` 入账。`scripts/stripe-setup.mjs` 建商品、价格和 webhook；上线检查核对 Key 前缀，“测试连接”核对每个 Price。已在 Stripe 沙盒用真实 webhook 测通付款、拒付、部分退款和月付订阅。Stripe 不是 MoR，销售税和发票自己处理。站点升级：合并 upstream，`vars` 里加 `STRIPE_ENVIRONMENT`、`STRIPE_PRODUCTS`；只有改用 Stripe 时才需要配两个密钥；没有新迁移。
