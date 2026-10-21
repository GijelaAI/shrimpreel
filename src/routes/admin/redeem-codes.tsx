import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { AdminPage, LoadState, PAGE_SIZE, Pager, adminAction, shortDate, useAdminData } from '#/components/admin'
import { StatusPill } from '#/components/ui'
import { api, errorCode } from '#/lib/api'

export const Route = createFileRoute('/admin/redeem-codes')({
  component: AdminRedeemCodes,
})

type CodeRow = {
  code: string
  display: string
  batch_id: string
  credits: number
  max_uses: number
  used_count: number
  credit_valid_days: number | null
  expires_at: string | null
  note: string
  disabled_at: string | null
  created_at: string
}

type Created = { batchId: string; codes: string[] }

function codeStatus(row: CodeRow): [string, 'ok' | 'warn' | 'bad' | 'muted'] {
  if (row.disabled_at) return ['已停用', 'bad']
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return ['已截止', 'muted']
  if (row.used_count >= row.max_uses) return ['已用完', 'muted']
  return ['可用', 'ok']
}

// 兑换码：批量生成随机码（或指定一个活动码），导出 CSV 发给用户；用户在设置页兑换成积分批次
function AdminRedeemCodes() {
  const [form, setForm] = useState({ credits: '', count: '1', maxUses: '1', creditValidDays: '', expiresInDays: '', note: '', code: '' })
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [batch, setBatch] = useState('')
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page) })
  if (batch) params.set('batch', batch)
  if (q) params.set('q', q)
  const { data, error, loading, reload } = useAdminData<{ codes: CodeRow[] }>(`/api/admin/redeem-codes?${params}`)
  const rows = data?.codes ?? []
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  async function create(event: FormEvent) {
    event.preventDefault()
    const count = form.code.trim() ? 1 : Number(form.count)
    const summary = `生成 ${count} 个兑换码，每个 ${form.credits} 积分、可用 ${form.maxUses} 次`
    if (!confirm(`${summary}？`)) return
    setBusy(true)
    try {
      const result = await api<Created>('/api/admin/redeem-codes', {
        json: {
          credits: Number(form.credits),
          count,
          maxUses: Number(form.maxUses),
          creditValidDays: form.creditValidDays ? Number(form.creditValidDays) : null,
          expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null,
          note: form.note,
          code: form.code.trim() || undefined,
        },
      })
      setCreated(result)
      setForm((f) => ({ ...f, code: '' }))
      setBatch(result.batchId)
      setPage(1)
      await reload()
    } catch (err) {
      alert(`操作失败：${errorCode(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function search(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setQ(input.trim())
  }

  async function disable(row: CodeRow) {
    if (await adminAction(`/api/admin/redeem-codes/${row.code}/disable`, {}, `停用 ${row.display}？已兑换的积分不受影响。`)) await reload()
  }

  return (
    <AdminPage title="兑换码">
      <form onSubmit={create} className="card grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="redeem-create">
        <label className="space-y-1">
          <span className="text-xs text-muted">每个码的积分</span>
          <input className="input" type="number" min={1} max={100000} step={1} required value={form.credits} onChange={(e) => set('credits')(e.target.value)} data-testid="redeem-credits" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">生成数量（1–1000）</span>
          <input className="input" type="number" min={1} max={1000} step={1} required disabled={!!form.code.trim()} value={form.code.trim() ? '1' : form.count} onChange={(e) => set('count')(e.target.value)} data-testid="redeem-count" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">每个码可用次数（每人一次）</span>
          <input className="input" type="number" min={1} max={100000} step={1} required value={form.maxUses} onChange={(e) => set('maxUses')(e.target.value)} data-testid="redeem-max-uses" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">指定活动码（可选，4–32 位字母数字）</span>
          <input className="input uppercase" maxLength={40} placeholder="例如 LAUNCH2026" value={form.code} onChange={(e) => set('code')(e.target.value)} data-testid="redeem-custom" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">积分有效期（天，留空永不过期）</span>
          <input className="input" type="number" min={1} max={3650} step={1} value={form.creditValidDays} onChange={(e) => set('creditValidDays')(e.target.value)} data-testid="redeem-valid-days" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">兑换截止（天后，留空不截止）</span>
          <input className="input" type="number" min={1} max={3650} step={1} value={form.expiresInDays} onChange={(e) => set('expiresInDays')(e.target.value)} data-testid="redeem-expires-days" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs text-muted">备注（必填，例如活动名、渠道）</span>
          <input className="input" required maxLength={200} value={form.note} onChange={(e) => set('note')(e.target.value)} data-testid="redeem-note" />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn-primary px-5" disabled={busy || !form.credits || !form.note.trim()} data-testid="redeem-submit">
            生成
          </button>
        </div>
      </form>

      {created ? (
        <div className="card space-y-3 p-5 text-sm" data-testid="redeem-created">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">已生成 {created.codes.length} 个兑换码</h2>
            <a className="btn-ghost px-3 py-1.5 text-sm" href={`/api/admin/redeem-codes.csv?batch=${created.batchId}`} data-testid="redeem-csv">
              导出本批 CSV
            </a>
          </div>
          <textarea className="input h-32 font-mono text-xs" readOnly value={created.codes.join('\n')} data-testid="redeem-created-codes" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <form onSubmit={search} className="flex gap-2">
          <input className="input w-72 py-1.5" placeholder="兑换码 / 备注" value={input} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="btn-primary px-4 py-1.5">
            搜索
          </button>
        </form>
        {batch ? (
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-sm"
            onClick={() => {
              setBatch('')
              setPage(1)
            }}
          >
            显示全部批次
          </button>
        ) : null}
      </div>
      <LoadState loading={loading && !data} error={error} empty={!!data && !rows.length} />
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table-admin" data-testid="admin-redeem-codes">
            <thead>
              <tr className="whitespace-nowrap">
                <th>兑换码</th>
                <th>积分</th>
                <th>已用 / 次数</th>
                <th>积分有效期</th>
                <th>兑换截止</th>
                <th>备注</th>
                <th>状态</th>
                <th>创建</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [label, tone] = codeStatus(row)
                return (
                  <tr key={row.code} data-testid="admin-redeem-row" data-code={row.code}>
                    <td className="whitespace-nowrap font-mono text-xs">{row.display}</td>
                    <td>{row.credits}</td>
                    <td className="whitespace-nowrap">
                      {row.used_count} / {row.max_uses}
                    </td>
                    <td className="whitespace-nowrap text-xs">{row.credit_valid_days ? `${row.credit_valid_days} 天` : '永不过期'}</td>
                    <td className="whitespace-nowrap text-xs">{row.expires_at ? shortDate(row.expires_at) : '—'}</td>
                    <td className="max-w-xs truncate text-xs" title={row.note}>
                      <button
                        type="button"
                        className="hover:underline"
                        title="只看这一批"
                        onClick={() => {
                          setBatch(row.batch_id)
                          setPage(1)
                        }}
                      >
                        {row.note}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusPill tone={tone}>{label}</StatusPill>
                    </td>
                    <td className="whitespace-nowrap text-xs">{shortDate(row.created_at)}</td>
                    <td>
                      {row.disabled_at ? null : (
                        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => disable(row)} data-testid="redeem-disable">
                          停用
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {batch ? (
        <a className="text-sm text-muted hover:underline" href={`/api/admin/redeem-codes.csv?batch=${batch}`}>
          导出这一批 CSV
        </a>
      ) : null}
      <Pager page={page} onPage={setPage} hasMore={rows.length === PAGE_SIZE} />
    </AdminPage>
  )
}
