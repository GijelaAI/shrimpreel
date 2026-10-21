import { useEffect, useState } from 'react'
import { applyAttributionConsent } from '#/lib/attribution'
import { CONSENT_OPEN_EVENT, readConsent, saveConsent, type Consent } from '#/lib/consent'
import { useContent } from '#/lib/i18n'
import { LocalLink } from './ui'

// 统计同意横幅（只在配置了 GA4 时渲染）。选择存在 localStorage，服务端无从得知，挂载后才决定是否显示；
// “接受”和“拒绝”同样醒目，页脚“Cookie 设置”派发 CONSENT_OPEN_EVENT 重新打开
export function ConsentBanner({ ga4Id }: { ga4Id: string }) {
  const c = useContent()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(readConsent() === null)
    const reopen = () => setOpen(true)
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
  }, [])
  if (!open) return null

  const choose = (value: Consent) => {
    saveConsent(ga4Id, value)
    applyAttributionConsent(value)
    setOpen(false)
  }
  return (
    <section
      aria-label={c.consent.title}
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-2xl border border-line bg-card p-5 text-fg shadow-xl sm:inset-x-6"
    >
      <h2 className="font-semibold">{c.consent.title}</h2>
      <p className="mt-2 text-sm text-muted">
        {c.consent.body}{' '}
        <LocalLink to="/privacy-policy" className="underline hover:text-fg">
          {c.consent.learnMore}
        </LocalLink>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button type="button" className="btn-ghost" onClick={() => choose('denied')}>
          {c.consent.reject}
        </button>
        <button type="button" className="btn-ghost" onClick={() => choose('granted')}>
          {c.consent.accept}
        </button>
      </div>
    </section>
  )
}
