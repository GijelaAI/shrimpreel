import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { findDuration, findPackage, isLocale, localePath, site } from '#/config/site'
import { safeRedirectPath } from '#/lib/redirect'
import { exportFileName, exportUserData } from './account-export'
import { adminRoutes } from './admin'
import { runHealthCheck } from './alerts'
import { classifyTouch, deviceFromUserAgent, requestAttribution, sanitizeTouch } from './attribution'
import { endSession, loadSessionUser, publicUser, startSession, upsertUser } from './auth'
import { CLIENT_ERROR_PATH, summarizeClientError } from './client-error'
import { clawbackStatements, ledgerStatements } from './credits'
import { CSP_REPORT_PATH, summarizeCspReports } from './csp'
import { exchangeGoogleCode, googleAuthRedirect, googleClientId, googleOAuthConfig, verifyGoogleIdToken } from './google'
import { publicGeneration, publicOrder, rateLimit, readJson, requireUser, pageParams } from './http'
import { enqueueJob, failGeneration, handleDeadLetter, handleVideoJob } from './jobs'
import { jobToken, serveR2Object, sniffImageType, verifyUploadSignature } from './media'
import { getModerationProvider } from './moderation'
import { processPaymentEvent } from './orders'
import { seoRoutes } from './seo'
import { notifyContactMessage, runTakedownReminders } from './notifications'
import { normalizeDodoEvent, verifyDodoWebhook } from './payments/dodo'
import { getPaymentProvider } from './payments'
import type { PaymentEvent } from './payments/types'
import { WebhookVerificationError } from './payments/types'
import { normalizeWaffoEvent, verifyWaffoWebhook, waffoEnvironment } from './payments/waffo'
import { sweepExpiredMedia } from './retention'
import { createTakedown, isBlockedMedia, parseTakedown, type TakedownInput } from './takedown'
import { turnstileSiteKey, verifyTurnstile } from './turnstile'
import type { AppContext, GenerationRow, OrderRow, UploadRow, UserRow } from './types'
import { ApiError, constantTimeEqual, createId, isCheckConstraintError, isProduction, nowIso, sha256Hex } from './util'
import { activeVideoProviderId } from './video'

const MAX_ACTIVE_JOBS_PER_USER = 3

export const app = new Hono<AppContext>()

app.onError((error, c) => {
  if (error instanceof ApiError) {
    const status = error.status as ContentfulStatusCode
    // 5xx 的 message 可能带配置或支付商细节：写日志，只回给管理员（后台据此显示退款被拒的原因），其他人只拿到错误码
    if (error.status >= 500) {
      console.error(`[api] ${c.req.method} ${c.req.path} ${error.code}: ${error.message}`)
      if (c.get('user')?.role !== 'admin') return c.json({ error: error.code }, status)
    }
    return c.json({ error: error.code, message: error.message }, status)
  }
  if (error instanceof WebhookVerificationError) {
    console.warn('webhook rejected:', error.message)
    return c.json({ error: 'invalid_webhook' }, 401)
  }
  console.error(error)
  return c.json({ error: 'internal_error' }, 500)
})

// CSRF：有副作用的请求必须同源（webhook 除外，它们有各自的签名校验；CSP 报告和前端错误上报由浏览器发出，
// 不一定带 Origin，只写日志）
app.use('/api/*', async (c, next) => {
  const method = c.req.method
  const external = c.req.path.startsWith('/api/webhooks/') || c.req.path === CSP_REPORT_PATH || c.req.path === CLIENT_ERROR_PATH
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !external) {
    const origin = c.req.header('origin')
    const allowed = [new URL(c.req.url).origin, new URL(c.env.SITE_URL).origin]
    if (!origin || !allowed.includes(origin)) throw new ApiError(403, 'bad_origin')
  }
  c.set('user', external ? null : await loadSessionUser(c))
  await next()
})

app.get('/api/health', (c) => c.json({ ok: true, time: nowIso() }))

