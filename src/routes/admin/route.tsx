import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Banknote, ChartNoAxesCombined, ClipboardList, Film, Flag, Gift, LayoutDashboard, Mail, MailCheck, ScrollText, SlidersHorizontal, Ticket, Users, Webhook } from 'lucide-react'
import { LogoMark, Spinner } from '#/components/ui'
import { site } from '#/config/site'
import { useSession } from '#/lib/session'

export const Route = createFileRoute('/admin')({
  head: () => ({ meta: [{ title: `后台 · ${site.brandName}` }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: AdminLayout,
})

const NAV = [
  { to: '/admin', label: '概览', icon: LayoutDashboard, exact: true },
  { to: '/admin/users', label: '用户', icon: Users },
  { to: '/admin/orders', label: '订单', icon: Banknote },
  { to: '/admin/reports', label: '经营报表', icon: ChartNoAxesCombined },
  { to: '/admin/redeem-codes', label: '兑换码', icon: Ticket },
  { to: '/admin/referrals', label: '邀请排行', icon: Gift },
  { to: '/admin/settings', label: '运营设置', icon: SlidersHorizontal },
  { to: '/admin/generations', label: '生成任务', icon: Film },
  { to: '/admin/takedowns', label: '举报下架', icon: Flag },
  { to: '/admin/messages', label: '用户留言', icon: Mail },
  { to: '/admin/events', label: '支付事件', icon: Webhook },
  { to: '/admin/emails', label: '邮件', icon: MailCheck },
  { to: '/admin/audit', label: '审计日志', icon: ScrollText },
] as const

// 前端守卫只负责体验；真正的权限校验在 /api/admin/* 的 requireAdmin
function AdminLayout() {
  const { user, loading } = useSession()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (!user || user.role !== 'admin') {
    return (
      <div className="grid min-h-screen place-items-center px-6" data-testid="admin-denied">
        <div className="card max-w-sm space-y-4 p-8 text-center">
          <ClipboardList className="mx-auto size-10 text-muted" />
          <h1 className="font-display text-2xl">403 · 无权访问</h1>
          <p className="text-sm text-muted">{user ? '当前账号不是管理员。' : '请先登录管理员账号。'}</p>
          <a href={user ? '/' : '/sign-in?redirect=/admin'} className="btn-primary">
            {user ? '返回首页' : '去登录'}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-bg-soft">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-bg p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <LogoMark className="size-8 text-xs" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">{site.brandName}</p>
            <p className="text-xs text-muted">管理后台</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: 'exact' in item }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-bg-soft hover:text-fg"
              activeProps={{ className: 'bg-bg-soft font-medium text-fg' }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <a href="/" className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> 返回站点
        </a>
        <p className="truncate px-3 text-xs text-muted">{user.email}</p>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex gap-3 overflow-x-auto border-b border-line bg-bg px-4 py-3 text-sm md:hidden">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} activeOptions={{ exact: 'exact' in item }} className="shrink-0 text-muted" activeProps={{ className: 'font-medium text-fg' }}>
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="p-6 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
