# 订阅使用手册

模板默认开着月付和年付订阅，和积分包一起卖。这份手册讲怎么开关、怎么改套餐、在 Dodo、Waffo 或 Stripe 上怎么配，以及用户和后台各能看到什么。入账规则和各支付商的事件差异见 [payments.md](payments.md) 的“订阅”。

## 开关

`src/config/site.ts`：

```ts
subscriptionsEnabled: true as boolean,
plans: [
  { id: 'monthly', interval: 'month', credits: 60, priceCents: 1490, currency: 'USD' },
  { id: 'yearly', interval: 'year', credits: 60, priceCents: 14900, currency: 'USD', highlight: true },
] as readonly SubscriptionPlan[],
```

| | `subscriptionsEnabled: true`（默认） | `false` |
| --- | --- | --- |
| 定价页 | 订阅区 + 积分包 | 只有积分包，标题和副标题改成“一次付费、没有订阅” |
| 条款、退款政策、FAQ | 带订阅条款 | 订阅相关段落全部隐藏 |
| 下单接口 | 接受套餐 ID | 套餐 ID 返回 400 `invalid_package` |
| 已有订阅 | — | 照常续费、发积分、退款；账单页仍能取消续费和打开客户门户 |
| doctor、测试连接、setup 脚本 | 检查和创建套餐商品 | 跳过套餐 |

关掉开关只是不再卖新订阅。已有订阅还会按周期扣款，所以：

- `*_PRODUCTS` 里套餐的商品 ID 要保留，续费事件要靠它核对；
- 支付商的 webhook 不要退订订阅事件（setup 脚本按 `site.plans` 是否为空决定，关掉开关不影响）；
- 想彻底停掉，等老订阅都终止后再把 `plans` 清空，或在支付商后台逐个取消。

`plans` 设为 `[]` 对页面的效果和关掉开关一样，但系统就认不出套餐订单了：还没到账的首付会被当成积分包入账（积分不会当期作废），账单页也找不到套餐信息。只在从来没卖过订阅时这样做。

## 改套餐

- 价格、每月积分、周期在 `plans` 里改，同时在支付商后台建一个新商品（价格不同就是不同的商品），把新商品 ID 写进 `*_PRODUCTS`。老订阅按订阅时锁定的价格续费，不受影响。
- 每月积分（`credits`）是每个月发的量，年付也是按月发：首付发第一个月，Cron 每月补发一次，共 12 次。
- `anchorPriceCents` 只能填真实卖过的价格。年付显示的折扣按“月付 × 12”算，不需要另填。
- 不支持换套餐（升降级）、试用期和暂停。在支付商的客户门户设置里关掉换套餐，否则用户在门户里换了套餐，本站只会按新的扣款金额核对，对不上就转人工。

## 在支付商那边配置

三家都用 setup 脚本建商品，脚本只建 `*_PRODUCTS` 里还没有的商品，重复运行不会重复建：

```bash
node scripts/dodo-setup.mjs --apply --write-dev-vars
node scripts/waffo-setup.mjs --store STO_xxx --apply --write-dev-vars
node scripts/stripe-setup.mjs --apply --write-dev-vars
```

加 `--webhook https://<domain>/api/webhooks/<provider>` 会同时建 webhook 并订阅订阅事件；已有 webhook 时加 `--webhook-id <id>` 改地址和事件列表。

Dodo：

- 订阅商品按套餐周期建，`subscription_period_count` 设为 10 年，也就是最多自动续费 10 年。
- API 密钥的权限：运行时除了积分包需要的 Checkout sessions 和 Refunds 写入、Checkout sessions 和 Payments 读取，订阅还要 **Subscriptions 写入**（取消续费、撤销取消）和 **Customers 写入**（客户门户）；webhook 没带客户 ID 时门户要先查订阅，需要 Subscriptions 读取。少了 Subscriptions 写入时，账单页点“取消续费”会报错，Dodo 返回 403。
- 撤销取消直接调 API，账单页有“继续订阅”按钮。

Waffo：

- 必须配 `WAFFO_STORE_ID`（店铺 ID，`STO_` 开头），客户门户要用。`--write-dev-vars` 会写进 `.dev.vars`，线上用 `wrangler secret put` 或 `scripts/sync-secrets.mjs`。
- 商户 API 只能取消续费，撤销取消要买家在客户门户里操作，账单页会引导用户去门户。
- 订阅首付的成功页文案是 “Subscription successful”，点 Done 跳回本站结果页。

Stripe：

- 套餐对应 recurring Price（`STRIPE_PRODUCTS` 填 `price_...`），首付和续费都按 `invoice.paid` 入账。
- 取消和撤销都调 API（`cancel_at_period_end`），账单页有“继续订阅”按钮。
- 客户门户要先在 Stripe 后台 Settings → Billing → Customer portal 保存一次配置，否则“管理付款”会报错。

## 用户和后台能看到什么

- 定价页：订阅区显示月付、年付和年付折扣；已有有效订阅的用户再下单会被拒（409 `subscription_exists`）。
- 账单页的订阅卡片：状态、每月积分、下次续费日和金额，年付还显示下次发放积分的日期；“取消续费”后显示当期结束日，Dodo、Stripe 有“继续订阅”按钮，Waffo 提示去“管理付款”恢复；扣款失败时提示更新付款方式；“管理付款”打开支付商的客户门户。
- 积分：订阅积分是当期结束作废的批次，生成视频时先扣快到期的。
- 注销账号：订阅还会续费时不能注销（409 `subscription_active`），要先取消续费。
- 后台：用户详情里有订阅表；每次扣款都是一张订单，可以像积分包订单一样查看事件、退款和补单。

## 退款和取消

- 退款只回收这张订单发过的订阅积分（已发放积分 × 退款比例），不碰积分包；年付退款后停止补发。
- 退款不会取消订阅。要停止扣款，在账单页取消续费，或在支付商后台取消。
- 取消续费后本期仍可用，到期后订阅终止，用户可以重新订阅。

## 测试

- 本地（mock 支付）：`npm run test:e2e` 的 `subscriptions.spec.ts` 覆盖月付全流程和年付补发、退款。手动试时从定价页订阅，用 `/api/mock-payments/subscription` 模拟续费、扣款失败、取消等事件，用 `/api/dev/subscription-grants` 把时间往后拨看年付补发（两者只在本机 dev server 可用）。
- 真实支付商：`SANDBOX_WEBHOOK=1` 的 sandbox e2e 有订阅用例，走真实收银台付月付、等 webhook 激活订阅、打开客户门户、取消续费（Dodo、Stripe 还会撤销再取消）。准备步骤见 [payments.md](payments.md) 的“sandbox e2e”。用例最后会取消续费；中途失败时 test 订阅会一直续费，要到支付商后台或账单页手动取消。
- test 模式触发不了续费和扣款失败，这两条只由单元测试和 mock e2e 覆盖。

## 常见问题

- **用户付了钱但没看到订阅？** 订阅状态靠 webhook 同步，先看后台这张订单的事件。首付的积分由结果页查单或 webhook 入账，订阅卡片要等首付事件到达才有。
- **续费订单显示金额不符？** 续费按订阅时锁定的价格核对。支付商后台改了价格、或用户在门户里换了套餐，都会这样。核实后在后台补单，或到支付商后台退款。
- **关掉开关后还想卖给某个人？** 不支持单独放行，临时打开开关再关上即可，已有订阅不受开关影响。