// CSP 违规报告（server/csp.ts）：只写日志不落库；按 IP 限流，超限或报告过大时静默丢弃
app.post(CSP_REPORT_PATH, async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const allowed = !c.env.AUTH_LIMITER || (await c.env.AUTH_LIMITER.limit({ key: `csp:${ip}` })).success
  const size = Number(c.req.header('content-length'))
  if (allowed && size > 0 && size <= 16_384) {
    for (const line of summarizeCspReports(await c.req.text())) console.warn('[csp]', line)
  }
  return c.body(null, 204)
})

// 前端错误上报（server/client-error.ts）：同样只写日志、按 IP 限流，超限、过大或格式不对时静默丢弃
app.post(CLIENT_ERROR_PATH, async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const allowed = !c.env.AUTH_LIMITER || (await c.env.AUTH_LIMITER.limit({ key: `client-error:${ip}` })).success
  const size = Number(c.req.header('content-length'))
  if (allowed && size > 0 && size <= 8_192) {
    const line = summarizeClientError(await c.req.text())
    if (line) console.error('[client-error]', line)
  }
  return c.body(null, 204)
})

app.get('/api/me', (c) => {
  const user = c.get('user')
  return c.json({
    user: user ? publicUser(user) : null,
    config: {
      googleClientId: googleClientId(c.env) ?? null,
      devLogin: !isProduction(c.env),
      paymentProvider: c.env.PAYMENT_PROVIDER,
      turnstileSiteKey: turnstileSiteKey(c.env),
    },
  })
})

// ---------- Auth ----------

app.get('/api/auth/google/start', async (c) => {
  await rateLimit(c.env.AUTH_LIMITER, c.req.header('cf-connecting-ip') ?? 'local')
  const config = googleOAuthConfig(c.env, new URL(c.req.url).origin)
  if (!config) throw new ApiError(503, 'google_not_configured')
  const { url, state } = googleAuthRedirect(config)
  setCookie(c, 'oauth_state', `${state}|${safeRedirectPath(c.req.query('redirect'), '/dashboard')}`, {
    httpOnly: true,
    secure: isProduction(c.env),
    sameSite: 'Lax',
    path: '/api/auth/google',
    maxAge: 600,
  })
  return c.redirect(url)
})

app.get('/api/auth/google/callback', async (c) => {
  const [expectedState, redirectTo] = (getCookie(c, 'oauth_state') ?? '').split('|')
  deleteCookie(c, 'oauth_state', { path: '/api/auth/google' })
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code')
  if (!expectedState || !code || !constantTimeEqual(state, expectedState)) return c.redirect('/sign-in?error=oauth_state')
  const config = googleOAuthConfig(c.env, new URL(c.req.url).origin)
  if (!config) throw new ApiError(503, 'google_not_configured')
  try {
    const profile = await exchangeGoogleCode(code, config)
    const user = await upsertUser(c.env, {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      googleSub: profile.sub,
      country: c.req.header('cf-ipcountry') ?? null,
      locale: null,
      attribution: requestAttribution(c, 'first'),
    })
    await startSession(c, user.id)
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'oauth_failed'
    if (!(error instanceof ApiError)) console.error(error)
    return c.redirect(`/sign-in?error=${code}`)
  }
  return c.redirect(safeRedirectPath(redirectTo, '/dashboard'))
})

app.post('/api/auth/google/one-tap', async (c) => {
  await rateLimit(c.env.AUTH_LIMITER, c.req.header('cf-connecting-ip') ?? 'local')
  const clientId = googleClientId(c.env)
  if (!clientId) throw new ApiError(503, 'google_not_configured')
  const { credential } = await readJson<{ credential: string }>(c)
  if (!credential) throw new ApiError(400, 'missing_credential')
  const profile = await verifyGoogleIdToken(credential, clientId)
  const user = await upsertUser(c.env, {
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    googleSub: profile.sub,
    country: c.req.header('cf-ipcountry') ?? null,
    locale: null,
    attribution: requestAttribution(c, 'first'),
  })
  await startSession(c, user.id)
  return c.json({ user: publicUser(user) })
})

