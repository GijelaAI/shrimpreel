# ROADMAP

## 当前状态（2026-10-21）

本地全部可用。模板本身不部署上线（2026-10-20 决定），线上验证随第一个热词站进行。下文提到的 `.tmp/` 工件不入库，只在作者本机。

- 已验证：
  - 检查与构建：`npm run typecheck`；`npm test`（85 个单元测试）；`npm run build`。
  - e2e：`npm run test:e2e`（43 个用例全部通过，2026-10-21）。
  - SEO：`npm run seo:check`（20 个页面 0 error）。
- 模板全面评审（2026-10-20）中不需要产品决策的 P0/P1 已在本地完成：
  - 工程：GitHub Actions CI（typecheck、单元测试、build，e2e 单独一个 job 并上传报告；Playwright 在 CI 重试 1 次）；README 改为 upstream remote 的多站升级流程。
  - SEO 与内链：文章改为可扩展集合（`site.articles`）；`/guides` 列表页进入导航和页脚；文章页有相关文章和可见面包屑，价格页面包屑与 BreadcrumbList 一致；FAQ、价格页、联系页链接到文章；语言切换改为可抓取的 `<a hreflang>`；sitemap `lastmod` 按页面取。
  - 性能：`public/_headers` 给 `/assets/*` 长缓存，`/demo/*`、`/og.png` 缓存 7 天；文案按语言拆包，首屏共享 i18n chunk 从 gzip 43.9 kB 降到约 27 kB，另加当前语言 9–10 kB。
  - 无障碍：文字用的强调色加深（`--accent-text`），标题层级、上传控件 label、Logo 可访问名称已修。
  - 运维与安全：告警与死信队列、前端错误上报、错误页只显示错误 ID、CSP（Report-Only）与 Permissions-Policy、后台服务商成本与毛利。
  - 合规：GA4 同意横幅、导出我的数据。
- P0 合规已在本地完成，工件在 `.tmp/template-gaps/`：
  - AI 标识：播放器角标、分享提示，下载文件名带视频 ID。
  - 数据保留：Cron 清理，个人中心显示“已过期”。
  - 举报下架：`/report` 加 `/admin/takedowns`，48 小时队列，按原图哈希删除全部副本并拉黑。
  - 上传审核：OpenAI omni-moderation 或 mock。
  - 联系和举报表单接入 Turnstile；支付结果页从地址栏去掉 `email`。
  - 说明见 README 的“合规与内容安全”。
- P1-9 交易邮件已在本地完成（Cloudflare Email Service，D1 发件箱去重、退避重试、后台邮件页），工件在 `.tmp/transactional-email/`。说明见 README 的“交易邮件”。
- 监控告警已在本地完成：Cron 健康检查（生成失败率、死信、积压、支付回调、邮件），按 6 小时时间桶去重发给 `ADMIN_EMAILS`；死信队列由同一 Worker 消费，判失败并退积分。说明见 README 的“监控告警”。
- GA4 同意横幅已在本地完成：Consent Mode v2 basic 模式，接受前不加载 gtag.js，撤回时删除 `_ga` 系列 Cookie；页脚可重新打开；隐私政策按统计配置自动调整。默认配置不启用 GA4（推荐 Cloudflare Web Analytics），浏览器流程用临时 `ga4Id` 验证过一次。说明见 README 的“合规与内容安全”。
- CSP 与 Permissions-Policy 已在本地完成：页面下发 `Content-Security-Policy-Report-Only`，内联脚本用每次请求的 nonce，违规写 `[csp]` 日志。dev 与生产构建下公开页、生成流程、后台、GA4 同意后加载均为零违规。**仍是 Report-Only**，上线观察无误报后再改为强制执行。说明见 README 的“关键设计”。
- 开源前安全排查（2026-10-20）已在本地完成，报告在 `.tmp/security-audit/report.md`（只在作者本机，不入库）：
  - 已修复：
    - 登录后 `redirect` 的开放重定向，包括 `/\evil`、`/..//evil` 等写法；
    - 登录页 `?error=__proto__` 崩溃；
    - 5xx 的错误详情只返回给管理员；
    - production/staging 拒绝弱 `SESSION_SECRET`；
    - 开发登录和 mock 支付拒绝带 `X-Forwarded-For` 的请求，防止 ngrok 把 Host 改成 localhost 后绕过本机检查；
    - 新增 [SECURITY.md](SECURITY.md)；
    - CI checkout 不保留 Git 凭据。

    回归测试在 `tests/unit/security.test.ts`、`tests/e2e/sign-in.spec.ts` 和 `tests/e2e/attribution.spec.ts`。
  - 核实没有问题：
    - `npm audit` 0 个漏洞；
    - 会入库的文件里没有密钥和个人信息；
    - Google ID token 校验了签名、`iss`、`aud`、`exp` 和 `email_verified`；
    - 邮件模板转义了用户输入；
    - 后处理容器不经 shell 调用 ffmpeg，输入有大小上限。
