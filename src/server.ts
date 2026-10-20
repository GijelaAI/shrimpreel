import handler from '@tanstack/react-start/server-entry'
import { runHealthCheck } from './server/alerts'
import { app } from './server/app'
import { PERMISSIONS_POLICY, contentSecurityPolicy, createNonce } from './server/csp'
import { handleDeadLetterBatch, handleQueueBatch, runScheduledMaintenance } from './server/jobs'
import { runNotificationCron } from './server/notifications'
import { isSeoPath } from './server/seo'
import { isProduction } from './server/util'
import type { VideoJobMessage } from './server/types'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': PERMISSIONS_POLICY,
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    const { pathname } = url
    const toHono = pathname.startsWith('/api/') || pathname.startsWith('/media/') || isSeoPath(pathname)
    // 页面统一无尾斜杠：/pricing/ → 301 /pricing（TanStack 默认 307，不传递权重）
    if (!toHono && pathname.length > 1 && pathname.endsWith('/') && (request.method === 'GET' || request.method === 'HEAD')) {
      url.pathname = pathname.replace(/\/+$/, '') || '/'
      return withSecurityHeaders(Response.redirect(url.toString(), 301), env, url)
    }
    // 页面请求生成 CSP nonce，经请求上下文交给 router（src/router.tsx 的 ssr.nonce），内联脚本都会带上它
    const nonce = toHono ? undefined : createNonce()
    const response = nonce ? await handler.fetch(request, { context: { nonce } }) : await app.fetch(request, env, ctx)
    if (import.meta.env.DEV) await drainUnreadBody(request)
    return withSecurityHeaders(response, env, url, nonce)
  },

  async queue(batch: MessageBatch<VideoJobMessage>, env: Env) {
    // 死信队列按约定以 -dlq 结尾（wrangler.jsonc 的 dead_letter_queue）
    if (batch.queue.endsWith('-dlq')) await handleDeadLetterBatch(batch, env)
    else await handleQueueBatch(batch, env)
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledMaintenance(env))
    ctx.waitUntil(runNotificationCron(env))
    ctx.waitUntil(runHealthCheck(env).catch((error) => console.error('[alert] health check failed', error)))
  },
} satisfies ExportedHandler<Env, VideoJobMessage>

// 仅本地开发：miniflare 5（wrangler ≥ 4.117 / @cloudflare/vite-plugin ≥ 1.49.1）下，Worker 没读完 request body
// 就返回（CSRF 403、未登录 401 等提前返回），Vite → workerd 复用的连接会让后续请求 500 "fetch failed"。
// 复现：同一连接上连发 3 个带 JSON body 的跨域 POST，第 3 个 500。生产构建里 DEV 为 false，整段被移除
async function drainUnreadBody(request: Request) {
  if (request.body && !request.bodyUsed) await request.arrayBuffer()
}

function withSecurityHeaders(response: Response, env: Env, url: URL, nonce?: string) {
  // 101/WebSocket 等特殊响应不能重建
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value)
  }
  // CSP 只对页面下发（Report-Only 阶段，见 server/csp.ts）；API、媒体和 sitemap 不是 HTML，不需要
  if (nonce && headers.get('Content-Type')?.startsWith('text/html')) {
    headers.set('Content-Security-Policy-Report-Only', contentSecurityPolicy(nonce))
  }
  // HSTS 只在正式站和 staging 的 https 下发（workers.dev 所在的 .dev 顶级域本就在 HSTS 预加载列表里）；本地开发不加
  if (isProduction(env) && url.protocol === 'https:' && !headers.has('Strict-Transport-Security')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