// 本地快捷登录（e2e 依赖它）；生产环境或经隧道/公网访问时 404
app.post('/api/auth/dev-login', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const { email, name } = await readJson<{ email: string; name: string }>(c)
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'invalid_email')
  const user = await upsertUser(c.env, {
    email,
    name: name ?? email.split('@')[0] ?? null,
    picture: null,
    googleSub: null,
    country: null,
    locale: null,
    attribution: requestAttribution(c, 'first'),
  })
  await startSession(c, user.id)
  return c.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

// ---------- Uploads ----------

app.post('/api/uploads', async (c) => {
  const user = requireUser(c)
  await rateLimit(c.env.UPLOAD_LIMITER, user.id)
  const declared = Number(c.req.header('content-length') ?? '0')
  if (declared > site.upload.maxBytes + 64 * 1024) throw new ApiError(413, 'file_too_large')
  const form = await c.req.raw.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') throw new ApiError(400, 'missing_file')
  if (file.size > site.upload.maxBytes) throw new ApiError(413, 'file_too_large')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffImageType(bytes)
  if (!contentType || !(site.upload.contentTypes as readonly string[]).includes(contentType)) {
    throw new ApiError(415, 'unsupported_file_type')
  }
  // 已下架内容的原图不允许再次上传；审核不通过的不落盘、不扣积分
  const hash = await sha256Hex(bytes)
  if (await isBlockedMedia(c.env, hash)) throw new ApiError(422, 'content_rejected')
  const mockOutcome = form?.get('mockOutcome')
  const verdict = await getModerationProvider(c.env).checkImage({
    bytes,
    contentType,
    mockOutcome: typeof mockOutcome === 'string' ? mockOutcome : null,
  })
  if (!verdict.allowed) {
    console.warn('upload rejected by moderation', user.id, verdict.reason)
    throw new ApiError(422, 'content_rejected')
  }
  const id = createId('upl')
  const key = `uploads/${user.id}/${id}`
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType } })
  await c.env.DB.prepare(
    'INSERT INTO uploads (id, user_id, r2_key, content_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, key, contentType, bytes.length, hash, nowIso())
    .run()
  return c.json({ upload: { id, contentType, size: bytes.length } }, 201)
})

// ---------- Generations ----------

app.post('/api/generations', async (c) => {
  const user = requireUser(c)
  await rateLimit(c.env.GENERATE_LIMITER, user.id)
  const body = await readJson<{ uploadId: string; durationId: string; mockOutcome: string; locale: string }>(c)
  const duration = findDuration(body.durationId ?? '')
  if (!duration) throw new ApiError(400, 'invalid_duration')
  const db = c.env.DB
  const upload = await db
    .prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ? AND expired_at IS NULL')
    .bind(body.uploadId ?? '', user.id)
    .first<UploadRow>()
  if (!upload) throw new ApiError(400, 'invalid_upload')
  const active = await db
    .prepare(`SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('queued', 'processing')`)
    .bind(user.id)
    .first<{ n: number }>()
  if ((active?.n ?? 0) >= MAX_ACTIVE_JOBS_PER_USER) throw new ApiError(429, 'too_many_active_jobs')
  await rememberLocale(c.env, user, body.locale)

  const providerId = activeVideoProviderId(c.env)
  const mockOutcome = providerId === 'mock' && (body.mockOutcome === 'fail' || body.mockOutcome === 'hang') ? body.mockOutcome : null
  const meta = mockOutcome ? JSON.stringify({ mockOutcome }) : null
  const id = createId('gen')
  const now = nowIso()
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO generations (id, user_id, template_id, duration_id, duration_seconds, credits_cost, upload_id,
           status, provider, provider_meta, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .bind(id, user.id, site.template.id, duration.id, duration.seconds, duration.credits, upload.id, providerId, meta, now, now),
      ...ledgerStatements(db, {
        userId: user.id,
        delta: -duration.credits,
        reason: 'generation',
        refId: id,
        idempotencyKey: `generation:${id}`,
      }),
    ])
  } catch (error) {
    if (isCheckConstraintError(error)) throw new ApiError(402, 'insufficient_credits')
    throw error
  }

  try {
    await enqueueJob(c.env, { kind: 'submit', generationId: id })
  } catch (error) {
    console.error('enqueue failed', error)
    await failGeneration(c.env, id, 'enqueue_failed', 'Could not enqueue job')
    throw new ApiError(503, 'queue_unavailable')
  }
  const row = await db.prepare('SELECT * FROM generations WHERE id = ?').bind(id).first<GenerationRow>()
  return c.json({ generation: publicGeneration(row!) }, 201)
})