- 订单与用户数据管理已在本地完成（2026-10-21），工件在 `.tmp/admin-data/`（只在作者本机）：
  - 用户侧：账单显示实付和退款，订单与积分流水分页加载；新增订单详情页 `/dashboard/orders/:id`，可打印，他人订单返回 404。
  - 后台：用户列表加付费、角色筛选和排序，详情页加累计付款、生成统计和审计；新增订单详情页（支付回调、积分、管理员操作、邮件合成时间线，可退款、补单）；订单和生成列表支持按支付商流水号、服务商请求 ID 搜索。
  - 后台列表连续切换筛选时，先发出的请求后返回会覆盖新结果，已改为只采用最后一次请求。
  - 迁移 `0007_admin_lookup.sql` 只加索引，部署前执行 `npm run db:migrate:remote`。
- 成片后处理的技术验证已在本地完成，代码在 `containers/postprocess/`（ffmpeg 烧录水印、c2patool 写 C2PA、封面和 3 秒预览）：
  - Windows 原生 42 项检查通过，包括篡改检测、特殊字符水印、并发 503 和未配置证书时拒绝。
  - 性能和成本：720p 10 秒约 3.2 CPU 秒；每 1000 个任务 $0.13–0.41。
  - 报告和工件在 `.tmp/postprocess/`（`report.md`）。
  - Docker 镜像没有构建过，因为本机 Docker 引擎缺 Virtual Machine Platform；Worker 侧尚未接入。
- workers.dev 预发配置保留但不使用（模板不上线），没有创建资源：
  - 配置文件 `wrangler.staging.jsonc`，用 `APP_ENV=staging` 运行，用法见 README 的“模板预发”。
  - `vite build --mode staging` 加 `wrangler deploy --dry-run` 已确认读取 staging 配置，绑定全部指向 `-staging` 资源。
- Waffo test 模式真实联调已跑通，三笔订单覆盖：
  - 真实收银台支付 → webhook 入账；
  - 部分退款与全额退款 → `refund.succeeded` webhook 回收积分；
  - webhook 丢失时按 `REF_` 补登；
  - 二次退款被 Waffo 以 409 拒绝。

  工件在 `.tmp/template-review/waffo-e2e/`。
- Dodo test 模式真实联调已跑通（商品与 webhook 由 `scripts/dodo-setup.mjs` 创建），三笔订单覆盖：
  - 真实收银台支付 → Svix webhook 入账，metadata 原样回传；
  - 同一笔支付两次部分退款，再退剩余全额 → `refund.succeeded` 按比例回收积分；
  - 同号补登幂等；钱包余额不足时退款被 409 拒绝；
  - 拒付卡 → `payment.failed` → 订单 failed。

  工件在 `.tmp/template-review/dodo-e2e/`。
- 依赖：TanStack Start 1.169、`@cloudflare/vite-plugin` 1.64（miniflare 5 beta）、wrangler 4.151、Vite 8。

## 未验证

- Dodo：`payment.cancelled`、`refund.failed`、争议事件、收银台折扣码；live 模式（需要开通 live payments）。
- Waffo 下单时 `language` 参数是否生效；争议/拒付事件（test 模式无法触发）。
- fal.ai 真实生成：入参和出参按文档实现，没有用真实 `FAL_KEY` 跑过。
- Google OAuth 和 One Tap 的线上回调。
- 合规相关：
  - OpenAI 图片审核没有用真实 `OPENAI_API_KEY` 调用过。请求格式按官方文档实现，单元测试只验证了响应解析。
  - Turnstile 没有用真实站点密钥在浏览器里跑过。服务端校验只有单元测试。
  - R2 生命周期规则还没有在线上 bucket 配置。
- 交易邮件：本地只模拟发送。还没有 Onboard 发信域名、真实发出过邮件，也没有验证垃圾箱投递率和 Gmail/Outlook 的显示效果；需要 Workers Paid。
- Cloudflare 线上部署：D1/R2/KV/Queues/Rate Limiting/Cron 的实际绑定、自定义域名、HSTS、`robots.txt` 和 sitemap 的线上输出、Core Web Vitals。

## 已知问题

