import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { LocalLink, Spinner } from '#/components/ui'
import { getContent, localeFromParam, stripLocale, useContent, useLocalePath } from '#/lib/i18n'
import { signInHref, useSession } from '#/lib/session'

export const Route = createFileRoute('/{-$locale}/dashboard')({
  head: ({ params }) => ({
    meta: [{ title: getContent(localeFromParam(params.locale)).meta.dashboardTitle }, { name: 'robots', content: 'noindex' }],
  }),
  component: DashboardLayout,
})

function DashboardLayout() {
  const c = useContent()
  const d = c.dashboard
  const lp = useLocalePath()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user, config, loading } = useSession()

  if (loading) {
    return (
      <div className="grid place-items-center py-32">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (!user) {
    return (
      <div className="container-page max-w-md py-24 text-center">
        <p className="text-muted">{c.common.signInRequired}</p>
        <a href={signInHref(config, pathname, lp('/sign-in'))} className="btn-primary mt-6">
          {c.nav.signIn}
        </a>
      </div>
    )
  }

  const current = stripLocale(pathname)
  const tabs = [
    { to: '/dashboard', label: d.tabs.videos },
    { to: '/dashboard/billing', label: d.tabs.billing },
    { to: '/dashboard/settings', label: d.tabs.settings },
  ]
  return (
    <div className="container-page py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">{d.title}</h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip font-semibold" data-testid="dashboard-credits">
            {c.nav.credits(user.credits)}
          </span>
          <LocalLink to="/pricing" className="btn-ghost px-4 py-2">
            {d.buyCredits}
          </LocalLink>
          <a href={`${lp('/')}#create`} className="btn-primary px-4 py-2">
            <Plus className="size-4" /> {d.newVideo}
          </a>
        </div>
      </div>
      <nav className="mt-8 flex gap-6 border-b border-line">
        {tabs.map((tab) => {
          const path = current.replace(/\/$/, '')
          // 订单详情归在“账单”标签下
          const active = path === tab.to || (tab.to === '/dashboard/billing' && path.startsWith('/dashboard/orders/'))
          return (
            <LocalLink
              key={tab.to}
              to={tab.to}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium ${active ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {tab.label}
            </LocalLink>
          )
        })}
      </nav>
      <div className="py-8">
        <Outlet />
      </div>
    </div>
  )
}