app.get('/api/generations', async (c) => {
  const user = requireUser(c)
  const { limit, offset } = pageParams(c, 24)
  const rows = await c.env.DB.prepare('SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(user.id, limit, offset)
    .all<GenerationRow>()
  return c.json({ generations: rows.results.map(publicGeneration) })
})

async function ownGeneration(c: Parameters<typeof requireUser>[0], id: string) {
  const user = requireUser(c)
  const row = await c.env.DB.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<GenerationRow>()
  if (!row) throw new ApiError(404, 'not_found')
  return row
}

app.get('/api/generations/:id', async (c) => {
  return c.json({ generation: publicGeneration(await ownGeneration(c, c.req.param('id'))) })
})

app.get('/api/generations/:id/video', async (c) => {
  const row = await ownGeneration(c, c.req.param('id'))
  if (row.removed_at) throw new ApiError(410, 'media_removed')
  if (row.expired_at) throw new ApiError(410, 'media_expired')
  if (row.status !== 'succeeded' || !row.output_r2_key) throw new ApiError(404, 'not_ready')
  const download = c.req.query('download') === '1'
  // 文件名标明 AI 生成，并带上 id：二次传播后被举报时可直接定位
  return serveR2Object(c.env.MEDIA, row.output_r2_key, c.req.raw, {
    cacheControl: 'private, max-age=3600',
    downloadName: download ? `${site.brandName.replace(/\s+/g, '-').toLowerCase()}-ai-video-${row.id}.mp4` : undefined,
  })
})

app.delete('/api/generations/:id', async (c) => {
  const row = await ownGeneration(c, c.req.param('id'))
  if (row.status === 'queued' || row.status === 'processing') throw new ApiError(409, 'generation_in_progress')
  if (row.output_r2_key) await c.env.MEDIA.delete(row.output_r2_key)
  await c.env.DB.prepare('DELETE FROM generations WHERE id = ?').bind(row.id).run()
  return c.json({ ok: true })
})

// ---------- Credits & billing ----------

app.get('/api/credits/ledger', async (c) => {
  const user = requireUser(c)
  const { limit, offset } = pageParams(c)
  const rows = await c.env.DB.prepare(
    'SELECT id, delta, reason, ref_id, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
  )
    .bind(user.id, limit, offset)
    .all()
  return c.json({ balance: user.credits, entries: rows.results })
})

app.post('/api/checkout', async (c) => {
  const user = requireUser(c)
  await rateLimit(c.env.AUTH_LIMITER, `checkout:${user.id}`)
  const body = await readJson<{ packageId: string; locale: string }>(c)
  const pack = findPackage(body.packageId ?? '')
  if (!pack) throw new ApiError(400, 'invalid_package')
  const locale = isLocale(body.locale) ? body.locale : 'en'
  await rememberLocale(c.env, user, body.locale)
  const provider = getPaymentProvider(c.env)
  const id = createId('ord')
  const now = nowIso()
  const attr = requestAttribution(c, 'last')
  await c.env.DB.prepare(
    `INSERT INTO orders (id, user_id, provider, package_id, credits, amount_cents, currency, status,
     source, medium, campaign, country, device, attribution, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      provider.id,
      pack.id,
      pack.credits,
      pack.priceCents,
      pack.currency,
      attr.source,
      attr.medium,
      attr.campaign,
      attr.country ?? user.country,
      attr.device,
      attr.json,
      now,
      now,
    )
    .run()
  const siteUrl = c.env.SITE_URL.replace(/\/$/, '')
  try {
    const result = await provider.createCheckout({
      order: { id, packageId: pack.id, credits: pack.credits, amountCents: pack.priceCents, currency: pack.currency },
      user: { id: user.id, email: user.email, name: user.name },
      successUrl: `${siteUrl}${localePath(locale, '/checkout/success')}?order=${id}`,
      cancelUrl: `${siteUrl}${localePath(locale, '/pricing')}`,
    })
    await c.env.DB.prepare('UPDATE orders SET provider_session_id = ?, updated_at = ? WHERE id = ?')
      .bind(result.sessionId, nowIso(), id)
      .run()
    return c.json({ orderId: id, url: result.url })
  } catch (error) {
    await c.env.DB.prepare(`UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?`).bind(nowIso(), id).run()
    throw error
  }
})

app.get('/api/orders', async (c) => {
  const user = requireUser(c)
  const { limit, offset } = pageParams(c)
  const rows = await c.env.DB.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .bind(user.id, limit, offset)
    .all<OrderRow>()
  return c.json({ orders: rows.results.map(publicOrder) })
})

app.get('/api/orders/:id', async (c) => {
  const user = requireUser(c)
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<OrderRow>()
  if (!order) throw new ApiError(404, 'not_found')
  return c.json({ order: publicOrder(order), credits: user.credits })
})

// mock 支付：模拟支付商回调，走与真实 webhook 完全相同的入账逻辑；amountCents 用于模拟部分退款
app.post('/api/mock-payments/complete', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const user = requireUser(c)
  const body = await readJson<{
    orderId: string
    outcome: 'paid' | 'failed' | 'refunded'
    eventId: string
    amountCents?: number
  }>(c)
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND user_id = ? AND provider = 'mock'`)
    .bind(body.orderId ?? '', user.id)
    .first<OrderRow>()
  if (!order) throw new ApiError(404, 'not_found')
  const outcome = body.outcome ?? 'paid'
  const eventId = body.eventId ?? `mock_${outcome}_${order.id}`
  const event: PaymentEvent =
    outcome === 'paid'
      ? {
          kind: 'paid',
          eventId,
          eventType: 'mock.paid',
          orderId: order.id,
          providerOrderId: `mock_order_${order.id}`,
          providerPaymentId: `mock_pay_${order.id}`,
          paidAmount: (order.amount_cents / 100).toFixed(2),
          paidCurrency: order.currency,
          paidAmountCents: order.amount_cents,
        }
      : outcome === 'refunded'
        ? {
            kind: 'refunded',
            eventId,
            eventType: 'mock.refunded',
            orderId: order.id,
            providerPaymentId: null,
            refundId: eventId,
            refundAmountCents: Number.isInteger(body.amountCents) && body.amountCents! > 0 ? body.amountCents! : null,
            originalAmountCents: null,
          }
        : { kind: 'failed', eventId, eventType: 'mock.failed', orderId: order.id }
  const result = await processPaymentEvent(c.env, 'mock', event, JSON.stringify({ eventId, outcome, orderId: order.id }))
  return c.json(result)
})

// ---------- 访问统计（漏斗第一步）----------

// 每个浏览器会话上报一次（客户端用 sessionStorage 去重），按天 × 来源 × 国家 × 设备累加
app.post('/api/t/visit', async (c) => {
  const device = deviceFromUserAgent(c.req.header('user-agent'))
  if (device === 'bot') return c.body(null, 204)
  await rateLimit(c.env.AUTH_LIMITER, `visit:${c.req.header('cf-connecting-ip') ?? 'local'}`)
  const body = await c.req.json<{ touch?: unknown }>().catch(() => ({ touch: undefined }))
  const { source, medium } = classifyTouch(sanitizeTouch(body.touch), new URL(c.req.url).hostname)
  const country = c.req.header('cf-ipcountry')
  await c.env.DB.prepare(
    `INSERT INTO visit_stats (day, source, medium, country, device, visits) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (day, source, medium, country, device) DO UPDATE SET visits = visits + 1`,
  )
    .bind(nowIso().slice(0, 10), source, medium, country && country !== 'XX' ? country : 'unknown', device)
    .run()
  return c.body(null, 204)
})

// ---------- Webhooks ----------

app.post('/api/webhooks/waffo', async (c) => {
  const raw = await c.req.text()
  const payload = await verifyWaffoWebhook(raw, c.req.header('x-waffo-signature'), waffoEnvironment(c.env))
  const result = await processPaymentEvent(c.env, 'waffo', normalizeWaffoEvent(payload), raw)
  return c.json({ received: true, ...result })
})

app.post('/api/webhooks/dodo', async (c) => {
  const raw = await c.req.text()
  const payload = await verifyDodoWebhook(raw, c.req.raw.headers, c.env.DODO_WEBHOOK_SECRET)
  const result = await processPaymentEvent(c.env, 'dodo', normalizeDodoEvent(payload), raw)
  return c.json({ received: true, ...result })
})

// fal 完成回调：只当作“立即轮询”的信号，真实结果由 jobs.ts 用 API key 拉取
app.post('/api/webhooks/fal', async (c) => {
  const generationId = c.req.query('gen') ?? ''
  const token = c.req.query('token') ?? ''
  if (!generationId || !constantTimeEqual(token, await jobToken(c.env, generationId))) {
    throw new WebhookVerificationError('invalid fal job token')
  }
  await enqueueJob(c.env, { kind: 'poll', generationId })
  return c.json({ received: true })
})

// ---------- Contact & account ----------

app.post('/api/contact', async (c) => {
  const ip = c.req.header('cf-connecting-ip')
  await rateLimit(c.env.AUTH_LIMITER, `contact:${ip ?? 'local'}`)
  const body = await readJson<{ email: string; topic: string; message: string; turnstileToken: string }>(c)
  const user = c.get('user')
  const email = (body.email ?? user?.email ?? '').trim()
  const message = (body.message ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'invalid_email')
  if (message.length < 10 || message.length > 5000) throw new ApiError(400, 'invalid_message')
  const topic = ['general', 'billing', 'bug', 'partnership'].includes(body.topic ?? '') ? body.topic! : 'general'
  // 先校验字段再消耗 Turnstile token（token 单次有效）
  await verifyTurnstile(c.env, body.turnstileToken, ip)
  const id = createId('msg')
  await c.env.DB.prepare(
    'INSERT INTO contact_messages (id, user_id, email, topic, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user?.id ?? null, email, topic, message, 'open', nowIso())
    .run()
  await notifyContactMessage(c.env, { id, email, topic, message })
  return c.json({ ok: true }, 201)
})

// 内容举报 / 下架申请：无需登录；管理员在 /admin/takedowns 按 due_at 处理
app.post('/api/takedowns', async (c) => {
  const ip = c.req.header('cf-connecting-ip')
  await rateLimit(c.env.AUTH_LIMITER, `takedown:${ip ?? 'local'}`)
  const body = await readJson<TakedownInput & { turnstileToken: string; locale: string }>(c)
  const input = parseTakedown(body)
  await verifyTurnstile(c.env, body.turnstileToken, ip)
  const locale = isLocale(body.locale) ? body.locale : null
  return c.json({ report: await createTakedown(c.env, input, c.get('user'), locale) }, 201)
})

// 导出我的数据（个人中心设置页）：JSON 附件，内容见 account-export.ts
app.get('/api/account/export', async (c) => {
  const user = requireUser(c)
  await rateLimit(c.env.AUTH_LIMITER, `export:${user.id}`)
  const data = await exportUserData(c.env, user.id)
  c.header('Content-Disposition', `attachment; filename="${exportFileName()}"`)
  c.header('Cache-Control', 'private, no-store')
  return c.json(data)
})

// 注销：删除上传与生成的媒体，匿名化用户；订单与积分流水按财务要求保留
app.delete('/api/account', async (c) => {
  const user = requireUser(c)
  for (const prefix of [`uploads/${user.id}/`, `outputs/${user.id}/`]) {
    let cursor: string | undefined
    do {
      const listed = await c.env.MEDIA.list({ prefix, cursor })
      if (listed.objects.length) await c.env.MEDIA.delete(listed.objects.map((o) => o.key))
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
  }
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM generations WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM uploads WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM email_outbox WHERE user_id = ?').bind(user.id),
    ...clawbackStatements(db, {
      userId: user.id,
      maxAmount: user.credits,
      reason: 'account_deleted',
      idempotencyKey: `account_deleted:${user.id}`,
    }),
    db
      .prepare(
        `UPDATE users SET email = ?, name = NULL, avatar_url = NULL, google_sub = NULL, status = 'deleted' WHERE id = ?`,
      )
      .bind(`deleted+${user.id}@deleted.invalid`, user.id),
  ])
  await endSession(c)
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run()
  return c.json({ ok: true })
})

// 本地 e2e：把当前用户的数据按“days 天后”执行一次保留期清理
app.post('/api/dev/sweep', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const user = requireUser(c)
  const { days } = await readJson<{ days: number }>(c)
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) throw new ApiError(400, 'invalid_days')
  return c.json(await sweepExpiredMedia(c.env, { now: Date.now() + days * 86400_000, userId: user.id }))
})

