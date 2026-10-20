import { useEffect, useRef } from 'react'
import { LOCALE_META } from '#/config/site'
import { useLocale } from '#/lib/i18n'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadScript(onReady: () => void) {
  if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) return onReady()
  let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
  if (!script) {
    script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.dataset.turnstile = '1'
    document.head.appendChild(script)
  }
  script.addEventListener('load', onReady, { once: true })
}

// Cloudflare Turnstile：服务端配置了站点密钥才渲染。token 单次有效，
// 每次提交后递增 resetKey 让组件重新出题
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (token: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const locale = useLocale()

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    onTokenRef.current(null)
    loadScript(() => {
      const turnstile = (window as unknown as { turnstile?: TurnstileApi }).turnstile
      if (cancelled || !turnstile || !ref.current) return
      widgetId = turnstile.render(ref.current, {
        sitekey: siteKey,
        language: LOCALE_META[locale].tag.toLowerCase(),
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      })
    })
    return () => {
      cancelled = true
      if (widgetId) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(widgetId)
    }
  }, [siteKey, resetKey, locale])

  return <div ref={ref} data-testid="turnstile" />
}
