import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AdminPage, FilterSelect, LoadState, PAGE_SIZE, Pager, adminAction, shortDate, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/messages')({
  component: AdminMessages,
})

type MessageRow = { id: string; user_id: string | null; email: string; topic: string; message: string; status: 'open' | 'closed'; created_at: string }

const TOPICS: Record<string, string> = { general: '一般咨询', billing: '账单', bug: 'Bug', partnership: '合作' }

function AdminMessages() {
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAdminData<{ messages: MessageRow[] }>(`/api/admin/messages?status=${status}&page=${page}`)
  const rows = data?.messages ?? []

  async function toggle(m: MessageRow) {
    if (await adminAction(`/api/admin/messages/${m.id}/status`, { status: m.status === 'open' ? 'closed' : 'open' })) await reload()
  }

  return (
    <AdminPage title="用户留言">
      <FilterSelect
        label="状态"
        value={status}
        onChange={(v) => {
          setStatus(v as 'open' | 'closed')
          setPage(1)
        }}
        options={[
          ['open', '待处理'],
          ['closed', '已关闭'],
        ]}
      />
      <LoadState loading={loading && !data} error={error} empty={!!data && !rows.length} />
      <div className="space-y-3" data-testid="admin-messages">
        {rows.map((m) => (
          <div key={m.id} className="card space-y-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="chip">{TOPICS[m.topic] ?? m.topic}</span>
                <a href={`mailto:${m.email}`} className="font-medium hover:underline">
                  {m.email}
                </a>
                {m.user_id ? <span className="text-xs text-muted">已登录用户</span> : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{shortDate(m.created_at)}</span>
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => toggle(m)}>
                  {m.status === 'open' ? '标记已处理' : '重新打开'}
                </button>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6">{m.message}</p>
          </div>
        ))}
      </div>
      <Pager page={page} onPage={setPage} hasMore={rows.length === PAGE_SIZE} />
    </AdminPage>
  )
}