// 本地 e2e：查看发件箱。本地 send_email binding 只模拟发送（不会真的发出），以发件箱记录为准
app.get('/api/dev/emails', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const to = c.req.query('to')?.trim().toLowerCase() || null
  const ref = c.req.query('ref')?.trim() || null
  if (!to && !ref) throw new ApiError(400, 'filter_required')
  const rows = await c.env.DB.prepare(
    `SELECT id, dedupe_key, template, to_email, user_id, locale, params, subject, status, attempts, provider_message_id, last_error
     FROM email_outbox WHERE (?1 IS NULL OR lower(to_email) = ?1) AND (?2 IS NULL OR instr(dedupe_key, ?2) > 0)
     ORDER BY created_at, dedupe_key`,
  )
    .bind(to, ref)
    .all<{ params: string }>()
  return c.json({ emails: rows.results.map((row) => ({ ...row, params: JSON.parse(row.params) as unknown })) })
})

// 本地 e2e：按“hours 小时后”对指定举报跑一次超时提醒
app.post('/api/dev/takedown-reminders', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const { takedownId, hours } = await readJson<{ takedownId: string; hours: number }>(c)
  if (!takedownId || typeof hours !== 'number' || !Number.isFinite(hours)) throw new ApiError(400, 'invalid_request')
  return c.json(await runTakedownReminders(c.env, { now: Date.now() + hours * 3600_000, takedownId }))
})

