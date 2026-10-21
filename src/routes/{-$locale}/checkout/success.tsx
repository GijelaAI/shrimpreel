import { createFileRoute } from '@tanstack/react-router'
import { CircleCheck, CircleX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorText, LocalLink, Spinner } from '#/components/ui'
import { api, errorCode, type Order } from '#/lib/api'
import { trackPurchaseOnce } from '#/lib/attribution'
import { getContent, localeFromParam, useContent, useLocalePath } from '#/lib/i18n'
import { useSession } from '#/lib/session'

type Search = { order?: string }

const POLL_MS = 2000
const SLOW_AFTER_MS = 30_000
const STOP_AFTER_MS = 5 * 60_000
// 等这么久仍未到账时，请服务端向支付商查一次单（webhook 丢失或延迟）
const RECONCILE_AT_MS = [15_000, 60_000]

export const Route = createFileRoute('/{-$locale}/checkout/success')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    order: typeof search.order === 'string' ? search.order : undefined,
  }),
  head: ({ params }) => ({
    meta: [{ title: getContent(localeFromParam(params.locale)).checkout.pendingTitle }, { name: 'robots', content: 'noindex' }],
  }),
  component: CheckoutSuccessPage,
})

function CheckoutSuccessPage() {
  const c = useContent()
  const t = c.checkout
  const lp = useLocalePath()
  const { order: orderId } = Route.useSearch()
  const { user, loading, refresh } = useSession()
  const [order, setOrder] = useState<Order | null>(null)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // webhook 可能比用户跳回来晚，轮询直到订单进入终态
  useEffect(() => {
    if (!orderId || !user) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let reconciles = 0
    const startedAt = Date.now()
    const path = `/api/orders/${encodeURIComponent(orderId)}`
    async function poll() {
      try {
        const due = reconciles < RECONCILE_AT_MS.length && Date.now() - startedAt >= RECONCILE_AT_MS[reconciles]
        if (due) reconciles++
        // 查单失败（支付商超时、限流）不打断轮询，退回普通查询
        const data = due
          ? await api<{ order: Order }>(`${path}/reconcile`, { method: 'POST' }).catch(() => api<{ order: Order }>(path))
          : await api<{ order: Order }>(path)
        if (stopped) return
        setOrder(data.order)
        if (data.order.status !== 'pending') {
          await refresh()
          return
        }
      } catch (err) {
        if (stopped) return
        setError(errorCode(err))
        return
      }
      const elapsed = Date.now() - startedAt
      if (elapsed > SLOW_AFTER_MS) setSlow(true)
      if (elapsed < STOP_AFTER_MS) timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // user 对象在 refresh 后会变化，只依赖 id 避免重复轮询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, user?.id])

  const paid = order?.status === 'paid'
  const failed = order && (order.status === 'failed' || order.status === 'canceled')

  useEffect(() => {
    if (order && paid) trackPurchaseOnce(order)
  }, [order, paid])

  return (
    <div className="container-page grid max-w-lg place-items-center py-24">
      <div className="card w-full space-y-5 p-8 text-center" data-testid="checkout-result" data-status={order?.status ?? 'loading'}>
        {/* 未登录不会发起轮询，必须落到下面的登录提示，否则一直转圈（会话过期、换域名回跳时会遇到） */}
        {loading || (user && !order && !error) ? (
          <>
            <Spinner className="mx-auto size-8" />
            <h1 className="font-display text-3xl">{t.pendingTitle}</h1>
            <p className="text-sm text-muted">{t.pendingBody}</p>
          </>
        ) : !user ? (
          <p className="text-muted">{c.common.signInRequired}</p>
        ) : error ? (
          <ErrorText code={error} />
        ) : paid ? (
          <>
            <CircleCheck className="mx-auto size-12 text-emerald-600" />
            <h1 className="font-display text-3xl">{t.successTitle}</h1>
            <p className="text-muted">{t.added(order.credits)}</p>
            <a href={`${lp('/')}#create`} className="btn-primary">
              {t.start}
            </a>
          </>
        ) : failed ? (
          <>
            <CircleX className="mx-auto size-12 text-red-600" />
            <h1 className="font-display text-3xl">{t.failedTitle}</h1>
            <p className="text-muted">{t.failedBody}</p>
            <LocalLink to="/pricing" className="btn-primary">
              {t.backToPricing}
            </LocalLink>
          </>
        ) : (
          <>
            <Spinner className="mx-auto size-8" />
            <h1 className="font-display text-3xl">{t.pendingTitle}</h1>
            <p className="text-sm text-muted">{slow ? t.slowBody : t.pendingBody}</p>
          </>
        )}
        {orderId ? (
          <p className="font-mono text-xs text-muted">
            {t.orderId}: {orderId}
          </p>
        ) : null}
      </div>
    </div>
  )
}
