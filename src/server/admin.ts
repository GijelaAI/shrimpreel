import { Hono } from 'hono'
import { ledgerStatements } from './credits'
import { emailConfig, retryEmail } from './email'
import { audit, pageParams, publicGeneration, readJson, requireAdmin } from './http'
import { failGeneration } from './jobs'
import { serveR2Object } from './media'
import { assertProviderRefundAllowed, localRefundKey, refundOrder } from './orders'
import { notifyOrderPaid, notifyTakedownResolved } from './notifications'
import { getRefundProvider } from './payments'
import { registerReportRoutes } from './reports'
import { removeReportedContent } from './takedown'
import type { AppContext, GenerationRow, OrderRow, TakedownRow, UserRow } from './types'
import { ApiError, createId, isCheckConstraintError, isUniqueConstraintError, nowIso } from './util'

export const adminRoutes = new Hono<AppContext>()

adminRoutes.use('*', async (c, next) => {
  requireAdmin(c)
  await next()
})

registerReportRoutes(adminRoutes)

// 净收入：按实收币种汇总实收（缺失时用标价）减已退金额；orders 只统计未全额退款的
const NET_REVENUE = `COALESCE(paid_currency, currency) AS currency, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS orders,
  SUM(COALESCE(paid_amount_cents, amount_cents) - refunded_amount_cents) AS cents,
  SUM(refunded_amount_cents) AS refunded_cents`

// 每积分实收（美分，fal 按美元计费，所以只看 USD 订单）：未全额退款订单的实收减部分退款，除以未回收的积分。
// 用于把生成消耗的积分折算成收入、算毛利；没有 USD 订单时为 null
const revenuePerCredit = (db: D1Database) =>
  db.prepare(
    `SELECT SUM(COALESCE(paid_amount_cents, amount_cents) - refunded_amount_cents) AS cents, SUM(credits - refunded_credits) AS credits
     FROM orders WHERE status = 'paid' AND COALESCE(paid_currency, currency) = 'USD'`,
  )
const perCredit = (result: D1Result) => {
  const row = result.results[0] as { cents: number | null; credits: number | null } | undefined
  return row?.credits ? Number(row.cents) / row.credits : null
}

adminRoutes.get('/stats', async (c) => {
  const db = c.env.DB
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString()
  const since30d = new Date(Date.now() - 30 * 86400_000).toISOString()
  const [users, newUsers, revenue, revenue30d, generations, outstanding, openMessages, failedEvents, takedowns, failedEmails, cost30d, perCreditRow] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status != 'deleted'`),
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').bind(since7d),
    db.prepare(
      `SELECT ${NET_REVENUE} FROM orders WHERE status IN ('paid', 'refunded') GROUP BY 1`,
    ),
    db
      .prepare(
        `SELECT ${NET_REVENUE} FROM orders WHERE status IN ('paid', 'refunded') AND paid_at >= ? GROUP BY 1`,
      )
      .bind(since30d),
    db.prepare('SELECT status, COUNT(*) AS n FROM generations GROUP BY status'),
    db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users'),
    db.prepare(`SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'open'`),
    db.prepare(`SELECT COUNT(*) AS n FROM payment_events WHERE status = 'failed'`),
    db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN due_at < ? THEN 1 ELSE 0 END), 0) AS overdue FROM takedown_requests WHERE status = 'open'`)
      .bind(new Date().toISOString()),
    db.prepare(`SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'failed'`),
    // 成本含出片后才被判失败的任务（服务商照样计费）；收入只算成功且未退积分的
    db
      .prepare(
        `SELECT COUNT(provider_cost_cents) AS videos, COALESCE(SUM(provider_cost_cents), 0) AS cost_cents,
         COALESCE(SUM(CASE WHEN status = 'succeeded' AND refunded = 0 THEN credits_cost ELSE 0 END), 0) AS credits
         FROM generations WHERE completed_at >= ?`,
      )
      .bind(since30d),
    revenuePerCredit(db),
  ])
  const count = (result: D1Result) => Number((result.results[0] as { n?: number } | undefined)?.n ?? 0)
  const cost = cost30d!.results[0] as { videos: number; cost_cents: number; credits: number }
  return c.json({
    users: count(users!),
    newUsers7d: count(newUsers!),
    revenue: revenue!.results,
    revenue30d: revenue30d!.results,
    generations: generations!.results,
    outstandingCredits: count(outstanding!),
    openMessages: count(openMessages!),
    failedPaymentEvents: count(failedEvents!),
    openTakedowns: count(takedowns!),
    overdueTakedowns: Number((takedowns!.results[0] as { overdue?: number } | undefined)?.overdue ?? 0),
    failedEmails: count(failedEmails!),
    generationCost30d: { videos: cost.videos, costCents: cost.cost_cents, creditsUsed: cost.credits },
    revenuePerCreditCents: perCredit(perCreditRow!),
  })
})

