import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AdminPage, LoadState, PAGE_SIZE, Pager, shortDate, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/audit')({
  component: AdminAudit,
})

type AuditRow = {
  id: string
  admin_user_id: string
  admin_email: string | null
  action: string
  target_type: string
  target_id: string
  detail: string | null
  created_at: string
}

const ACTIONS: Record<string, string> = {
  'credits.adjust': '调整积分',
  'user.ban': '封禁用户',
  'user.unban': '解封用户',
  'user.role': '修改角色',
  'order.refund': '订单退款',
  'order.mark_paid': '补单',
  'generation.fail': '任务标记失败',
  'message.status': '留言状态',
}

function AdminAudit() {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useAdminData<{ entries: AuditRow[] }>(`/api/admin/audit?page=${page}`)
  const rows = data?.entries ?? []

  return (
    <AdminPage title="审计日志">
      <LoadState loading={loading && !data} error={error} empty={!!data && !rows.length} />
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table-admin" data-testid="admin-audit">
            <thead>
              <tr>
                <th>时间</th>
                <th>管理员</th>
                <th>操作</th>
                <th>对象</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-xs">{shortDate(a.created_at)}</td>
                  <td>{a.admin_email ?? a.admin_user_id}</td>
                  <td>{ACTIONS[a.action] ?? a.action}</td>
                  <td className="font-mono text-xs">
                    {a.target_type}:{a.target_id}
                  </td>
                  <td className="max-w-md truncate font-mono text-xs text-muted" title={a.detail ?? ''}>
                    {a.detail ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pager page={page} onPage={setPage} hasMore={rows.length === PAGE_SIZE} />
    </AdminPage>
  )
}