// 本地 e2e：模拟当前用户某个任务的队列消息进入死信队列（真实路径要重试 10 次、约 35 分钟）
app.post('/api/dev/dead-letter', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const user = requireUser(c)
  const generationId = (await readJson<{ generationId: string }>(c)).generationId ?? ''
  const owned = await c.env.DB.prepare('SELECT id FROM generations WHERE id = ? AND user_id = ?').bind(generationId, user.id).first()
  if (!owned) throw new ApiError(404, 'not_found')
  return c.json({ failed: await handleDeadLetter(c.env, { kind: 'poll', generationId }) })
})

// 本地 e2e：让当前用户一个 hang 的 mock 任务出片，并同时跑 polls 次轮询（模拟 fal webhook 与定时轮询撞在一起）
app.post('/api/dev/mock-finish', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const user = requireUser(c)
  const { generationId = '', polls = 1 } = await readJson<{ generationId?: string; polls?: number }>(c)
  if (!Number.isInteger(polls) || polls < 1 || polls > 5) throw new ApiError(400, 'invalid_polls')
  const updated = await c.env.DB.prepare(
    `UPDATE generations SET provider_meta = json_set(provider_meta, '$.mockOutcome', NULL, '$.readyAt', 0)
     WHERE id = ? AND user_id = ? AND provider = 'mock' AND provider_meta IS NOT NULL`,
  )
    .bind(generationId, user.id)
    .run()
  if (!updated.meta.changes) throw new ApiError(404, 'not_found')
  await Promise.all(Array.from({ length: polls }, () => handleVideoJob(c.env, { kind: 'poll', generationId })))
  return c.json({ ok: true })
})

