import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AdminPage, LoadState, Status, adminAction, money, shortDate, useAdminData } from '#/components/admin'
import { orderStatus, type AdminOrder } from '#/components/admin-orders'
import type { Generation } from '#/lib/api'
import { useSession } from '#/lib/session'
import type { AdminUserRow } from './users.index'

export const Route = createFileRoute('/admin/users/$id')({
  component: AdminUserDetail,
})

type LedgerRow = { id: string; delta: number; reason: string; note: string | null; created_at: string }
type SubscriptionRow = {
  id: string
  provider: string
  provider_subscription_id: string
  plan_id: string
  interval: 'month' | 'year'
  credits_per_month: number
  amount_cents: number
  currency: string
  status: string
  cancel_at_period_end: number
  current_period_start: string | null
  current_period_end: string | null
  current_order_id: string | null
  grants_done: number
  next_grant_at: string | null
  created_at: string
  ended_at: string | null
}
type GrantRow = { id: string; source: string; ref_id: string | null; amount: number; remaining: number; expires_at: string | null; created_at: string }
type Detail = {
  user: AdminUserRow & { google_sub: string | null; locale: string | null }
  orders: Omit<AdminOrder, 'user_email'>[]
  ledger: LedgerRow[]
  grants: GrantRow[]
  subscriptions: SubscriptionRow[]
  generations: (Generation & { errorMessage: string | null })[]
  spend: { currency: string; orders: number; paid_cents: number; refunded_cents: number }[]
  generationStats: { status: string; n: number; credits: number }[]
  audit: { id: string; action: string; detail: string | null; created_at: string; admin_email: string | null }[]
}

