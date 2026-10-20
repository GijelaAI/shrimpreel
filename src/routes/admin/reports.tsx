import { createFileRoute } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { AdminPage, FilterSelect, LoadState, money, useAdminData } from '#/components/admin'

export const Route = createFileRoute('/admin/reports')({
  component: AdminReports,
})

type Grouped = { key: string; currency: string; orders: number; cents: number; refunded_cents: number }
type Reports = {
  days: number
  funnel: { visits: number; signups: number; checkout: number; paid: number; generated: number }
  daily: { day: string; currency: string; orders: number; cents: number }[]
  sources: { key: string; visits: number; signups: number; orders: number; cents: Record<string, number> }[]
  byCountry: Grouped[]
  byProvider: Grouped[]
  byPackage: Grouped[]
  refunds: { currency: string; gross_cents: number; refunded_cents: number; refunded_orders: number; orders: number }[]
}

const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—')
const centsText = (cents: Record<string, number>) =>
  Object.entries(cents)
    .map(([currency, value]) => money(value, currency))
    .join(' + ') || '—'

function AdminReports() {
  const [days, setDays] = useState('30')
  const { data, error, loading } = useAdminData<Reports>(`/api/admin/reports?days=${days}`)

  return (
    <AdminPage
      title="经营报表"
      actions={
        <div className="flex items-center gap-3">
          <FilterSelect
            label="时间范围"
            value={days}
            onChange={setDays}
            options={[
              ['7', '近 7 天'],
              ['30', '近 30 天'],
              ['90', '近 90 天'],
              ['365', '近 1 年'],
            ]}
          />
          <a className="btn-ghost px-3 py-1.5 text-sm" href={`/api/admin/orders.csv?days=${days}`} data-testid="orders-csv">
            导出订单 CSV
          </a>
        </div>
      }
    >
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <Funnel funnel={data.funnel} />
          <Section title="按来源转化（访问=会话，注册=首次触达，订单=最近触达）">
            <table className="table-admin" data-testid="report-sources">
              <thead>
                <tr>
                  <th>来源 / 媒介</th>
                  <th>访问</th>
                  <th>注册</th>
                  <th>付费订单</th>
                  <th>注册→付费</th>
                  <th>净收入</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.key}>
                    <td>{s.key}</td>
                    <td>{s.visits}</td>
                    <td>{s.signups}</td>
                    <td>{s.orders}</td>
                    <td>{pct(s.orders, s.signups)}</td>
                    <td>{centsText(s.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <div className="grid gap-6 xl:grid-cols-3">
            <GroupTable title="按国家" rows={data.byCountry} testId="report-country" />
            <GroupTable title="按支付商" rows={data.byProvider} testId="report-provider" />
            <GroupTable title="按套餐" rows={data.byPackage} testId="report-package" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="每日净收入">
              <table className="table-admin" data-testid="report-daily">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>订单</th>
                    <th>净收入</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={`${d.day}-${d.currency}`}>
                      <td>{d.day}</td>
                      <td>{d.orders}</td>
                      <td>{money(d.cents, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="退款">
              <table className="table-admin" data-testid="report-refunds">
                <thead>
                  <tr>
                    <th>币种</th>
                    <th>实收</th>
                    <th>已退</th>
                    <th>退款率（金额）</th>
                    <th>有退款的订单</th>
                  </tr>
                </thead>
                <tbody>
                  {data.refunds.map((r) => (
                    <tr key={r.currency}>
                      <td>{r.currency}</td>
                      <td>{money(r.gross_cents, r.currency)}</td>
                      <td>{money(r.refunded_cents, r.currency)}</td>
                      <td>{pct(r.refunded_cents, r.gross_cents)}</td>
                      <td>
                        {r.refunded_orders} / {r.orders}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        </>
      ) : null}
    </AdminPage>
  )
}

function Funnel({ funnel }: { funnel: Reports['funnel'] }) {
  const steps = [
    ['访问（会话）', funnel.visits, null],
    ['新注册', funnel.signups, funnel.visits],
    ['发起结账', funnel.checkout, funnel.signups],
    ['完成付款', funnel.paid, funnel.signups],
    ['生成过视频', funnel.generated, funnel.signups],
  ] as const
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="report-funnel">
      {steps.map(([label, value, base]) => (
        <div key={label} className="card p-5">
          <p className="text-xs text-muted">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted">{base === null ? '漏斗起点' : `占${base === funnel.visits ? '访问' : '注册'} ${pct(value, base)}`}</p>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3 overflow-x-auto p-5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function GroupTable({ title, rows, testId }: { title: string; rows: Grouped[]; testId: string }) {
  return (
    <Section title={title}>
      <table className="table-admin" data-testid={testId}>
        <thead>
          <tr>
            <th>维度</th>
            <th>订单</th>
            <th>净收入</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}-${r.currency}`}>
              <td>{r.key}</td>
              <td>{r.orders}</td>
              <td>{money(r.cents, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
