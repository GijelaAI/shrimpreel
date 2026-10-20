// GA4 统计同意（Consent Mode v2，basic 模式）：只在 site.analytics.ga4Id 非空时生效。
// 访客点“接受”之前不加载 gtag.js，也就不会向 Google 发任何请求；广告相关的三项始终 denied（模板不投放广告再营销）。
// 选择存 localStorage，页脚“Cookie 设置”可以重新选择；撤回同意时删除已写入的 _ga Cookie。

export const CONSENT_KEY = 'consent.analytics'
export const CONSENT_OPEN_EVENT = 'consent:open'
export type Consent = 'granted' | 'denied'

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id='

// <head> 内联脚本：先设默认同意状态，再排队 config；已同意过的回访者直接加载 gtag.js。
// Dodo 回跳成功页时会在 URL 上附带 ?email=<买家邮箱>；GA 禁止收集 PII，page_location 先去掉它
export function ga4BootstrapScript(ga4Id: string) {
  const id = JSON.stringify(ga4Id)
  return [
    'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}',
    `var c=null;try{c=localStorage.getItem(${JSON.stringify(CONSENT_KEY)})}catch(e){}`,
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:c==='granted'?'granted':'denied'});",
    "gtag('js',new Date());var u=new URL(location.href);u.searchParams.delete('email');",
    `gtag('config',${id},{page_location:u.href});`,
    `if(c==='granted'){var s=document.createElement('script');s.async=true;s.src=${JSON.stringify(GTAG_SRC)}+${id};document.head.appendChild(s)}`,
  ].join('')
}

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

type Gtag = (command: 'consent', action: 'update', params: Record<string, string>) => void

export function saveConsent(ga4Id: string, value: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, value)
  } catch {
    // 禁用存储时本次页面内仍然生效，下次访问再问
  }
  const gtag = (window as unknown as { gtag?: Gtag }).gtag
  gtag?.('consent', 'update', { analytics_storage: value })
  if (value === 'granted') {
    if (!document.querySelector(`script[src^="${GTAG_SRC}"]`)) {
      const script = document.createElement('script')
      script.async = true
      script.src = GTAG_SRC + encodeURIComponent(ga4Id)
      document.head.appendChild(script)
    }
  } else {
    deleteGaCookies()
  }
}

// GA 默认把 Cookie 写在可写的最高一级域名上（cookie_domain: 'auto'），逐级尝试删除
function deleteGaCookies() {
  const names = document.cookie
    .split(';')
    .map((part) => part.split('=')[0]!.trim())
    .filter((name) => name === '_ga' || name.startsWith('_ga_') || name === '_gid')
  const labels = location.hostname.split('.')
  const domains = [''].concat(labels.slice(0, -1).map((_, i) => `; Domain=.${labels.slice(i).join('.')}`))
  for (const name of names) {
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; Path=/${domain}`
  }
}
