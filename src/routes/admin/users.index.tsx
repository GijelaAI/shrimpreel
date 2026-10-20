import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { AdminPage, FilterSelect, LoadState, PAGE_SIZE, Pager, Status, shortDate, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/users/')({
  component: AdminUsers,
})

export type AdminUserRow = {
  id: string
  email: string
  name: string | null
  role: 'user' | 'admin'
  status: 'active' | 'banned' | 'deleted'
  credits: number
  country: string | null
  created_at: string
  last_login_at: string | null
}

function AdminUsers() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [paying, setPaying] = useState('')
  const [sort, setSort] = useState('created')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page), sort })
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  if (role) params.set('role', role)
  if (paying) params.set('paying', paying)
  const { data, error, loading } = useAdminData<{ users: (AdminUserRow & { paid_orders: number })[] }>(`/api/admin/users?${params}`)
  const users = data?.users ?? []

  function search(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setQ(input.trim())
  }

  // 改筛选条件时回到第一页
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value)
    setPage(1)
  }

  return (
    <AdminPage title="用户">
      <div className="flex flex-wrap items-center gap-4">
        <FilterSelect
          label="状态"
          value={status}
          onChange={filter(setStatus)}
          options={[
            ['', '全部'],
            ['active', '正常'],
            ['banned', '封禁'],
            ['deleted', '已注销'],
          ]}
        />
        <FilterSelect
          label="角色"
          value={role}
          onChange={filter(setRole)}
          options={[
            ['', '全部'],
            ['user', '用户'],
            ['admin', '管理员'],
          ]}
        />
        <FilterSelect
          label="付费"
          value={paying}
          onChange={filter(setPaying)}
          options={[
            ['', '全部'],
            ['1', '付过款'],
          ]}
        />
        <FilterSelect
          label="排序"
          value={sort}
          onChange={filter(setSort)}
          options={[
            ['created', '注册时间'],
            ['login', '最近登录'],
            ['credits', '积分余额'],
          ]}
        />
        <form onSubmit={search} className="flex gap-2">
          <input className="input w-64 py-1.5" placeholder="邮箱或用户 ID" value={input} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="btn-primary px-4 py-1.5">
            搜索
          </button>
        </form>
      </div>
      <LoadState loading={loading && !data} error={error} empty={!!data && !users.length} />
      {users.length ? (
        <div className="card overflow-x-auto">
          <table className="table-admin" data-testid="admin-users">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th className="text-right">积分</th>
                <th className="text-right">付款订单</th>
                <th>国家</th>
                <th>注册时间</th>
                <th>最近登录</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to="/admin/users/$id" params={{ id: u.id }} className="font-medium hover:underline">
                      {u.email}
                    </Link>
                    {u.name ? <span className="block text-xs text-muted">{u.name}</span> : null}
                  </td>
                  <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                  <td>
                    <Status value={u.status} />
                  </td>
                  <td className="text-right font-mono">{u.credits}</td>
                  <td className="text-right font-mono">{u.paid_orders || '—'}</td>
                  <td>{u.country ?? '—'}</td>
                  <td className="whitespace-nowrap">{shortDate(u.created_at)}</td>
                  <td className="whitespace-nowrap">{shortDate(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pager page={page} onPage={setPage} hasMore={users.length === PAGE_SIZE} />
    </AdminPage>
  )
}
