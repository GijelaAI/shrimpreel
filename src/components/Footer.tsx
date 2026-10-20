import { LifeBuoy } from 'lucide-react'
import { ARTICLES, site } from '#/config/site'
import { CONSENT_OPEN_EVENT } from '#/lib/consent'
import { useContent } from '#/lib/i18n'
import { LanguageLinks } from './Nav'
import { LocalLink, LogoMark } from './ui'

// 页脚只列前几篇文章，其余从 /guides 进入
const FOOTER_ARTICLES = 3

export function Footer() {
  const c = useContent()
  const columns = [
    {
      title: c.footer.resources,
      links: [
        { to: '/guides', label: c.guides.nav },
        ...ARTICLES.slice(0, FOOTER_ARTICLES).map((article) => ({ to: `/${article.slug}`, label: c.articles[article.key].title })),
        { to: '/pricing', label: c.nav.pricing },
        { to: '/contact', label: c.footer.contact },
      ],
    },
    {
      title: c.footer.legal,
      links: [
        { to: '/privacy-policy', label: c.footer.privacy },
        { to: '/terms-of-service', label: c.footer.terms },
        { to: '/refund-policy', label: c.footer.refund },
        { to: '/report', label: c.footer.report },
      ],
      // 只有启用 GA4 时才有同意横幅，才需要“Cookie 设置”
      cookieSettings: Boolean(site.analytics.ga4Id),
    },
  ]
  // 页脚固定深色，与主题无关
  return (
    <footer className="bg-[#151311] text-[#f2ede4]">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-5">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-mono text-lg font-bold tracking-[0.12em] uppercase">{site.brandName}</span>
          </div>
          <p className="max-w-sm font-display text-lg leading-relaxed text-[#f2ede4]/80 italic">{c.footer.statement}</p>
          <LanguageLinks />
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            {/* h2：页脚前面可能只有 H1（登录页、404），用 h3 会跳级 */}
            <h2 className="eyebrow mb-4 text-[#f2ede4]/60">{column.title}</h2>
            <ul className="space-y-3 text-sm">
              {column.links.map((link) => (
                <li key={link.to}>
                  <LocalLink to={link.to} className="text-[#f2ede4]/85 hover:text-white">
                    {link.label}
                  </LocalLink>
                </li>
              ))}
              {'cookieSettings' in column && column.cookieSettings ? (
                <li>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
                    className="text-[#f2ede4]/85 hover:text-white"
                  >
                    {c.consent.settings}
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-[#f2ede4]/55 sm:flex-row sm:justify-between">
          <span>{c.footer.rights}</span>
          <a href={`mailto:${site.supportEmail}`} className="hover:text-white">
            {site.supportEmail}
          </a>
        </div>
      </div>
    </footer>
  )
}

export function SupportButton() {
  const c = useContent()
  return (
    <LocalLink
      to="/contact"
      aria-label={c.support.label}
      title={c.support.label}
      className="fixed right-5 bottom-5 z-30 grid size-12 place-items-center rounded-full bg-ink text-ink-fg shadow-lg transition hover:scale-105"
    >
      <LifeBuoy className="size-5" />
    </LocalLink>
  )
}
