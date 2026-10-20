import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { site } from '#/config/site'
import type { RequestAttribution } from './attribution'
import { ledgerStatements } from './credits'
import type { AppContext, UserRow } from './types'
import { ApiError, createId, isProduction, nowIso, randomToken, sha256Hex } from './util'

const SESSION_DAYS = 30

export function sessionCookieName(env: Env) {
  // __Host- 前缀要求 Secure + Path=/ + 无 Domain，只在 HTTPS 生产环境使用
  return isProduction(env) ? '__Host-sid' : 'sid'
}

export async function loadSessionUser(c: Context<AppContext>): Promise<UserRow | null> {
  const token = getCookie(c, sessionCookieName(c.env))
  if (!token) return null
  const id = await sha256Hex(token)
  const user = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, nowIso())
    .first<UserRow>()
  if (!user || user.status !== 'active') return null
  return user
}

export async function startSession(c: Context<AppContext>, userId: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256Hex(token),
      userId,
      expires.toISOString(),
      nowIso(),
      c.req.header('user-agent')?.slice(0, 300) ?? null,
      c.req.header('cf-connecting-ip') ?? null,
    )
    .run()
  setCookie(c, sessionCookieName(c.env), token, {
    httpOnly: true,
    secure: isProduction(c.env),
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

export async function endSession(c: Context<AppContext>) {
  const name = sessionCookieName(c.env)
  const token = getCookie(c, name)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  deleteCookie(c, name, { path: '/', secure: isProduction(c.env) })
}

export function adminEmails(env: Env) {
  return env.ADMIN_EMAILS.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(env: Env, email: string) {
  return adminEmails(env).includes(email.toLowerCase())
}

export interface SignInProfile {
  email: string
  name: string | null
  picture: string | null
  googleSub: string | null
  country: string | null
  locale: string | null
  attribution?: RequestAttribution | null // 仅新用户注册时写入
}

// Google 登录与 dev 登录共用：按 google_sub / email 找人，没有就创建并发放注册赠送积分。
export async function upsertUser(env: Env, profile: SignInProfile): Promise<UserRow> {
  const email = profile.email.trim().toLowerCase()
  const db = env.DB
  const existing = await db
    .prepare('SELECT * FROM users WHERE (google_sub IS NOT NULL AND google_sub = ?) OR email = ? LIMIT 1')
    .bind(profile.googleSub, email)
    .first<UserRow>()
  const now = nowIso()
  const role = isAdminEmail(env, email) ? 'admin' : undefined

  if (existing) {
    if (existing.status !== 'active') throw new ApiError(403, 'account_disabled')
    await db
      .prepare(
        `UPDATE users SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url),
         google_sub = COALESCE(google_sub, ?), role = COALESCE(?, role), last_login_at = ? WHERE id = ?`,
      )
      .bind(profile.name, profile.picture, profile.googleSub, role ?? null, now, existing.id)
      .run()
    return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(existing.id).first<UserRow>())!
  }

  const id = createId('usr')
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, name, avatar_url, google_sub, role, status, credits, locale, country,
         signup_source, signup_medium, signup_campaign, signup_device, attribution, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        email,
        profile.name,
        profile.picture,
        profile.googleSub,
        role ?? 'user',
        profile.locale,
        profile.country ?? profile.attribution?.country ?? null,
        profile.attribution?.source ?? null,
        profile.attribution?.medium ?? null,
        profile.attribution?.campaign ?? null,
        profile.attribution?.device ?? null,
        profile.attribution?.json ?? null,
        now,
        now,
      ),
  ]
  if (site.signupBonusCredits > 0) {
    statements.push(
      ...ledgerStatements(db, {
        userId: id,
        delta: site.signupBonusCredits,
        reason: 'signup_bonus',
        idempotencyKey: `signup:${id}`,
      }),
    )
  }
  await db.batch(statements)
  return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>())!
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role,
    credits: user.credits,
    createdAt: user.created_at,
  }
}
