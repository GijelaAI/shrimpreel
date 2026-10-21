import { useContent, useLocale } from '#/lib/i18n'
import { useSession } from '#/lib/session'

// 维护提示与全站公告：来自后台运营参数（/api/me 下发），只在浏览器端出现，不影响 SSR 和 SEO
export function SiteNotice() {
  const { config } = useSession()
  const c = useContent()
  const locale = useLocale()
  const notice = config?.notice
  const announcement = notice?.announcement[locale]
  if (!notice?.maintenance && !announcement) return null
  return (
    <div className="border-b border-line text-sm">
      {notice?.maintenance ? (
        <p role="status" data-testid="maintenance-notice" className="bg-amber-100 px-4 py-2 text-center text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          {c.common.maintenance}
        </p>
      ) : null}
      {announcement ? (
        <p data-testid="site-announcement" className="bg-bg-soft px-4 py-2 text-center text-fg">
          {announcement}
        </p>
      ) : null}
    </div>
  )
}
