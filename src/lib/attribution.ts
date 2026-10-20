// 客户端来源采集：首次/最近一次触达写入 vt_attr cookie（90 天，服务端在注册/下单时读取），
// 每个浏览器会话上报一次访问到 /api/t/visit，构成后台漏斗的第一步。字段与 src/server/attribution.ts 对齐。

const COOKIE = 'vt_attr'
const MAX_AGE = 90 * 86400
const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'msclkid', 'ttclid', 'fbclid', 'ref'] as const

type Touch = Record<string, string>

function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): { first?: Touch; last?: Touch } | null {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}

function readCookie() {
  const match = document.cookie.match(/(?:^|;\s*)vt_attr=([^;]+)/)
  return match ? decode(match[1]!) : null
}

function currentTouch(): Touch {
  const url = new URL(location.href)
  const touch: Touch = { landing: url.pathname.slice(0, 200), at: new Date().toISOString() }
  for (const key of PARAMS) {
    const value = url.searchParams.get(key)
    if (value) touch[key] = value.slice(0, 200)
  }
  if (document.referrer) {
    try {
      const ref = new URL(document.referrer)
      if (ref.hostname !== location.hostname) touch.referrer = `${ref.origin}${ref.pathname}`.slice(0, 200)
    } catch {
      // 非法 referrer 忽略
    }
  }
  return touch
}

const hasSignal = (touch: Touch) => PARAMS.some((key) => touch[key]) || !!touch.referrer

// 在客户端启动时调用一次
export function captureAttribution() {
  if (typeof window === 'undefined') return
  try {
    const touch = currentTouch()
    const stored = readCookie() ?? {}
    const next = {
      first: stored.first ?? touch,
      // direct 回访不覆盖最近一次有来源的触达（last non-direct）
      last: hasSignal(touch) || !stored.last ? touch : stored.last,
    }
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${COOKIE}=${encode(next)}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`
    if (!sessionStorage.getItem('vt_visit')) {
      sessionStorage.setItem('vt_visit', '1')
      void fetch('/api/t/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touch }),
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {})
    }
  } catch {
    // 隐私模式等禁用存储时不影响页面
  }
}

// GA4 事件（未配置 ga4Id 时 gtag 不存在，直接忽略；访客未同意时只进 dataLayer，gtag.js 没加载就不会发出）
type Gtag = (command: 'event', name: string, params?: Record<string, unknown>) => void

export function track(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const gtag = (window as unknown as { gtag?: Gtag }).gtag
  gtag?.('event', name, params)
}

// purchase 只在每个订单首次看到 paid 时上报一次
export function trackPurchaseOnce(order: { id: string; amountCents: number; currency: string; packageId: string; credits: number }) {
  try {
    const key = `purchase:${order.id}`
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, '1')
  } catch {
    // ignore
  }
  track('purchase', {
    transaction_id: order.id,
    value: order.amountCents / 100,
    currency: order.currency,
    items: [{ item_id: order.packageId, item_name: order.packageId, quantity: 1, credits: order.credits }],
  })
}
