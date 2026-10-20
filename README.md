# ShrimpReel

English | [简体中文](README.zh-CN.md)

Built by [浅水虾 (qianshuixia)](https://x.com/qianshuixia2026).

An open-source template for "one photo → an AI video that follows a viral template" SaaS sites. Every trending keyword gets its own site: create a repo from this template, change the config, copy and media, and ship. Everything runs on Cloudflare: Workers + D1 + R2 + KV + Queues + Rate Limiting + Cron Triggers.

> Status: the full flow works locally (unit tests + Playwright e2e). It has not been deployed as a production site yet; [ROADMAP.md](ROADMAP.md) lists what has and hasn't been verified against real services. Code comments, ROADMAP and `docs/` are currently in Chinese.

- Frontend/SSR: TanStack Start (React 19) + Tailwind 4. English at `/`, Chinese at `/zh`.
- API: Hono (`/api/*`, `/media/*`, `/sitemap.xml`, `/robots.txt`, IndexNow key file); entry point `src/server.ts`.
- Payments: Waffo Pancake (default) or Dodo Payments, both Merchants of Record. `mock` is for local dev and e2e only.
- Video: fal.ai queue API (`mock` for local dev and e2e).
- Included:
  - Users and credits: Google sign-in (including One Tap), credit packs and a credit ledger, dashboard (videos, billing, settings, account deletion, data export).
  - Orders and generation: partial and full refunds that claw back credits, a generation queue with a dead-letter queue, credits returned automatically on failure.
  - Growth: first- and last-touch attribution (UTM and ad click IDs), a visit → sign-up → checkout → paid → generate funnel, GA4 events behind a consent banner.
  - Admin: overview (including provider cost and gross margin), users, orders, generations, takedowns, contact messages, payment events, emails, audit log, reports and order CSV.
  - Transactional email: credits added, video ready, generation failed and refunded, takedown receipts and outcomes; admins get new takedowns, deadline reminders and contact messages (Cloudflare Email Service, outbox with dedupe and retries).
  - Compliance and safety: AI-generated label on videos; photos deleted after 7 days and videos after 30; takedown requests on a 48-hour queue (every video made from the same source photo is removed and the photo is blocked); upload moderation; Turnstile on the contact and report forms.
  - Ops and security: health-check alert emails, browser error reporting to Workers Logs, CSP (Report-Only, per-request nonce) and Permissions-Policy.
  - Content and SEO: one-page home (How it works / What is), an extensible article collection (`/guides` hub, related articles), legal pages, contact form; SSR canonical, hreflang, JSON-LD and sitemap; copy is code-split per locale; `npm run seo:check` lints the whole site.

Feature notes and plans: [docs/SAAS_VIDEO_FEATURES.md](docs/SAAS_VIDEO_FEATURES.md) and [ROADMAP.md](ROADMAP.md). SEO rules, keyword planning and audit results: [docs/SEO_AUDIT.md](docs/SEO_AUDIT.md).

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars       # set at least SESSION_SECRET
npm run seed:local                   # apply D1 migrations and upload seed/templates/*.mp4 to local R2
npm run dev -- --host 127.0.0.1      # http://127.0.0.1:3000
```

- `PAYMENT_PROVIDER=mock` and `VIDEO_PROVIDER=mock` by default: buying opens a mock checkout and generating copies the template video. Nothing is charged.
- Outside production the sign-in page has a "dev login" (`POST /api/auth/dev-login`); in production it returns 404. Dev login, mock payments and `/api/dev/*` only accept direct requests from localhost: anything that came through a tunnel or proxy (with `cf-connecting-ip`, `X-Forwarded-For` or similar headers) gets 404. Someone on your LAN can fake those conditions, so don't start the dev server with `--host 0.0.0.0` or expose it to the internet directly; for webhooks use `scripts/webhook-proxy.mjs` (see below).
- `MODERATION_PROVIDER=mock` by default: an upload form with `mockOutcome=reject` simulates a rejected image. Leave `TURNSTILE_SITE_KEY` empty to disable Turnstile.
- `POST /api/dev/sweep {"days": 8}` (localhost only) runs retention cleanup as if N days had passed, for the signed-in user's media only.
- Addresses in `ADMIN_EMAILS` can open `/admin`; locally that is `admin@example.com`. They are made admins when they sign in, and removing an address later doesn't take the role away: also click "取消管理员" (remove admin) on that user's page under `/admin/users`.
- Email is only simulated locally; check the outbox instead: `GET /api/dev/emails?to=<email>&ref=<order or takedown id>` (localhost only). `POST /api/dev/takedown-reminders {"takedownId": "tdr_…", "hours": 37}` runs the takedown reminder check for one request as if N hours had passed.
- Windows: start with `--host 127.0.0.1`, otherwise Playwright and other tools may resolve `localhost` to IPv6 and fail to connect. Stop the dev server before `npm install`, or locked `.wrangler` / miniflare files cause `EBUSY`.
- `drainUnreadBody` in `src/server.ts` only runs in dev: with the current miniflare 5 beta, a Worker that responds without reading the request body breaks the next request on the same connection (500 `fetch failed`). After upgrading `@cloudflare/vite-plugin`, try removing it and run `npm run test:e2e` to check the CSRF tests.

## Launching a site for a new keyword

Each keyword site is its own repository that tracks this template as `upstream`, so payment, security and framework fixes are made once in the template and merged into every site.

1. **Create the site repo**
   ```bash
   git clone https://github.com/qianshuixia/shrimpreel.git moonhop && cd moonhop
   git remote rename origin upstream
   git remote add origin git@github.com:<owner>/moonhop.git
   ```
   Don't use GitHub's "Use this template": the new repo shares no history with the template, so `git merge upstream/main` won't work later. Forks of a public repo can't be private, so site repos usually aren't forks either.
2. **Run the scaffolder**
   ```bash
   node scripts/new-site.mjs --keyword "Moon Hop" --domain moonhop.ai --keywords "AI dance video,Moon Hop filter"          # dry run
   node scripts/new-site.mjs --keyword "Moon Hop" --domain moonhop.ai --keywords "AI dance video,Moon Hop filter" --write  # write
   ```
   It updates the following, then prints a checklist of what still has to be done by hand:
   - `site.ts`: keyword, brand, domain, email, `template.id`, article slugs, secondary keywords, publish/update dates; it also clears the previous site's verification tokens, IndexNow key and analytics IDs.
   - `wrangler.jsonc`: resource names and the ratelimit `namespace_id`; D1/KV ids are reset to placeholders.
   - `package.json`: `name`.
   - Deletes `wrangler.staging.jsonc` (the template's own staging config).

   Adjust credit packs (`packages`), `durations` and `video.falModel` in `src/config/site.ts` as needed.
3. **Rewrite the copy** in `src/content/en.ts` and `src/content/zh.ts`. Copy uses variables such as `{keyword}`. For every keyword, rewrite at least hero, whatIs, ideas, FAQ and both articles, and cover the secondary keywords naturally in the home page body. Swapping only the keyword across the whole site can be treated by Google as [scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content).
   - **Articles**: add an entry to `articles` in `site.ts` (`key`, `slug`, publish and update dates, optional `related`), then add the same key under `articles` in every locale's content file; typecheck fails if one is missing. The article lives at `/<slug>` and is added to `/guides`, the sitemap and other articles' related links automatically. `trend` and `howTo` are linked from the home page; keep them. Aim for at least one pillar page of 1,200+ words plus 4–6 long-tail pages (tutorials, ideas, troubleshooting, comparisons) per site.
   - Copy is code-split per locale, so the browser only downloads the current language (legal pages included). Components call `getContent(locale)` as usual; only code that needs copy outside the root route and before rendering has to `await loadContent(locale)` first.
   - Adding a locale: register it in `LOCALES` and `LOCALE_META` in `site.ts`, create `src/content/<locale>.ts` (same type as `en.ts`), and add a dynamic import to `loaders` in `src/lib/i18n.ts`. Email templates are typed per locale as well, so typecheck lists what else needs translating.
4. **Replace the media**
   - `seed/templates/<template.id>-<seconds>s.mp4`: source videos for generation; upload them to `templates/` in R2 after deploying.
   - `public/demo/*`: home page demo videos and posters. They must be your own or licensed, with the source credited in `site.examples.*.credit`.
   - `public/og.png`, `public/favicon.svg`.
   - `node scripts/generate-placeholder-media.mjs` (requires ffmpeg) regenerates original placeholder media.
5. **Set `vars` in `wrangler.jsonc`**: `SITE_URL`, `APP_ENV=production`, `PAYMENT_PROVIDER`, `VIDEO_PROVIDER`, `MODERATION_PROVIDER`, `TURNSTILE_SITE_KEY`, `ADMIN_EMAILS`, `EMAIL_FROM`, `*_PRODUCTS`, `GOOGLE_CLIENT_ID`; write the D1/KV ids back after creating the resources (see below).
6. **Create products with your payment provider**: one one-time product per credit pack, with the product ids in `WAFFO_PRODUCTS` or `DODO_PRODUCTS`, e.g. `{"starter":"prod_xxx","party":"prod_yyy","squad":"prod_zzz"}`. For Waffo, `node scripts/waffo-setup.mjs --store STO_xxx --apply` creates them in bulk; for Dodo, `node scripts/dodo-setup.mjs --apply --write-dev-vars` (add `--webhook <url>` to also create the webhook and write its signing secret to `.dev.vars`). Prices on the site are display-only; the provider's dashboard is what actually gets charged, so keep them in sync.
7. **Verify locally**: `npm run typecheck && npm test && npm run test:e2e && npm run seo:check`, then deploy.
8. **After launch**
   - Run `npm run seo:check -- --base https://<domain> --production`.
   - Verify the site in Search Console and Bing Webmaster Tools and submit `https://<domain>/sitemap.xml`.
   - If `site.seo.indexNowKey` is set, run `npm run seo:indexnow -- --submit`.

### Merging template updates into a site

```bash
git fetch upstream
git merge upstream/main
npm install && npm run typecheck && npm test && npm run test:e2e
npm run db:migrate:remote   # before deploying, if the template added files to migrations/
```

- Keep site-specific changes in `src/config/site.ts`, `src/content/*`, `public/*`, `seed/`, `wrangler.jsonc` and the `name` in `package.json`. Keep everything else identical to the template: fix shared code in the template and merge it into each site rather than patching one site.
- When those files conflict, keep the site's values and take the template's new keys; typecheck reports missing copy keys.
- If the template changed `wrangler.staging.jsonc`, the site gets a modify/delete conflict; resolve it with `git rm wrangler.staging.jsonc`.

## Deploying to Cloudflare

Create the resources once per site (names must match `wrangler.jsonc`):

```bash
npx wrangler d1 create <name>                  # put the database_id in wrangler.jsonc
npx wrangler r2 bucket create <name>-media
npx wrangler kv namespace create <name>-kv     # put the id in wrangler.jsonc; titles are unique per account, don't call them all KV
npx wrangler queues create <name>-jobs
npx wrangler queues create <name>-jobs-dlq
npm run db:migrate:remote
npx wrangler r2 object put <name>-media/templates/<file>.mp4 --file seed/templates/<file>.mp4 --content-type video/mp4 --remote
```

- `ratelimits[].namespace_id` must be unique within an account; don't share the same numbers across sites.
- Set secrets with `npx wrangler secret put <NAME>`: `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`, `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `FAL_KEY`; optionally `OPENAI_API_KEY` (image moderation) and `TURNSTILE_SECRET_KEY`.
  - `SESSION_SECRET` signs the photo URLs given to the video provider and the fal callback token. Generate it with `openssl rand -hex 32`. In production and staging, a missing value, one shorter than 32 characters or the value from `.dev.vars.example` is refused: jobs can't be submitted (they are failed and refunded after the queue retries, and Workers Logs names the cause) and `/media/uploads/*` returns 503.
- Also add the R2 lifecycle rules described under "Compliance and content safety".
- The sending domain must be onboarded in Email Service; see "Transactional email".
- Deploy with `npm run deploy`. Attach a custom domain to the Worker in the Cloudflare dashboard; `SITE_URL` and `site.domain` must match it (canonical URLs, the sitemap and the CSRF same-origin check depend on it).
- With `APP_ENV=production` or `staging`, checkout, generation and upload return 503 if they are still configured with `mock`, and dev login returns 404. `robots.txt` only allows crawling in production.
- Once the custom domain works, set `"workers_dev": false` and `"preview_urls": false` in the site's `wrangler.jsonc`. Otherwise the production Worker also answers on `*.workers.dev`, outside any WAF or rate-limiting rules on your domain, and each version gets a public [Version URL](https://developers.cloudflare.com/workers/configuration/previews/) that runs that version's code with the same D1 and R2. The template ships with `workers_dev` on so a new site is reachable before its domain is attached.

### Template staging (workers.dev)

Without a domain, [wrangler.staging.jsonc](wrangler.staging.jsonc) deploys the template itself to `https://video-template-staging.<subdomain>.workers.dev` to check real bindings, Google sign-in, payment providers in test mode and fal callbacks.

- `APP_ENV=staging`: like production, mocks and dev login are disabled and cookies are Secure, but `robots.txt` blocks crawling. Canonical URLs still point at `site.domain`.
- All resource names end in `-staging`, separate from the production site. `tests/unit/staging.test.ts` checks that its bindings and var keys match `wrangler.jsonc`. new-site deletes this file.
- No transactional email (`EMAIL_FROM` is empty) and no image moderation by default (`MODERATION_PROVIDER=none`).

```bash
npx wrangler d1 create video-template-staging                # put the database_id in wrangler.staging.jsonc
npx wrangler r2 bucket create video-template-staging-media
npx wrangler kv namespace create video-template-staging-kv   # put the id in wrangler.staging.jsonc
npx wrangler queues create video-template-staging-jobs
npx wrangler queues create video-template-staging-jobs-dlq
npx wrangler r2 bucket lifecycle add video-template-staging-media expire-uploads uploads/ --expire-days 8
npx wrangler r2 bucket lifecycle add video-template-staging-media expire-outputs outputs/ --expire-days 31
npx wrangler d1 migrations apply DB --remote -c wrangler.staging.jsonc
npx wrangler r2 object put video-template-staging-media/templates/<file>.mp4 --file seed/templates/<file>.mp4 --content-type video/mp4 --remote
npx vite build --mode staging && npx wrangler deploy         # deploy reads the staging config from the build output
npx wrangler secret put <NAME> -c wrangler.staging.jsonc     # or secret bulk, reading JSON from stdin
```

- Except for `deploy`, pass `-c wrangler.staging.jsonc` to every staging wrangler command: without it, commands such as `deploy` follow the config of the most recent build. `npm run deploy` rebuilds with `wrangler.jsonc` first.
- For the callback URLs below, replace `<domain>` with the workers.dev host. Use only test stores with Waffo and Dodo.

### Third-party callback URLs

| Service | Where | URL |
| --- | --- | --- |
| Google OAuth | Google Cloud Console → Authorized redirect URIs | `https://<domain>/api/auth/google/callback` |
| Waffo Pancake | Dashboard → Settings → Webhooks | `https://<domain>/api/webhooks/waffo` |
| Dodo Payments | Dashboard → Webhooks | `https://<domain>/api/webhooks/dodo` |
| fal.ai | Added by the code | `https://<domain>/api/webhooks/fal` |

- **Waffo**: `WAFFO_ENVIRONMENT` is `test` or `prod`. Webhooks are verified with Waffo's public RSA key (bundled in `src/server/payments/waffo.ts`), so no secret is needed. `WAFFO_PRIVATE_KEY` accepts PKCS1/PKCS8 and can be a single line with `\n`.
  - Refunds are asynchronous: the admin action only returns a ticket `TKT_`; the PSP creates `REF_` and sends `refund.succeeded` later, which took 12–22 minutes in test mode. Credits are clawed back when the webhook arrives.
  - Each payment can be refunded once (partial allowed), within 14 days of payment. The admin blocks this up front with `waffo_refund_exists` / `refund_window_expired`.
  - If a webhook is lost, use "record only" with the `REF_` refund id (`TKT_` is rejected, otherwise the late webhook would claw back credits a second time).
  - Webhooks are delivered by Upstash QStash and retries only go to the URL set at creation, so use a stable domain.
- **Testing real webhooks locally**: `node scripts/webhook-proxy.mjs --port 3100` forwards only `POST /api/webhooks/{waffo,dodo}`; point the tunnel at it instead of exposing the dev server. Pinggy works (`ssh -p 443 -R0:127.0.0.1:3100 qr@a.pinggy.io`, 60 minutes on the free plan); localhost.run dropped often.
- **Dodo**: `DODO_ENVIRONMENT` is `test` or `live`. Webhooks are verified per Standard Webhooks; `DODO_WEBHOOK_SECRET` is the `whsec_...` value from the dashboard.
  - API keys are scoped per resource: `dodo-setup.mjs` needs Products write, plus Webhooks write with `--webhook`; at runtime the key needs Checkout sessions and Refunds write.
  - Merchants can refund within 30 days of payment, in several partial refunds, but only one at a time ([docs](https://docs.dodopayments.com/features/transactions/refunds)). After 30 days the admin returns `refund_window_expired`.
  - Refunds are paid from the merchant wallet. Each payment is credited only after taxes and fees, which took about 4–5 minutes in test mode. With an insufficient balance Dodo returns 409 "Insufficient funds in wallet", shown in the admin as `payment_provider_conflict`. Full refunds on a new store or right after a payout often fail for this reason.
  - In test mode the refund API returns `succeeded` immediately and `refund.succeeded` arrives about 2 seconds later. Credits are still clawed back on the webhook.
  - Webhooks are delivered by Svix. Payment events echo the metadata (`orderId` etc.); refund events don't, so the order is looked up by `payment_id`. If the tunnel changes domain, update the URL with `--webhook-id`; the signing secret stays the same.
  - Both successful and failed payments return to `return_url` with `payment_id`, `status` and `email` (the buyer's email) appended. GA4's `page_location` has the email stripped.
  - The merchant name on the checkout comes from your Dodo business registration; change it to the brand name before going live.
- **fal**: the webhook is only a "go check now" signal; results are always fetched again with `FAL_KEY`. A Cron every 5 minutes also polls stuck jobs and fails them (with a credit refund) after 45 minutes.

## Design notes

- **Credits**: `users.credits` is a cached balance of `credit_ledger`, with `CHECK (credits >= 0)`. Every change writes a ledger entry with a unique `idempotency_key` (`order:<id>`, `order_refund:<id>`, `generation:<id>`, …) in the same D1 batch as the balance update, so a duplicate credit rolls back as a whole.
- **Payment events**: `payment_events (provider, event_id)` is unique. Replays, concurrent retries and a late "paid" after a refund all take effect once. Refunds claw back `MIN(balance, credits in the pack)` and the ledger records what was actually deducted.
- **Generation**: credits are deducted before enqueueing and returned automatically on failure, timeout or when an admin fails the job. The fal webhook and the poller may handle the same job concurrently; only one of them can mark it succeeded, and the other never deletes the stored video.
- **Cost and margin**: when a video is produced, the provider cost is estimated from the prices in `site.video` and stored in `generations.provider_cost_cents`.
  - fal bills per frame: 16 frames count as one video second, $0.04 per video second at 480p ([pricing](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace)). The template source videos are 24fps, so a video costs 6¢ per second, about $1.08 for 18 seconds. Update `costCentsPerVideoSecond` and `sourceFps` when changing the model, resolution or source frame rate.
  - Jobs failed after a video was produced (timeout, failed by an admin) still record the cost; failures without a video don't. mock records 0.
  - The admin overview shows the last 30 days of provider cost, revenue from credits consumed and estimated gross margin; the generations list shows cost and margin per job. Revenue per credit = net revenue of paid USD orders ÷ credits not clawed back. The provider's invoice is the source of truth.
- **Security**: non-GET `/api/*` requests (except webhooks, CSP reports and browser error reports) must have an `Origin` matching the site; uploads are type-checked by magic bytes; uploads and generation are rate-limited per user; banning a user invalidates their sessions immediately; admin actions are written to `admin_audit`.
  - The `redirect` after sign-in (sign-in page and Google callback) only accepts same-site paths: `src/lib/redirect.ts` rejects backslashes, control characters and anything that normalizes to a leading `//`, so links like `/sign-in?redirect=/\evil.com` land on the dashboard.
  - For 5xx errors only admins get the `message`; everyone else gets just the error code, and the details go to Workers Logs as `[api] <method> <path> <code>: <message>`.
  - To report a vulnerability, see [SECURITY.md](SECURITY.md).
- **CSP**: pages are served with `Content-Security-Policy-Report-Only`; the policy lives in `src/server/csp.ts`.
  - A nonce is generated per request (`src/server.ts` → `ssr.nonce` in `src/router.tsx`) and added to every inline script the framework emits; `script-src` does not allow `'unsafe-inline'`. Put custom inline scripts in `headScripts()` in `__root.tsx` instead of writing `<script>` directly.
  - GA4, Cloudflare Web Analytics, Turnstile and Google sign-in are allowed per their official docs; add sources to `csp.ts` when adding third-party scripts, iframes or APIs.
  - Violation reports go to `/api/csp-report` and are only written to Workers Logs as `[csp] <directive> blocked=… page=…` (URLs without query, rate-limited per IP). Once production has run for a while without false positives, change the header name in `server.ts` to `Content-Security-Policy` to enforce it.
  - Every response has a `Permissions-Policy` that disables camera, microphone, geolocation, payment and USB.

## Compliance and content safety

- **AI label**: the generator and dashboard players show an "AI-generated" badge, with a note to keep the label when sharing. Downloads are named `<brand>-ai-video-<video id>.mp4`, so a reporter can identify a video by its file name. Videos have no burned-in watermark and no C2PA manifest yet (requires Containers; see [FEATURES P0-1](docs/SAAS_VIDEO_FEATURES.md)).
- **Retention**: controlled by `site.retention`; photos are kept 7 days and videos 30 by default, and the privacy policy reads both numbers.
  - The 5-minute Cron deletes expired R2 objects and sets `expired_at` in D1, up to 90 per type per run. Photos used by in-progress jobs are kept.
  - Expired items show as "Expired" in the dashboard and the video API returns 410 `media_expired`. Orders and the credit ledger are unaffected.
  - R2 lifecycle rules act as a backstop, one day longer than the code so they never delete before D1 is marked. Don't add a rule for `templates/`.
    ```bash
    npx wrangler r2 bucket lifecycle add <name>-media expire-uploads uploads/ --expire-days 8
    npx wrangler r2 bucket lifecycle add <name>-media expire-outputs outputs/ --expire-days 31
    ```
- **Takedowns**: "Report content" in the footer opens `/report`; no account needed.
  - Fields: signature, email, content locator, reason, non-consent statement. Submissions go to `takedown_requests` with a deadline 48 hours later (`site.takedownSlaHours`). A `gen_` video id in the locator is linked automatically.
  - Admins handle them at `/admin/takedowns`; the overview shows pending and overdue counts.
  - Removal finds every upload and video made from the same photo by its SHA-256, then:
    - fails in-progress jobs and refunds credits;
    - deletes the R2 objects and sets `removed_at`;
    - adds the hash to `blocked_media`, so uploading the same image again returns 422 `content_rejected`.
  - Rejection requires a reason.
  - Both outcomes are written to `admin_audit`. `ADMIN_EMAILS` gets an email for new reports, 12 hours before the deadline and when overdue (see "Transactional email"), but someone still needs to check the queue daily.
- **Upload moderation**: chosen with `MODERATION_PROVIDER`. Moderation runs before writing to R2; rejected images are never stored and no credits are spent.
  - `openai`: OpenAI `omni-moderation-latest` (free), requires `OPENAI_API_KEY`. Blocks the sexual, violence/graphic and self-harm categories. Uploads are refused with 503 if the API fails.
  - `none`: no moderation.
  - `mock`: non-production only.
  - Minors and public figures are not OpenAI image categories; those still rely on the consent statement and takedowns.
- **Turnstile**: create a widget in the Cloudflare dashboard, put the site key in `vars.TURNSTILE_SITE_KEY`, then run `npx wrangler secret put TURNSTILE_SECRET_KEY`.
  - It only protects the anonymous contact and report forms. Sign-in and generation rely on Google sign-in plus rate limits; add it there when offering a free trial.
  - With a site key but no secret, both forms return 503 instead of silently letting requests through.
- **Analytics and cookies**: configured in `site.analytics`; the "Cookies and analytics" section of the privacy policy adapts to it.
  - Recommended: only set `cfBeaconToken` (Cloudflare Web Analytics), which sets no cookies and needs no consent banner.
  - GA4 is only enabled when `ga4Id` is set, together with a consent banner and a "Cookie settings" footer link. It uses Consent Mode v2 basic: gtag.js isn't loaded until the visitor accepts, events only go to `dataLayer`, and ad consent is always denied. Declining or withdrawing deletes `_ga`, `_ga_*` and `_gid` (on the current host and each parent domain). The choice is stored as `consent.analytics` in `localStorage`; see `src/lib/consent.ts`.
  - Attribution uses a first-party cookie `vt_attr` (90 days) that is not behind the consent banner. Under a strict reading of the EU ePrivacy Directive, non-essential first-party cookies also need prior consent; if you mainly serve EU users, move it behind consent too.
- **Export my data** (GDPR Art. 15 and 20): the dashboard settings page downloads JSON (`GET /api/account/export`) with the account, sessions, orders, credit ledger, uploads and generations, contact messages, the user's own takedown reports and email log; rate-limited per user. It excludes R2 paths, provider request ids, internal errors and costs, and reports others filed against the user's videos. Media files aren't bundled; those still within retention can be downloaded from the dashboard. Field list: `src/server/account-export.ts`.
- **Database backups**: D1 Time Travel restores to any point in the last 30 days (7 on Workers Free), but restoring overwrites the database in place: `npx wrangler d1 time-travel restore <db> --timestamp=<unix>`. For long-term copies, export regularly with `npx wrangler d1 export <db> --remote --output backup-<date>.sql`; an automated Workflow that exports to R2 doesn't exist yet.

## Transactional email

Sent directly from the Worker with [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) (public beta): the `send_email` binding is `EMAIL` and the sender is `vars.EMAIL_FROM`.

- **To users**: credits added, video ready (with the retention date), generation failed and refunded, takedown receipt, takedown outcome, video removed after a report. The language follows the UI language of the user's latest order or generation; takedown emails use the language of the report page. Deleted or banned users get nothing.
- **To admins** (`ADMIN_EMAILS`, in Chinese): new takedown; one reminder 12 hours before the deadline and one when overdue; new contact message (Reply-To is the sender). Senders don't get an auto-reply, so the form can't be used to email arbitrary addresses.
- **Delivery**: business events are first written to the D1 `email_outbox` table with a unique `dedupe_key` (e.g. `order_paid:<order id>`), so webhook replays, queue redelivery and overlapping Crons send one email.
  - Emails are sent right after being written. On rate limits, daily quota or server errors they back off 5, 15, 45… minutes, up to 5 attempts, retried by the 5-minute Cron; permanent errors such as an unverified sender fail immediately.
  - Delivery is at-least-once: if the Worker stops after sending but before saving the status, an email may be sent twice.
  - The outbox is kept 30 days; a user's records are deleted with their account.
- **Admin**: `/admin/emails` searches by recipient, order id or takedown id and can resend failed or unsent emails; the overview shows the failure count.
- **Going live**:
  1. Cloudflare dashboard → Compute > Email Service → Onboard Domain, add the site's domain (DNS must be on Cloudflare) and add the SPF/DKIM records it shows.
  2. Sending to arbitrary recipients requires Workers Paid. 3,000 emails a month are included, then $0.35 per thousand ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).
  3. Set `vars.EMAIL_FROM` to `noreply@<domain>` (`new-site.mjs` does this), then run `npm run db:migrate:remote`.
- With `EMAIL_FROM` empty or no binding, nothing is sent and emails are marked "not sent"; resend them from the admin once configured. Local `wrangler dev` only simulates sending; don't add `"remote": true` to the binding.

## Monitoring and alerts

A health check (`src/server/alerts.ts`) runs on the 5-minute Cron. When a threshold is crossed it emails `ADMIN_EMAILS` (in Chinese) and writes `console.error('[alert] …')` to Workers Logs:

| Alert | Condition | Admin page |
| --- | --- | --- |
| Generation failure rate | In the last hour, ≥ 3 failed jobs and ≥ 30% of finished jobs (excluding manual admin failures and takedowns) | `/admin/generations` |
| Dead letters | A job was failed in the last hour because its queue message ran out of retries | `/admin/generations` |
| Backlog | A job created more than 30 minutes ago is still unfinished | `/admin/generations` |
| Payment webhooks | A payment webhook failed to process in the last 24 hours | `/admin/events` |
| Email | In the last 6 hours, ≥ 3 emails failed or are still unsent after 3 attempts (alert emails excluded) | `/admin/emails` |

- **Dedupe**: each alert type is sent at most once per 6-hour UTC bucket, with `dedupe_key` `admin_alert:<type>:<bucket>:<admin email>`. If the problem persists, it alerts again in the next bucket.
- **Dead-letter queue**: a message that still fails after 10 retries (about 35 minutes) goes to `<name>-jobs-dlq`. The same Worker consumes it (`src/server.ts` routes by the `-dlq` suffix), fails the job (`error_code = dead_letter`) and refunds credits; the user gets a generation-failed email. New sites need both queues (see "Deploying to Cloudflare"); `new-site.mjs` renames both.
- If email itself is broken (unverified domain, quota exhausted), alert emails may not go out either; Workers Logs `[alert]` lines are the source of truth. For a second channel, push logs to an external monitoring service with Workers Logpush and alert on `[alert]`.
- **Browser errors**: uncaught exceptions, unhandled promise rejections and error-page render failures are sent by `src/lib/error-report.ts` with `sendBeacon` to `/api/client-error`, which only writes to Workers Logs: `[client-error] id=… kind=error|rejection|boundary page=… message=… stack=…`.
  - The error page shows an error ID; search Workers Logs for `id=<ID>` to find the stack trace when a user reports it.
  - Emails are masked, URLs lose credentials, query and hash, and stacks keep the first 6 frames. Each distinct error is reported once per page, at most 5 per page, and the endpoint is rate-limited per IP. Cross-origin `Script error.` is ignored.
  - Production code is bundled, so stack traces point at minified line/column numbers. To map them to source or aggregate alerts, swap the sending code for an SDK such as Sentry (and allow it in `connect-src` in `csp.ts`).

## Testing

```bash
npm run typecheck
npm test            # vitest: Waffo/Dodo signatures and event mapping, refund ratios and refund id rules, attribution parsing, mocks disabled in production, Turnstile and moderation error paths, email templates and retry decisions, alert thresholds and buckets, GA4 not loading before consent and cookie removal on withdrawal, CSP report and browser error summaries and redaction, sign-in redirect validation, 5xx details hidden from non-admins, weak SESSION_SECRET refused in production
npm run test:e2e    # Playwright: run npm run seed:local first; reuses a dev server already running on 127.0.0.1:3000
E2E_PORT=3200 npm run test:e2e   # use another port when 3000 is taken
npm run seo:check   # needs the dev server running; writes its report to .tmp/seo-check/
```

e2e coverage (39 tests):
- Purchase and generation: the full main path (including the Chinese site and the AI badge), failed payment, returning to the result page signed out (with the email stripped from the address bar), insufficient credits, refund on failed generation; three pollers handling the same job concurrently store it once without deleting the video, and the admin shows cost and margin.
- Compliance:
  - Retention: photos used by in-progress jobs are kept; expired photos can't be reused; expired videos return 410 and show as expired in the dashboard; repeated cleanup is idempotent.
  - Takedowns: an anonymous report at `/report`, removed by an admin. Both videos from the same photo are deleted, unrelated videos are kept, and re-uploading the photo is blocked; a handled report can't be handled again, and the outcome is audited.
  - Moderation: rejected uploads return 422.
  - Data export: the JSON downloaded from settings contains all of the user's records and none of other users' data or internal fields; 401 when signed out or after account deletion.
- Alerts and dead letters: a dead-lettered job is failed and refunded once; the health check raises failure-rate and dead-letter alerts and doesn't resend within the same bucket.
- Transactional email: replayed payment webhooks send one email in the user's language; one email each for success and failure, none for a repeated failure; takedown receipt, one deadline and one overdue reminder, notifying the reporter and the creator after removal and no further reminders; contact messages only notify admins; account deletion clears the email log; the admin email page.
- Payment events and refunds: concurrent and replayed payment events, refunds after partial use, two partial refunds, a late webhook with the same refund id after a manual record doesn't claw back twice.
- Security and permissions: CSRF, forged uploads and access to other users' data, admin permissions, credit adjustments and bans, dev login and mock payments only accepted from localhost; off-site `redirect` values after sign-in fall back to the dashboard, and unknown error codes on the sign-in page (such as `__proto__`) show the generic message.
- Security headers: every inline script carries the request's nonce; zero CSP violations across public pages, a signed-in generation and the admin; an injected script without a nonce is reported; report endpoints aren't subject to the same-origin check.
- Browser error reporting: global errors and unhandled rejections are reported once each without the query string, duplicates aren't re-sent, at most 5 per page; on a render error, the ID on the error page matches the report, and "Try again" recovers once the API is back.
- Attribution and reports: UTM attribution persists across sessions; reports and CSV.
- SEO: every seo-check rule, hydration of the English and Chinese home pages, head updates after client-side navigation, crawlable language links.

Artifacts go to `.tmp/video-template-e2e/`: `report/` (HTML report with screenshots and traces for every step), `results.json` and `test-results/`.

## Project layout

```text
src/config/site.ts      per-site config
src/content/            English and Chinese copy (one chunk per locale)
src/routes/             pages ({-$locale} is the optional locale prefix, admin/ is the admin)
src/server/             API: auth, credits, orders, payments/, video/, jobs (queue, dead letters, Cron), alerts, admin, seo, retention, takedown, moderation, turnstile, email (outbox), notifications (events → email), csp, client-error
migrations/             D1 migrations
containers/postprocess/ post-processing container: burned-in watermark, C2PA signing, cover and preview (experimental, not wired into the Worker yet; see ROADMAP)
seed/templates/         source videos for generation
scripts/                new-site, seo-check, indexnow, waffo-setup, dodo-setup, webhook-proxy, seed-local, placeholder media
tests/unit, tests/e2e   tests
```

## License

[MIT](LICENSE)
