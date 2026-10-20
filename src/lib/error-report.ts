// 前端错误上报（服务端见 server/client-error.ts）：未捕获异常、未处理的 Promise 拒绝和错误页，用 sendBeacon 发给自己的 Worker，
// 只进 Worker 日志。每条带一个随机编号，错误页把编号展示给用户，反馈时可以按编号在日志里找到堆栈
import { CLIENT_ERROR_PATH } from '#/server/client-error'

// 同一页面最多报这么多条，同一个错误只报一次（循环里反复抛错不会刷爆日志和限流额度）
const MAX_REPORTS_PER_PAGE = 5

type Kind = 'error' | 'rejection' | 'boundary'

const reported = new Map<string, string>()

// 返回这条错误的编号；超出上限、没有上报时返回 null
export function reportClientError(error: unknown, kind: Kind): string | null {
  const err = error instanceof Error ? error : null
  const message = err ? `${err.name}: ${err.message}` : String(error)
  const key = `${kind}|${message}`
  const existing = reported.get(key)
  if (existing) return existing
  if (reported.size >= MAX_REPORTS_PER_PAGE) return null

  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
  reported.set(key, id)
  // 只带 origin + pathname：query 里可能有支付回跳的买家邮箱
  const body = JSON.stringify({ id, kind, message, stack: err?.stack ?? '', page: location.origin + location.pathname })
  // text/plain 的 beacon 不触发 CORS 预检；sendBeacon 不可用或排队失败时退回 keepalive fetch
  if (!navigator.sendBeacon?.(CLIENT_ERROR_PATH, body)) {
    fetch(CLIENT_ERROR_PATH, { method: 'POST', body, keepalive: true }).catch(() => {})
  }
  return id
}

// 挂全局监听，返回卸载函数（React StrictMode 会挂两次）
export function installErrorReporting() {
  const onError = (event: ErrorEvent) => {
    // 跨域脚本（统计、登录 SDK、浏览器插件）的报错只有 "Script error."，没有可定位的信息
    if (!event.error && /^Script error\.?$/i.test(event.message)) return
    reportClientError(event.error ?? event.message, 'error')
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, 'rejection')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