- 本地 dev 下，miniflare 5 beta 在 Worker 不读完请求体就返回时，会让同一连接上的下一个请求出错。`src/server.ts` 里的 `drainUnreadBody` 是仅 dev 生效的规避代码。升级 `@cloudflare/vite-plugin` 后可以尝试去掉，再跑 e2e 的 CSRF 用例确认。
- e2e 偶发 `page.goto: net::ERR_ABORTED`：2026-10-20 全量跑出现过 1 次（25/27），之后的全量运行没有复现，根因未查明。已排除两个怀疑点：加载后的第二次导航来自 TanStack history 初始化时的 `replaceState`，视频请求被中止是 `preload="metadata"` 的正常行为。CI 里 Playwright 重试 1 次并保留 trace。
- CI 固定在 `ubuntu-24.04`：`ubuntu-latest` 从 2026-10 起迁往 Ubuntu 26.04，而 Playwright 1.59 不支持它（`playwright install` 报 `does not support chromium on ubuntu26.04-x64`）。升级到支持 26.04 的 Playwright（1.64 已支持）并跑通 e2e 后，把两个 job 改回 `ubuntu-latest`。
- 用隧道联调时，支付商后台的 test webhook 指向临时地址，隧道失效后要更新 URL（Dodo 用 `dodo-setup.mjs --webhook-id`）。
- Dodo 收银台显示的商户名取自注册信息，上 live 前在 Dodo 后台改成品牌名。
- Dodo 回跳 URL 带买家邮箱（`?email=`）。GA4 已过滤，结果页加载后也会从地址栏去掉；但 Worker 访问日志里第一次请求的 URL 仍带邮箱。
- 安全排查中需要产品决策、暂未改动的项：
  - 账号按邮箱合并：同一邮箱换了 Google 账号（`sub` 不同）仍会登录到原账号。Google 建议用 `sub` 而不是邮箱作为唯一标识。
  - 邮箱移出 `ADMIN_EMAILS` 后不会自动降级，要在后台手动取消管理员（README 已写明）。
  - 注销后用同一邮箱重新注册，可以再领一次注册赠送。
  - 支付成功回调不核对实付金额和币种。
  - Google 登录没有用 PKCE，One Tap 没有用 nonce。
  - 举报回执发到举报人填写的邮箱，可被用来给任意地址发回执；有限流和 Turnstile。
  - 上传请求缺少 `Content-Length` 时会整体读入内存；fal 成片下载没有大小上限。
  - `wrangler.jsonc` 默认 `APP_ENV=development`，部署时必须改成 `production`（README 部署第 5 步）。否则 Cookie 不带 Secure，mock 服务商和弱 `SESSION_SECRET` 也不会被拦截。

## 下一步

按 [docs/SAAS_VIDEO_FEATURES.md](docs/SAAS_VIDEO_FEATURES.md) 的“建议顺序”推进：

1. 部署第一个热词站：
   - 上线前决定上文“已知问题”里安全相关的待定项。
   - 线上验证绑定、Google 登录、支付 test webhook，并用 fal 跑一次真实生成。
   - 运行 `npm run seo:check -- --base https://<domain> --production` 和 `/seo-audit https://<domain>`（含 Core Web Vitals）。
2. P0 剩余项：
   - C2PA 加成片内烧录水印：本地技术验证已完成。接下来在 Docker 里实测，再接入 Worker（`POSTPROCESS_PROVIDER`，默认关闭，因为开启后 deploy 需要 Docker 和 Workers Paid）；生产签名证书见 [docs/SAAS_VIDEO_FEATURES.md](docs/SAAS_VIDEO_FEATURES.md) 的 P0-1。
   - 未成年人和名人检测：OpenAI 的图片类别不覆盖这两类。
3. P1：
   - 首单转化：首次免费生成一次带水印的短视频（依赖后处理水印），或增加低价体验包，二选一，都要配额防刷。
   - 成片分享页和缩略图（OG 预览）。UGC 页面默认 noindex，人工挑选后再开放索引。
   - D1 定期导出到 R2 的 Workflow（Time Travel 已覆盖 30 天内恢复，这一项用于更长留存和跨账号灾备）。上线时确认使用 Workers Paid，否则 Time Travel 只有 7 天。
   - 错误追踪：前端错误目前只进 Workers Logs，堆栈是压缩后的行列号；需要 source map 还原或聚合告警时换成 Sentry。
   - `vt_attr` 归因 Cookie 不在同意横幅之后；主要面向欧盟用户时移到同意之后。
   - 订单详情页提供发票下载：Dodo 可由服务端代理 `GET /invoices/payments/{payment_id}`（返回 PDF，每条记录每分钟限 5 次），未实测；Waffo 由支付商直接给买家发收据和发票，没有找到公开的下载接口，详情页继续提示查收邮件。
4. P2（等有数据再定）：每篇文章单独的 og 图、视频 sitemap、`apple-touch-icon` 与 web manifest、海报改 webp/avif、公开页 SSR HTML 边缘缓存、全局每日生成上限、邮箱 magic link 登录、订阅与推荐奖励、营销邮件、后台 webhook 手动重放与复购 cohort。
