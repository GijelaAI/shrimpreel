---
name: launch-audit
description: 热词站上线前后的只读体检：本地跑 typecheck、test、build、doctor 和 TODO(site)，对线上地址跑 seo:check、test:smoke、移动端性能和截图，再逐项核对只能人工确认的上线清单（站长平台、真实付款退款、发信域名、R2 生命周期、OAuth 等），写一份带证据的报告并给出“能否上线”的结论。用户说“上线检查”“上线前体检”“launch audit”“看看能不能上线”时使用。
---

# 上线体检

目标：一份 `.tmp/launch-audit/<YYYY-MM-DD>/report.md`。每个检查项都写清楚命令、结果、证据位置和待办，最后给出结论。

全程只读：不部署、不跑 `db:migrate:remote`、不 `wrangler secret put`、不提交 IndexNow、不在线上下单，也不打印任何密钥值。需要做这些写操作时，写进报告的待办，由用户确认后再做。

## 0. 准备

- 确定被测地址：默认 `https://<site.domain>`（`src/config/site.ts`）；用户给了 workers.dev 或预发地址就用用户给的。预发站在 smoke 命令里加 `SMOKE_EXPECT=staging`，并跳过 `--production` 和人工清单里只针对正式站的项。
- 建目录 `.tmp/launch-audit/<日期>/`，记录 `git rev-parse HEAD`、`git status --short`，以及 `npx wrangler whoami` 是否已登录（只记账号名）。
- 工作区有未提交改动时，在报告里注明“线上运行的不一定是当前代码”。

## 1. 本地（部署前）

```bash
D=.tmp/launch-audit/<日期>
npm run typecheck 2>&1 | tee $D/typecheck.log
npm test 2>&1 | tee $D/test.log
npm run build 2>&1 | tee $D/build.log
npm run doctor 2>&1 | tee $D/doctor.log          # 未登录 wrangler 时加 -- --offline
git grep -n "TODO(site)" -- src wrangler.jsonc | tee $D/todo-site.log
```

- 用 `--offline` 跑 doctor 时，secret 名字和远端 migration 都没有核对，报告里标成“未验证”，不要写成通过。
- doctor 的错误都是阻塞项。提醒逐条判断，并写明为什么可以接受。
- 检查 `wrangler.jsonc`：绑定了自定义域名后，`workers_dev` 和 `preview_urls` 都应为 `false`。

## 2. 线上（已部署后）

站点还没部署时，这一节整体标成“未执行”，结论最多给到“部署前检查通过”。

```bash
npm run seo:check -- --base https://<domain> --production     # 报告在 .tmp/seo-check/，复制到 $D
SMOKE_BASE_URL=https://<domain> npm run test:smoke 2>&1 | tee $D/smoke.log   # 报告在 .tmp/smoke-prod/
```

- smoke 只发 GET 和必然被拒的 POST，可以对正式站跑。失败时打开 `.tmp/smoke-prod/report/` 查看 trace，并在报告里写明用例名和原因。不要用 `SMOKE_ALLOW_MOCK`（它只给本机预览用）。
- 再用 curl 补几项只读检查，输出存到 `$D/http.log`：
  - `curl -sI http://<domain>/` 应该跳转到 https。
  - `curl -sI https://www.<domain>/` 的结果和预期的主域名策略一致。
  - 配了 `site.seo.indexNowKey` 时，`https://<domain>/<key>.txt` 应返回 200，内容就是 key。
- 移动端性能（可选，有结果就写进报告）：
  - 首选 PageSpeed Insights API：`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<首页>&strategy=mobile&category=performance&key=$PSI_API_KEY`。不带 key 时用的是共享配额，经常返回 429。
  - 没有 key 时用 `npx lighthouse https://<domain>/ --form-factor=mobile --only-categories=performance --output=json --output-path=$D/lighthouse-mobile.json --chrome-flags="--headless"`。
  - 记录性能分、LCP、CLS、TBT，以及 PSI 返回的真实用户数据（新站通常没有）。
  - 首页移动端性能分低于 70，或 LCP 大于 4 秒，记为待办，不作为阻塞项。
- 截图（可选）：`npx playwright screenshot --device "Pixel 7" --full-page --wait-for-timeout 3000 https://<domain>/ $D/home-mobile.png`（等会话检查完成，否则 CTA 还在转圈）；桌面端去掉 `--device`、加 `--viewport-size "1440,900"`。iPhone 设备默认用 webkit，项目只装了 chromium。中文首页 `/zh` 同样截一张。打开截图看首屏：有没有布局错乱、品牌名、价格和示例视频是不是本站的。

## 3. 人工清单

逐项写成“已确认（证据）”“未确认（怎么确认）”或“不适用”。能只读核对的项自己查，查不到的写成用户的待办，不要猜。

| 项 | 怎么核对 |
| --- | --- |
| Search Console、Bing Webmaster 已验证并提交 sitemap | 问用户，或看 `site.seo` 里的验证码是否已填 |
| IndexNow | key 文件可访问（第 2 节）；`npm run seo:indexnow -- --submit` 由用户决定何时跑 |
| 真实小额付款 + 退款 | 用户用正式店铺买最便宜的积分包，再在后台退款；核对积分到账、回收和两封邮件。不要代替用户下单 |
| 划线原价和评价真实 | `site.packages[].anchorPriceCents` 是真实卖过的原价（欧盟按降价前 30 天内最低价算），不是编出来的高价；页面上的评价、使用人数都有真实来源 |
| 支付商回调地址、收银台商户名 | 对照 README“第三方回调地址”；Dodo 上 live 前商户名改成品牌名 |
| 发信域名已 Onboard、能收到邮件 | 后台 `/admin/emails` 有已发送的记录，或用户收到了付款邮件 |
| 告警邮件能送达 | `ADMIN_EMAILS` 是用户自己的邮箱；后台 `/admin/emails` 能看到告警邮件，或 Workers Logs 里有 `[alert]` |
| R2 生命周期 | `npx wrangler r2 bucket lifecycle list <name>-media`：uploads/ 8 天、outputs/ 31 天，`templates/` 没有规则 |
| R2 模板源视频 | `curl -sI https://<domain>/media/templates/<site.durations[].source>` 每个都返回 200 |
| Turnstile | `TURNSTILE_SITE_KEY` 已填，密钥已由 doctor 核对；用 Cloudflare 控制台确认 hostname 包含本域名 |
| Google OAuth | 同意屏幕已发布（不是 Testing），回调地址已配置；用无痕窗口试一次 Google 登录 |
| 自定义域名与 HTTPS | 第 2 节的 curl 结果；证书有效 |
| 后台概览“上线配置检查” | 管理员登录 `/admin` 看卡片没有问题项（也能查出 `SESSION_SECRET` 太弱） |

## 4. 报告

`report.md` 结构：

1. 结论：
   - **可以上线**：没有阻塞项，人工清单全部确认。
   - **可以上线，有待办**：没有阻塞项，但有未确认的人工项或性能待办。
   - **不能上线**：列出阻塞项。
2. 环境：被测地址、commit、工作区是否干净、wrangler 是否已登录、日期。
3. 各项结果：一张表，列为检查项、命令、结果（通过 / 失败 / 未验证 / 不适用）、证据文件。
4. 阻塞项与待办：每条写清谁来做、怎么做、做完怎么验证。
5. 未验证项及原因。

回复用户时先说结论，再说阻塞项。需要重新部署、迁移或写密钥时，先问用户。