// 本地 e2e：立即跑一次健康检查；since 把统计窗口起点固定到测试开始时刻
app.post('/api/dev/health-check', async (c) => {
  if (!isLocalDevRequest(c)) throw new ApiError(404, 'not_found')
  const { since } = await readJson<{ since?: string }>(c)
  if (since !== undefined && (typeof since !== 'string' || Number.isNaN(Date.parse(since)))) throw new ApiError(400, 'invalid_since')
  return c.json(await runHealthCheck(c.env, { since }))
})

// ---------- Admin ----------

app.route('/api/admin', adminRoutes)
app.route('/', seoRoutes)

app.all('/api/*', () => {
  throw new ApiError(404, 'not_found')
})

// ---------- Media（非 /api 路径，不需要登录） ----------

app.get('/media/templates/:file', async (c) => {
  const file = c.req.param('file')
  if (!/^[\w.-]+$/.test(file)) return c.notFound()
  return serveR2Object(c.env.MEDIA, `templates/${file}`, c.req.raw, { cacheControl: 'public, max-age=86400' })
})

app.get('/media/uploads/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await verifyUploadSignature(c.env, id, c.req.query('exp') ?? null, c.req.query('sig') ?? null))) {
    return c.text('Forbidden', 403)
  }
  const upload = await c.env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first<UploadRow>()
  if (!upload || upload.expired_at) return c.notFound()
  return serveR2Object(c.env.MEDIA, upload.r2_key, c.req.raw, { cacheControl: 'private, max-age=600' })
})

// 记住用户最近使用的界面语言，交易邮件按它选择语言
async function rememberLocale(env: Env, user: UserRow, locale: string | undefined) {
  if (isLocale(locale) && locale !== user.locale) {
    await env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(locale, user.id).run()
  }
}

// dev-login / mock 支付只允许本机直连：非生产 + 主机名是回环地址 + 没有经过 Cloudflare 边缘（隧道会带 cf-connecting-ip）
// + 没有经过其他反向代理（ngrok 用 --host-header=rewrite 把 Host 改成 localhost 时，仍会带 x-forwarded-for）。
// 不看 x-forwarded-host：@cloudflare/vite-plugin 在 dev 下会给每个请求补上它
function isLocalDevRequest(c: { env: Env; req: { url: string; header(name: string): string | undefined } }) {
  if (isProduction(c.env)) return false
  const host = new URL(c.req.url).hostname.replace(/^\[|\]$/g, '')
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return false
  if (c.req.header('x-forwarded-for') || c.req.header('forwarded')) return false
  const edgeIp = c.req.header('cf-connecting-ip')
  return !edgeIp || ['127.0.0.1', '::1'].includes(edgeIp)
}