// ---------- 用户 ----------

adminRoutes.get('/users', async (c) => {
  const { limit, offset } = pageParams(c)
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const rows = q
    ? await c.env.DB.prepare('SELECT * FROM users WHERE email LIKE ? OR id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .bind(`%${q}%`, q, limit, offset)
        .all<UserRow>()
    : await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all<UserRow>()
  return c.json({ users: rows.results })
})

adminRoutes.get('/users/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  if (!user) throw new ApiError(404, 'not_found')
  const [orders, ledger, generations] = await db.batch([
    db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(id),
    db.prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(id),
    db.prepare('SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(id),
  ])
  return c.json({
    user,
    orders: orders!.results,
    ledger: ledger!.results,
    generations: (generations!.results as unknown as GenerationRow[]).map((g) => ({ ...publicGeneration(g), errorMessage: g.error_message })),
  })
})

adminRoutes.post('/users/:id/credits', async (c) => {
  const admin = requireAdmin(c)
  const id = c.req.param('id')
  const body = await readJson<{ delta: number; note: string }>(c)
  const delta = Number(body.delta)
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw new ApiError(400, 'invalid_delta')
  const note = (body.note ?? '').trim()
  if (!note) throw new ApiError(400, 'note_required')
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first()
  if (!exists) throw new ApiError(404, 'not_found')
  try {
    await c.env.DB.batch(
      ledgerStatements(c.env.DB, {
        userId: id,
        delta,
        reason: 'admin_adjust',
        refId: admin.id,
        idempotencyKey: `admin:${createId('adj')}`,
        note,
      }),
    )
  } catch (error) {
    if (isCheckConstraintError(error)) throw new ApiError(400, 'insufficient_credits', '扣减后余额会小于 0')
    throw error
  }
  await audit(c.env, admin, 'credits.adjust', 'user', id, { delta, note })
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/status', async (c) => {
  const admin = requireAdmin(c)
  const id = c.req.param('id')
  const { status } = await readJson<{ status: 'active' | 'banned' }>(c)
  if (status !== 'active' && status !== 'banned') throw new ApiError(400, 'invalid_status')
  if (id === admin.id) throw new ApiError(400, 'cannot_change_self')
  const db = c.env.DB
  await db.batch([
    db.prepare(`UPDATE users SET status = ? WHERE id = ? AND status != 'deleted'`).bind(status, id),
    ...(status === 'banned' ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)] : []),
  ])
  await audit(c.env, admin, `user.${status === 'banned' ? 'ban' : 'unban'}`, 'user', id)
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/role', async (c) => {
  const admin = requireAdmin(c)
  const id = c.req.param('id')
  const { role } = await readJson<{ role: 'user' | 'admin' }>(c)
  if (role !== 'user' && role !== 'admin') throw new ApiError(400, 'invalid_role')
  if (id === admin.id) throw new ApiError(400, 'cannot_change_self')
  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run()
  await audit(c.env, admin, 'user.role', 'user', id, { role })
  return c.json({ ok: true })
})

// ---------- 订单 ----------

