import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { displayToMinor } from '#/server/payments/amount'
import { AdminPage, FilterSelect, LoadState, PAGE_SIZE, Pager, Status, adminAction, money, promptNote, shortDate, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/orders')({
  component: AdminOrders,
})

type OrderRow = {
  id: string
  user_id: string
  user_email: string
  provider: string
  package_id: string
  credits: number
  amount_cents: number
  currency: string
  status: string
  provider_order_id: string | null
  provider_payment_id: string | null
  paid_amount: string | null
  paid_currency: string | null
  paid_amount_cents: number | null
  refunded_amount_cents: number
  refunded_credits: number
  source: string | null
  medium: string | null
  campaign: string | null
  country: string | null
  device: string | null
  created_at: string
  paid_at: string | null
  refunded_at: string | null
}

function AdminOrders() {
  const [status, setStatus] = useState('')
  const [provider, setProvider] = useState('')
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page) })
  if (status) params.set('status', status)
  if (provider) params.set('provider', provider)
  if (q) params.set('q', q)
  const { data, error, loading, reload } = useAdminData<{ orders: OrderRow[] }>(`/api/admin/orders?${params}`)
  const orders = data?.orders ?? []

  function search(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setQ(input.trim())
  }

  // provider：调用支付商退款 API 实际退钱，积分等退款 webhook 回来再回收；local：只本地记账（支付商后台已退但 webhook 丢失时用）
  async function refund(order: OrderRow, mode: 'provider' | 'local') {
    const currency = order.paid_currency ?? order.currency
    const remainingCents = Math.max(0, (order.paid_amount_cents ?? order.amount_cents) - order.refunded_amount_cents)
    const input = prompt(`退款订单 ${order.id}：退款金额（${currency}），最多 ${money(remainingCents, currency)}，留空 = 退全部剩余`, '')
    if (input === null) return
    const amountCents = input.trim() ? displayToMinor(input, currency) : null
    if (input.trim() && (amountCents === null || amountCents <= 0 || amountCents > remainingCents)) {
      alert('退款金额无效')
      return
    }
    const hint =
      mode === 'provider'
        ? `将调用 ${order.provider} 退款 API 实际退钱，积分在退款 webhook 到达后按金额比例回收。\nWaffo 每笔支付只能退款一次（14 天内）；Dodo 30 天内可多次部分退款，从商户钱包余额扣，余额不足会被拒。`
        : '仅本地记账并按比例回收积分，不会调用支付商（用于已在支付商后台退款但 webhook 丢失的情况）。'
    const note = promptNote(`${hint}\n请输入原因：`)
    if (!note) return
    let refundId: string | null = null
    if (mode === 'local' && order.provider !== 'mock') {
      // 与退款 webhook 共用幂等键，webhook 迟到也不会重复回收积分
      refundId = promptNote(`请填写支付商退款单号（Waffo 为 REF_ 开头，不是 TKT_ 工单号；Dodo 为 refund_id）：`)
      if (!refundId) return
    }
    if (await adminAction(`/api/admin/orders/${order.id}/refund`, { note, amountCents, mode, refundId })) {
      if (mode === 'provider') alert('退款已提交，订单与积分会在支付商回调后更新。')
      await reload()
    }
  }

  async function markPaid(order: OrderRow) {
    const note = promptNote(`补单 ${order.id}：发放 ${order.credits} 积分。\n请先在支付商后台确认已收款，并填写凭证（如支付流水号）：`)
    if (note && (await adminAction(`/api/admin/orders/${order.id}/mark-paid`, { note }))) await reload()
  }

  return (
    <AdminPage title="订单">
      <div className="flex flex-wrap items-center gap-4">
        <FilterSelect
          label="状态"
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          options={[
            ['', '全部'],
            ['paid', '已支付'],
            ['pending', '待支付'],
            ['failed', '失败'],
            ['refunded', '已退款'],
            ['canceled', '已取消'],
          ]}
        />
        <FilterSelect
          label="支付商"
          value={provider}
          onChange={(v) => {
            setProvider(v)
            setPage(1)
          }}
          options={[
            ['', '全部'],
            ['waffo', 'Waffo'],
            ['dodo', 'Dodo Payments'],
            ['mock', 'Mock'],
          ]}
        />
        <form onSubmit={search} className="flex gap-2">
          <input className="input w-72 py-1.5" placeholder="订单号 / 邮箱 / 支付商流水号" value={input} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="btn-primary px-4 py-1.5">
            搜索
          </button>
        </form>
      </div>
      <LoadState loading={loading && !data} error={error} empty={!!data && !orders.length} />
      {orders.length ? (
        <div className="card overflow-x-auto">
          <table className="table-admin" data-testid="admin-orders">
            <thead>
              <tr>
                <th>订单号</th>
                <th>用户</th>
                <th>支付商</th>
                <th>套餐</th>
                <th>金额</th>
                <th>状态</th>
                <th>来源</th>
                <th>创建 / 支付</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-xs">
                    {o.id}
                    {o.provider_payment_id ? <span className="block text-muted">{o.provider_payment_id}</span> : null}
                  </td>
                  <td>
                    <Link to="/admin/users/$id" params={{ id: o.user_id }} className="hover:underline">
                      {o.user_email}
                    </Link>
                  </td>
                  <td>{o.provider}</td>
                  <td>
                    {o.package_id} · {o.credits}
                  </td>
                  <td>
                    {money(o.amount_cents, o.currency)}
                    {o.paid_amount && o.paid_currency && o.paid_currency !== o.currency ? (
                      <span className="block text-xs text-muted">
                        实付 {o.paid_amount} {o.paid_currency}
                      </span>
                    ) : null}
                    {o.refunded_amount_cents > 0 ? (
                      <span className="block text-xs text-muted">
                        已退 {money(o.refunded_amount_cents, o.paid_currency ?? o.currency)} · {o.refunded_credits} 积分
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <Status value={o.status === 'paid' && o.refunded_amount_cents > 0 ? 'partially_refunded' : o.status} />
                  </td>
                  <td className="text-xs">
                    {o.source ? `${o.source} / ${o.medium ?? '-'}` : '-'}
                    <span className="block text-muted">
                      {[o.campaign, o.country, o.device].filter(Boolean).join(' · ') || null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {shortDate(o.created_at)}
                    <span className="block text-muted">{shortDate(o.paid_at)}</span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {/* Waffo 每笔支付只能退一次，退过后只能"仅记账" */}
                    {o.status === 'paid' && !(o.provider === 'waffo' && o.refunded_amount_cents > 0) ? (
                      <button
                        type="button"
                        className="btn-ghost px-2.5 py-1 text-xs"
                        onClick={() => refund(o, o.provider === 'mock' ? 'local' : 'provider')}
                        data-testid={`refund-${o.id}`}
                      >
                        退款
                      </button>
                    ) : null}
                    {o.status === 'paid' && o.provider !== 'mock' ? (
                      <button type="button" className="btn-ghost px-2.5 py-1 text-xs text-muted" onClick={() => refund(o, 'local')}>
                        仅记账
                      </button>
                    ) : null}
                    {o.status === 'pending' || o.status === 'failed' || o.status === 'canceled' ? (
                      <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => markPaid(o)}>
                        补单
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pager page={page} onPage={setPage} hasMore={orders.length === PAGE_SIZE} />
    </AdminPage>
  )
}
