// 前端错误上报：浏览器里未捕获的异常、未处理的 Promise 拒绝和错误页（lib/error-report.ts）发到这里，只写 Worker 日志（[client-error]），不落库。
// 用户反馈时按错误页上的编号在 Workers Logs 里搜 id=xxx 即可。要接 Sentry 之类的平台，替换 lib/error-report.ts 的发送部分
import { stripUrl } from './csp'

export const CLIENT_ERROR_PATH = '/api/client-error'
export const CLIENT_ERROR_KINDS = ['error', 'rejection', 'boundary'] as const

const STACK_FRAMES = 6

// 日志只留定位问题需要的字段：邮箱打码，URL 去掉 query 和 hash（支付回跳地址带买家邮箱），堆栈只留前几帧
export function summarizeClientError(raw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')
  const id = text(r.id, 40)
  const kind = (CLIENT_ERROR_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as string) : null
  if (!/^[a-z0-9]{8,32}$/i.test(id) || !kind) return null
  const page = stripUrl(text(r.page, 300)).split(/[?#]/)[0] || '-'
  const message = scrub(text(r.message, 300)) || '-'
  const stack = text(r.stack, 4000)
    .split('\n')
    .map((line) => scrub(line.trim()))
    .filter(Boolean)
    .slice(0, STACK_FRAMES)
    .join(' | ')
  return `id=${id} kind=${kind} page=${page} message=${JSON.stringify(message)}${stack ? ` stack=${stack}` : ''}`
}

// 堆栈里的地址形如 https://site/assets/x.js?v=1:12:34，行列号在 query 之后，先拆出来再拼回去
function scrub(value: string) {
  return value
    .replace(/(https?:\/\/[^\s)"'<>]+?)((?::\d+){1,2})?(?=[\s)"'<>]|$)/g, (_, url: string, position = '') => stripUrl(url) + position)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
}
