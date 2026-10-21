import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AdminPage, FilterSelect, LoadState, shortDate, useAdminData } from '#/components/admin'
import { StatusPill } from '#/components/ui'

export const Route = createFileRoute('/admin/referrals')({
  component: AdminReferrals,
})

type Counts = { invited: number; rewarded: number; reversed: number; rejected: number; credits: number }
type Leader = Counts & { userId: string; email: string; code: string | null; lastAt: string }
type Recent = {
  inviteeId: string
  inviteeEmail: string
  inviterId: string
  inviterEmail: string
  status: 'pending' | 'rewarded' | 'reversed' | 'rejected'
  rejectReason: string | null
  orderId: string | null
  credits: number | null
  createdAt: string
}
type Data = { leaders: Leader[]; recent: Recent[]; totals: Counts }

const STATUS: Record<Recent['status'], [string, 'ok' | 'warn' | 'bad' | 'muted']> = {
  pending: ['等待首单', 'muted'],
  rewarded: ['已发奖励', 'ok'],
  reversed: ['已回收', 'warn'],
  rejected: ['不发奖励', 'bad'],
}
const REJECT_REASONS: Record<string, string> = {
  ip_limit: '同一 IP 超出上限',
  monthly_cap: '邀请人 30 天奖励已达上限',
  inviter_inactive: '邀请人已封禁或注销',
  paused: '首单付款时邀请奖励已暂停',
}

// 邀请排行：按邀请时间筛选，排行按已发奖励数排序；奖励规则见 site.referral*
function AdminReferrals() {
  const [days, setDays] = useState('30')
  const { data, error, loading } = useAdminData<Data>(`/api/admin/referrals?days=${days}`)

  return (
    <AdminPage
      title="邀请排行"
      actions={
        <FilterSelect
          label="时间范围"
          value={days}
          onChange={setDays}
          options={[
            ['7', '近 7 天'],
            ['30', '近 30 天'],
            ['90', '近 90 天'],
            ['0', '全部'],
          ]}
        />
      }
    >
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <p className="text-sm text-muted" data-testid="referral-totals">
            注册 {data.totals.invited} · 已发奖励 {data.totals.rewarded}（{data.totals.credits} 积分）· 已回收 {data.totals.reversed} · 不发奖励{' '}
            {data.totals.rejected}
          </p>
          <section className="card space-y-3 overflow-x-auto p-5">
            <h2 className="font-semibold">邀请人</h2>
            {data.leaders.length ? (
              <table className="table-admin" data-testid="admin-referral-leaders">
                <thead>
                  <tr className="whitespace-nowrap">
                    <th>邀请人</th>
                    <th>邀请码</th>
                    <th>注册</th>
                    <th>已发奖励</th>
                    <th>已回收</th>
                    <th>不发奖励</th>
                    <th>奖励积分</th>
                    <th>最近邀请</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaders.map((row) => (
                    <tr key={row.userId} data-testid="admin-referral-leader" data-user={row.userId}>
                      <td>
                        <Link to="/admin/users/$id" params={{ id: row.userId }} className="hover:underline">
                          {row.email}
                        </Link>
                      </td>
                      <td className="font-mono text-xs">{row.code ?? '—'}</td>
                      <td>{row.invited}</td>
                      <td>{row.rewarded}</td>
                      <td>{row.reversed}</td>
                      <td>{row.rejected}</td>
                      <td>{row.credits}</td>
                      <td className="whitespace-nowrap text-xs">{shortDate(row.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">暂无数据</p>
            )}
          </section>
          <section className="card space-y-3 overflow-x-auto p-5">
            <h2 className="font-semibold">最近邀请</h2>
            {data.recent.length ? (
              <table className="table-admin" data-testid="admin-referral-recent">
                <thead>
                  <tr className="whitespace-nowrap">
                    <th>被邀请人</th>
                    <th>邀请人</th>
                    <th>状态</th>
                    <th>奖励订单</th>
                    <th>注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => {
                    const [label, tone] = STATUS[row.status]
                    return (
                      <tr key={row.inviteeId} data-testid="admin-referral-row" data-invitee={row.inviteeId}>
                        <td>
                          <Link to="/admin/users/$id" params={{ id: row.inviteeId }} className="hover:underline">
                            {row.inviteeEmail}
                          </Link>
                        </td>
                        <td>
                          <Link to="/admin/users/$id" params={{ id: row.inviterId }} className="hover:underline">
                            {row.inviterEmail}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap" title={row.rejectReason ? (REJECT_REASONS[row.rejectReason] ?? row.rejectReason) : undefined}>
                          <StatusPill tone={tone}>{label}</StatusPill>
                          {row.rejectReason ? <span className="ml-2 text-xs text-muted">{REJECT_REASONS[row.rejectReason] ?? row.rejectReason}</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {row.orderId ? (
                            <Link to="/admin/orders/$id" params={{ id: row.orderId }} className="font-mono hover:underline">
                              {row.orderId}
                            </Link>
                          ) : (
                            '—'
                          )}
                          {row.credits ? ` · ${row.credits} 积分` : null}
                        </td>
                        <td className="whitespace-nowrap text-xs">{shortDate(row.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">暂无数据</p>
            )}
          </section>
        </>
      ) : null}
    </AdminPage>
  )
}