function AdminUserDetail() {
  const { id } = Route.useParams()
  const { user: me } = useSession()
  const { data, error, loading, reload } = useAdminData<Detail>(`/api/admin/users/${encodeURIComponent(id)}`)
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)

  async function adjust(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const expiresInDays = days ? Number(days) : null
    const ok = await adminAction(
      `/api/admin/users/${id}/credits`,
      { delta: Number(delta), note, expiresInDays },
      `确认调整 ${delta} 积分${expiresInDays ? `（${expiresInDays} 天后到期）` : ''}？`,
    )
    setBusy(false)
    if (ok) {
      setDelta('')
      setNote('')
      setDays('')
      await reload()
    }
  }

  async function setStatus(status: 'active' | 'banned') {
    if (await adminAction(`/api/admin/users/${id}/status`, { status }, status === 'banned' ? '封禁后该用户会被立即登出，确认？' : '确认解封？')) await reload()
  }

  async function setRole(role: 'user' | 'admin') {
    if (await adminAction(`/api/admin/users/${id}/role`, { role }, role === 'admin' ? '确认设为管理员？' : '确认取消管理员？')) await reload()
  }

  const u = data?.user
  const isSelf = me?.id === id

  return (
    <AdminPage
      title={u?.email ?? '用户详情'}
      actions={
        <Link to="/admin/users" className="btn-ghost px-3 py-1.5 text-sm">
          <ArrowLeft className="size-4" /> 用户列表
        </Link>
      }
    >
      <LoadState loading={loading && !data} error={error} />
      {u && data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card space-y-3 p-5 text-sm lg:col-span-2">
              <dl className="grid grid-cols-[110px_1fr] gap-y-2">
                <dt className="text-muted">用户 ID</dt>
                <dd className="font-mono text-xs">{u.id}</dd>
                <dt className="text-muted">姓名</dt>
                <dd>{u.name ?? '—'}</dd>
                <dt className="text-muted">状态</dt>
                <dd>
                  <Status value={u.status} />
                </dd>
                <dt className="text-muted">角色</dt>
                <dd>{u.role === 'admin' ? '管理员' : '用户'}</dd>
                <dt className="text-muted">积分余额</dt>
                <dd className="font-mono text-lg font-semibold" data-testid="admin-user-credits">
                  {u.credits}
                </dd>
                <dt className="text-muted">国家 / 语言</dt>
                <dd>
                  {u.country ?? '—'} / {u.locale ?? '—'}
                </dd>
                <dt className="text-muted">注册 / 最近登录</dt>
                <dd>
                  {shortDate(u.created_at)} / {shortDate(u.last_login_at)}
                </dd>
              </dl>
              {u.status !== 'deleted' && !isSelf ? (
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {u.status === 'banned' ? (
                    <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setStatus('active')}>
                      解封
                    </button>
                  ) : (
                    <button type="button" className="btn-danger px-3 py-1.5" onClick={() => setStatus('banned')} data-testid="admin-ban">
                      封禁
                    </button>
                  )}
                  <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setRole(u.role === 'admin' ? 'user' : 'admin')}>
                    {u.role === 'admin' ? '取消管理员' : '设为管理员'}
                  </button>
                </div>
              ) : null}
            </div>
            <form onSubmit={adjust} className="card space-y-3 p-5 text-sm">
              <h2 className="font-semibold">调整积分</h2>
              <p className="text-xs text-muted">正数为补发，负数为扣减（先扣快到期的批次）；会写入流水和审计日志。</p>
              <input className="input" type="number" step={1} required placeholder="例如 10 或 -5" value={delta} onChange={(e) => setDelta(e.target.value)} data-testid="admin-delta" />
              <input className="input" required placeholder="原因（必填）" value={note} onChange={(e) => setNote(e.target.value)} data-testid="admin-note" />
              {Number(delta) > 0 ? (
                <input className="input" type="number" min={1} max={3650} step={1} placeholder="有效期（天，留空永不过期）" value={days} onChange={(e) => setDays(e.target.value)} data-testid="admin-expiry-days" />
              ) : null}
              <button type="submit" className="btn-primary w-full" disabled={busy || !delta || !note.trim()} data-testid="admin-adjust">
                提交
              </button>
            </form>
          </div>

          <Summary data={data} />

          {data.subscriptions.length ? (
            <Section title={`订阅（${data.subscriptions.length}）`}>
              <table className="table-admin" data-testid="admin-user-subscriptions">
                <thead>
                  <tr>
                    <th>订阅</th>
                    <th>套餐</th>
                    <th>状态</th>
                    <th>当期</th>
                    <th>当期订单 / 已发月数</th>
                    <th>创建 / 结束</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="font-mono text-xs">
                        {s.id}
                        <span className="block text-muted">
                          {s.provider} · {s.provider_subscription_id}
                        </span>
                      </td>
                      <td>
                        {s.plan_id} · {money(s.amount_cents, s.currency)} / {s.interval === 'year' ? '年' : '月'}
                        <span className="block text-xs text-muted">每月 {s.credits_per_month} 积分</span>
                      </td>
                      <td>
                        <Status value={s.status} />
                        {s.cancel_at_period_end ? <span className="block text-xs text-muted">到期取消</span> : null}
                      </td>
                      <td className="whitespace-nowrap">
                        {shortDate(s.current_period_start)} – {shortDate(s.current_period_end)}
                        {s.next_grant_at ? <span className="block text-xs text-muted">下次补发 {shortDate(s.next_grant_at)}</span> : null}
                      </td>
                      <td className="font-mono text-xs">
                        {s.current_order_id ? (
                          <Link to="/admin/orders/$id" params={{ id: s.current_order_id }} className="hover:underline">
                            {s.current_order_id}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="block text-muted">{s.grants_done} 个月</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {shortDate(s.created_at)} / {shortDate(s.ended_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}

          <Section title={`订单（${data.orders.length}）`}>
            <table className="table-admin" data-testid="admin-user-orders">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>支付商</th>
                  <th>套餐</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs">
                      <Link to="/admin/orders/$id" params={{ id: o.id }} className="hover:underline">
                        {o.id}
                      </Link>
                    </td>
                    <td>{o.provider}</td>
                    <td>
                      {o.package_id} · {o.credits} 积分
                    </td>
                    <td>
                      {money(o.paid_amount_cents ?? o.amount_cents, o.paid_currency ?? o.currency)}
                      {o.refunded_amount_cents > 0 ? (
                        <span className="block text-xs text-muted">
                          已退 {money(o.refunded_amount_cents, o.paid_currency ?? o.currency)} · {o.refunded_credits} 积分
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Status value={orderStatus(o)} />
                    </td>
                    <td className="whitespace-nowrap">{shortDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={`积分批次（${data.grants.length}）`}>
            <table className="table-admin" data-testid="admin-user-grants">
              <thead>
                <tr>
                  <th>入账时间</th>
                  <th>来源</th>
                  <th>到期</th>
                  <th className="text-right">剩余 / 入账</th>
                </tr>
              </thead>
              <tbody>
                {data.grants.map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap">{shortDate(g.created_at)}</td>
                    <td>{g.source}</td>
                    <td className="whitespace-nowrap">{g.expires_at ? shortDate(g.expires_at) : '永不过期'}</td>
                    <td className="text-right font-mono">
                      {g.remaining} / {g.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={`积分流水（${data.ledger.length}）`}>
            <table className="table-admin">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>原因</th>
                  <th>备注</th>
                  <th className="text-right">变动</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{shortDate(l.created_at)}</td>
                    <td>{l.reason}</td>
                    <td className="max-w-xs truncate text-muted">{l.note ?? ''}</td>
                    <td className={`text-right font-mono ${l.delta > 0 ? 'text-emerald-600' : ''}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={`生成任务（${data.generations.length}）`}>
            <table className="table-admin">
              <thead>
                <tr>
                  <th>任务 ID</th>
                  <th>时长</th>
                  <th>状态</th>
                  <th>错误</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.generations.map((g) => (
                  <tr key={g.id}>
                    <td className="font-mono text-xs">
                      {g.status === 'succeeded' ? (
                        <a href={`/api/admin/generations/${g.id}/video`} target="_blank" rel="noreferrer" className="hover:underline">
                          {g.id}
                        </a>
                      ) : (
                        g.id
                      )}
                    </td>
                    <td>
                      {g.durationSeconds}s · {g.creditsCost} 积分
                    </td>
                    <td>
                      <Status value={g.status} />
                      {g.refunded ? <span className="ml-1 text-xs text-muted">已退积分</span> : null}
                    </td>
                    <td className="max-w-xs truncate text-xs text-muted" title={g.errorMessage ?? ''}>
                      {g.errorCode ?? ''}
                    </td>
                    <td className="whitespace-nowrap">{shortDate(g.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={`管理员操作（${data.audit.length}）`}>
            <table className="table-admin" data-testid="admin-user-audit">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>管理员</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{shortDate(a.created_at)}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td>{a.admin_email ?? '—'}</td>
                    <td className="max-w-md truncate text-xs text-muted" title={a.detail ?? ''}>
                      {a.detail ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      ) : null}
    </AdminPage>
  )
}

// 累计付款（按实收币种，含已退部分）与生成概况，不受下方列表条数截断影响
function Summary({ data }: { data: Detail }) {
  const stat = (status: string) => data.generationStats.find((s) => s.status === status)
  const totalGenerations = data.generationStats.reduce((sum, s) => sum + s.n, 0)
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="admin-user-summary">
      <div className="card space-y-1 p-5 text-sm">
        <h2 className="font-semibold">累计付款</h2>
        {data.spend.length ? (
          data.spend.map((s) => (
            <p key={s.currency}>
              <span className="font-mono text-lg font-semibold">{money(s.paid_cents - s.refunded_cents, s.currency)}</span>
              <span className="ml-2 text-xs text-muted">
                净额 · {s.orders} 笔付款
                {s.refunded_cents > 0 ? ` · 已退 ${money(s.refunded_cents, s.currency)}` : ''}
              </span>
            </p>
          ))
        ) : (
          <p className="text-muted">未付过款</p>
        )}
      </div>
      <div className="card space-y-1 p-5 text-sm">
        <h2 className="font-semibold">生成任务</h2>
        <p>
          <span className="font-mono text-lg font-semibold">{totalGenerations}</span>
          <span className="ml-2 text-xs text-muted">
            成功 {stat('succeeded')?.n ?? 0}（{stat('succeeded')?.credits ?? 0} 积分）· 失败 {stat('failed')?.n ?? 0} · 进行中{' '}
            {(stat('queued')?.n ?? 0) + (stat('processing')?.n ?? 0)}
          </span>
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      <div className="card overflow-x-auto">{children}</div>
    </section>
  )
}
