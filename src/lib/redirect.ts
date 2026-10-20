// 登录后的跳转地址只允许站内路径（服务端 Google 回调和登录页共用）。
// 浏览器解析 URL 时把 \ 当 /、丢掉 tab 和换行，"/\evil.com"、"/\t/evil.com" 都会变成 https://evil.com/，
// 所以除了拒绝 // 开头，还要拒绝反斜杠和控制字符；"/..//evil.com" 规范化后又是 "//evil.com"，
// 所以返回规范化后的结果，并再核对一次 origin 和开头的 //。
const BASE = 'https://redirect.invalid'

export function safeRedirectPath(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  const url = new URL(value, BASE)
  const path = `${url.pathname}${url.search}${url.hash}`
  return url.origin === BASE && !path.startsWith('//') ? path : fallback
}