adminRoutes.get('/orders', async (c) => {
  const { limit, offset } = pageParams(c)
  const where: string[] = []
  const params: unknown[] = []
  const status = c.req.query('status')
  const provider = c.req.query('provider')
  const q = (c.req.query('q') ?? '').trim()
  if (status) {
    where.push('o.status = ?')
    params.push(status)
  }
  if (provider) {
    where.push('o.provider = ?')
    params.push(provider)
  }
  if (q) {
    where.push('(o.id = ? OR u.email LIKE ? OR o.provider_payment_id = ? OR o.provider_order_id = ?)')
    params.push(q, `%${q.toLowerCase()}%`, q, q)
  }
  const rows = await c.env.DB.prepare(
    `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all()
  return c.json({ orders: rows.results })
})

// 退款（支持部分金额）：
// - mode=provider（Waffo / Dodo 订单默认）：调用支付商退款 API 真正退钱，积分回收和订单状态等退款 webhook 回来按实际金额处理
// - mode=local（mock 订单、或已在支付商后台退过款但 webhook 丢失时）：只做本地记账并按比例回收积分
adminRoutes.post('/orders/:id/refund', async (c) => {
  const admin = requireAdmin(c)
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(c.req.param('id')).first<OrderRow>()
  if (!order) throw new ApiError(404, 'not_found')
  if (order.status !== 'paid') throw new ApiError(409, 'order_not_paid')
  const body = await readJson<{ note?: string; amountCents?: number | null; mode?: 'provider' | 'local'; refundId?: string }>(c)
  const note = body.note?.trim() ?? ''
  if (!note) throw new ApiError(400, 'note_required')
  const remaining = Math.max(0, (order.paid_amount_cents ?? order.amount_cents) - order.refunded_amount_cents)
  const amountCents = body.amountCents ?? remaining
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) throw new ApiError(400, 'invalid_amount')
  const fullAmount = amountCents === remaining

  const provider = body.mode === 'local' ? null : getRefundProvider(c.env, order.provider)
  if (provider?.refund) {
    if (!order.provider_payment_id) throw new ApiError(409, 'missing_provider_payment')
    assertProviderRefundAllowed(order)
    const result = await provider.refund({
      orderId: order.id,
      packageId: order.package_id,
      providerPaymentId: order.provider_payment_id,
      amountCents,
      fullAmount,
      currency: order.paid_currency ?? order.currency,
      reason: note,
    })
    await audit(c.env, admin, 'order.refund_requested', 'order', order.id, { note, amountCents, ...result })
    return c.json({ ok: true, requested: true, refunded: false, ...result })
  }

  const refundId = body.refundId?.trim()
  const refunded = await refundOrder(c.env.DB, order, {
    refundKey: localRefundKey(order, refundId, amountCents),
    amountCents: fullAmount ? null : amountCents,
    note: `admin: ${note}`,
  })
  await audit(c.env, admin, 'order.refund', 'order', order.id, { note, amountCents, refundId, refunded })
  return c.json({ ok: true, requested: false, refunded })
})

// 补单：webhook 丢失但支付商后台确认已付款时，手动发放积分
adminRoutes.post('/orders/:id/mark-paid', async (c) => {
  const admin = requireAdmin(c)
  const db = c.env.DB
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(c.req.param('id')).first<OrderRow>()
  if (!order) throw new ApiError(404, 'not_found')
  if (order.status === 'paid' || order.status === 'refunded') throw new ApiError(409, 'order_already_paid')
  const { note } = await readJson<{ note: string }>(c)
  if (!note?.trim()) throw new ApiError(400, 'note_required')
  const now = nowIso()
  try {
    await db.batch([
      ...ledgerStatements(db, {
        userId: order.user_id,
        delta: order.credits,
        reason: 'purchase',
        refId: order.id,
        idempotencyKey: `order:${order.id}`,
        note: `admin mark-paid: ${note}`,
      }),
      db
        .prepare(`UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ?, paid_amount_cents = amount_cents WHERE id = ?`)
        .bind(now, now, order.id),
    ])
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError(409, 'order_already_paid')
    throw error
  }
  await audit(c.env, admin, 'order.mark_paid', 'order', order.id, { note })
  await notifyOrderPaid(c.env, order.id)
  return c.json({ ok: true })
})

// ---------- 生成任务 ----------

adminRoutes.get('/generations', async (c) => {
  const { limit, offset } = pageParams(c)
  const status = c.req.query('status')
  const db = c.env.DB
  const [rows, perCreditRow] = await db.batch([
    db
      .prepare(
        `SELECT g.*, u.email AS user_email FROM generations g JOIN users u ON u.id = g.user_id
         ${status ? 'WHERE g.status = ?' : ''} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...(status ? [status] : []), limit, offset),
    revenuePerCredit(db),
  ])
  return c.json({ generations: rows!.results, revenuePerCreditCents: perCredit(perCreditRow!) })
})

// 客服排查用：管理员可预览任意用户的成片
adminRoutes.get('/generations/:id/video', async (c) => {
  const row = await c.env.DB.prepare('SELECT output_r2_key FROM generations WHERE id = ?').bind(c.req.param('id')).first<{ output_r2_key: string | null }>()
  if (!row?.output_r2_key) throw new ApiError(404, 'not_ready')
  return serveR2Object(c.env.MEDIA, row.output_r2_key, c.req.raw, { cacheControl: 'private, no-store' })
})

adminRoutes.post('/generations/:id/fail', async (c) => {
  const admin = requireAdmin(c)
  const id = c.req.param('id')
  await failGeneration(c.env, id, 'admin_failed', 'Marked failed by admin')
  await audit(c.env, admin, 'generation.fail', 'generation', id)
  return c.json({ ok: true })
})

// ---------- 举报下架 ----------

adminRoutes.get('/takedowns', async (c) => {
  const { limit, offset } = pageParams(c)
  const status = c.req.query('status') ?? 'open'
  const rows = await c.env.DB.prepare(
    `SELECT t.*, g.status AS generation_status, g.removed_at AS generation_removed_at,
     g.output_r2_key IS NOT NULL AS has_output, u.email AS owner_email
     FROM takedown_requests t LEFT JOIN generations g ON g.id = t.generation_id LEFT JOIN users u ON u.id = g.user_id
     WHERE t.status = ? ORDER BY ${status === 'open' ? 't.due_at ASC' : 't.created_at DESC'} LIMIT ? OFFSET ?`,
  )
    .bind(status, limit, offset)
    .all()
  return c.json({ takedowns: rows.results })
})

