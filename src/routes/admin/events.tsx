import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AdminPage, FilterSelect, LoadState, PAGE_SIZE, Pager, Status, shortDate, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/events')({
  component: AdminEvents,
})

type EventRow = {
  id: string
  provider: string
  event_id: string
  event_type: string
  order_id: string | null
  status: string
  error: string | null
  created_at: string
}

// 支付 webhook 记录：failed / orphan / mismatch 的事件需要对照支付商后台人工补单或退款
function AdminEvents() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, error, loading } = useAdminData<{ events: EventRow[] }>(`/api/admin/payment-events?page=${page}${status ? `&status=${status}` : ''}`)
  const rows = data?.events ?? []

  return (
    <AdminPage title="支付事件">
      <p className="text-sm text-muted">每个 webhook 事件按 (支付商, 事件 ID) 去重。处理失败、找不到订单或金额/商品与订单不符的付款都没有入账，请到支付商后台核对：确认已足额收款后在「订单」页补单，否则在支付商后台退款。</p>
      <FilterSelect
        label="状态"
        value={status}
        onChange={(v) => {
          setStatus(v)
          setPage(1)
        }}
        options={[
          ['', '全部'],
          ['processed', '已处理'],
          ['ignored', '已忽略'],
          ['failed', '失败'],
          ['orphan', '找不到订单'],
          ['mismatch', '金额/商品不符'],
        ]}
      />
      <LoadState loading={loading && !data} error={error} empty={!!data && !rows.length} />
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table-admin" data-testid="admin-events">
            <thead>
              <tr>
                <th>时间</th>
                <th>支付商</th>
                <th>事件类型</th>
                <th>事件 ID</th>
                <th>订单</th>
                <th>状态</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{shortDate(e.created_at)}</td>
                  <td>{e.provider}</td>
                  <td className="font-mono text-xs">{e.event_type}</td>
                  <td className="max-w-[12rem] truncate font-mono text-xs" title={e.event_id}>
                    {e.event_id}
                  </td>
                  <td className="font-mono text-xs">{e.order_id ?? '—'}</td>
                  <td>
                    <Status value={e.status} />
                  </td>
                  <td className="max-w-xs truncate text-xs text-red-600" title={e.error ?? ''}>
                    {e.error ?? ''}
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