// remove：删除同一原图的全部成片与原图并拉黑哈希；reject：驳回（必须写原因）
adminRoutes.post('/takedowns/:id/resolve', async (c) => {
  const admin = requireAdmin(c)
  const db = c.env.DB
  const report = await db.prepare('SELECT * FROM takedown_requests WHERE id = ?').bind(c.req.param('id')).first<TakedownRow>()
  if (!report) throw new ApiError(404, 'not_found')
  if (report.status !== 'open') throw new ApiError(409, 'already_resolved')
  const body = await readJson<{ action: 'remove' | 'reject'; generationId?: string; note?: string }>(c)
  const note = body.note?.trim().slice(0, 1000) ?? ''
  let result: Omit<Awaited<ReturnType<typeof removeReportedContent>>, 'owners'> | null = null
  let owners: Array<{ userId: string; videos: number }> = []
  let generationId = report.generation_id
  if (body.action === 'remove') {
    generationId = body.generationId?.trim() || report.generation_id
    const generation = generationId
      ? await db.prepare('SELECT * FROM generations WHERE id = ?').bind(generationId).first<GenerationRow>()
      : null
    if (!generation) throw new ApiError(404, 'generation_not_found')
    const { owners: removedOwners, ...removal } = await removeReportedContent(c.env, generation, report.id)
    owners = removedOwners
    result = removal
  } else if (body.action === 'reject') {
    if (!note) throw new ApiError(400, 'note_required')
  } else {
    throw new ApiError(400, 'invalid_action')
  }
  const status = body.action === 'remove' ? 'removed' : 'rejected'
  const updated = await db
    .prepare(
      `UPDATE takedown_requests SET status = ?, generation_id = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
       WHERE id = ? AND status = 'open'`,
    )
    .bind(status, generationId, nowIso(), admin.id, note || null, report.id)
    .run()
  if (!updated.meta.changes) throw new ApiError(409, 'already_resolved')
  await audit(c.env, admin, `takedown.${status}`, 'takedown', report.id, { generationId, note, ...result })
  await notifyTakedownResolved(c.env, report, status, owners)
  return c.json({ ok: true, status, ...result })
})

// ---------- 留言 / 支付事件 / 审计 ----------

adminRoutes.get('/messages', async (c) => {
  const { limit, offset } = pageParams(c)
  const status = c.req.query('status') ?? 'open'
  const rows = await c.env.DB.prepare('SELECT * FROM contact_messages WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(status, limit, offset)
    .all()
  return c.json({ messages: rows.results })
})

adminRoutes.post('/messages/:id/status', async (c) => {
  const admin = requireAdmin(c)
  const { status } = await readJson<{ status: 'open' | 'closed' }>(c)
  if (status !== 'open' && status !== 'closed') throw new ApiError(400, 'invalid_status')
  await c.env.DB.prepare('UPDATE contact_messages SET status = ? WHERE id = ?').bind(status, c.req.param('id')).run()
  await audit(c.env, admin, 'message.status', 'message', c.req.param('id'), { status })
  return c.json({ ok: true })
})

// ---------- 邮件 ----------

adminRoutes.get('/emails', async (c) => {
  const { limit, offset } = pageParams(c)
  const where: string[] = []
  const params: unknown[] = []
  const status = c.req.query('status')
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (q) {
    where.push('(lower(to_email) LIKE ? OR dedupe_key LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, dedupe_key, template, to_email, locale, subject, status, attempts, next_attempt_at, provider_message_id, last_error,
     created_at, sent_at FROM email_outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all()
  return c.json({ emails: rows.results, configured: Boolean(emailConfig(c.env)) })
})

// 重发 failed / skipped 的邮件（例如发件域名验证通过后）
adminRoutes.post('/emails/:id/retry', async (c) => {
  const admin = requireAdmin(c)
  if (!emailConfig(c.env)) throw new ApiError(409, 'email_not_configured')
  const id = c.req.param('id')
  const status = await retryEmail(c.env, id)
  if (!status) throw new ApiError(409, 'email_not_retryable')
  await audit(c.env, admin, 'email.retry', 'email', id, { status })
  return c.json({ ok: true, status })
})

adminRoutes.get('/payment-events', async (c) => {
  const { limit, offset } = pageParams(c)
  const status = c.req.query('status')
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, event_id, event_type, order_id, status, error, created_at FROM payment_events
     ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...(status ? [status] : []), limit, offset)
    .all()
  return c.json({ events: rows.results })
})

adminRoutes.get('/audit', async (c) => {
  const { limit, offset } = pageParams(c)
  const rows = await c.env.DB.prepare(
    `SELECT a.*, u.email AS admin_email FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_user_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all()
  return c.json({ entries: rows.results })
})
