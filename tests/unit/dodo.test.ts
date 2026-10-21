import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDodoProvider, normalizeDodoEvent, verifyDodoWebhook } from '#/server/payments/dodo'

const NOW = Date.UTC(2026, 9, 20, 8, 0, 0)
const rawKey = randomBytes(24)
const SECRET = `whsec_${rawKey.toString('base64')}`

// Standard Webhooks：base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`))
function sign(id: string, timestamp: number, body: string, key = rawKey) {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headers(values: Record<string, string>) {
  return new Headers(values)
}

describe('verifyDodoWebhook', () => {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { metadata: { orderId: 'ord_1' } } })
  const ts = Math.floor(NOW / 1000)

  it('接受正确签名，并把 webhook-id 作为幂等键带出', async () => {
    const payload = await verifyDodoWebhook(
      body,
      headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sign('msg_1', ts, body)}` }),
      SECRET,
      NOW,
    )
    expect(payload.__webhookId).toBe('msg_1')
  })

  it('密钥轮换期间多签名中任一匹配即通过；不带 whsec_ 前缀的密钥也可用', async () => {
    const other = randomBytes(24)
    const multi = `v1,${sign('msg_1', ts, body, other)} v1,${sign('msg_1', ts, body)}`
    const h = headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': multi })
    await expect(verifyDodoWebhook(body, h, SECRET, NOW)).resolves.toBeTruthy()
    await expect(verifyDodoWebhook(body, h, rawKey.toString('base64'), NOW)).resolves.toBeTruthy()
  })

  it('拒绝篡改 body、换 id 重放、错误版本前缀', async () => {
    const sig = sign('msg_1', ts, body)
    const ok = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` }
    await expect(verifyDodoWebhook(body.replace('ord_1', 'ord_2'), headers(ok), SECRET, NOW)).rejects.toThrow('invalid signature')
    await expect(verifyDodoWebhook(body, headers({ ...ok, 'webhook-id': 'msg_2' }), SECRET, NOW)).rejects.toThrow('invalid signature')
    await expect(verifyDodoWebhook(body, headers({ ...ok, 'webhook-signature': `v2,${sig}` }), SECRET, NOW)).rejects.toThrow('invalid signature')
  })

  it('拒绝 5 分钟窗口外的时间戳、缺失请求头、未配置密钥', async () => {
    const old = ts - 6 * 60
    await expect(
      verifyDodoWebhook(
        body,
        headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(old), 'webhook-signature': `v1,${sign('msg_1', old, body)}` }),
        SECRET,
        NOW,
      ),
    ).rejects.toThrow('timestamp')
    await expect(verifyDodoWebhook(body, headers({ 'webhook-id': 'msg_1' }), SECRET, NOW)).rejects.toThrow('missing webhook headers')
    await expect(verifyDodoWebhook(body, headers({}), '  ', NOW)).rejects.toThrow('DODO_WEBHOOK_SECRET missing')
  })
})

describe('normalizeDodoEvent', () => {
  it('按事件类型映射为 paid / failed / refunded / ignored', () => {
    const paid = normalizeDodoEvent({
      __webhookId: 'msg_1',
      type: 'payment.succeeded',
      data: { payment_id: 'pay_1', checkout_session_id: 'cks_1', total_amount: 990, currency: 'USD', metadata: { orderId: 'ord_1' } },
    })
    expect(paid).toMatchObject({
      kind: 'paid',
      eventId: 'msg_1',
      orderId: 'ord_1',
      providerPaymentId: 'pay_1',
      providerOrderId: 'cks_1',
      paidAmount: '9.90',
      paidAmountCents: 990,
    })
    expect(paid).toMatchObject({ productId: null, discounted: false, site: null })
    const detailed = normalizeDodoEvent({
      __webhookId: 'msg_2',
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_2',
        total_amount: 800,
        currency: 'USD',
        product_cart: [{ product_id: 'pdt_starter', quantity: 1 }],
        discount_id: 'dsc_1',
        metadata: { orderId: 'ord_2', site: 'example.com' },
      },
    })
    expect(detailed).toMatchObject({ productId: 'pdt_starter', discounted: true, site: 'example.com' })
    expect(normalizeDodoEvent({ __webhookId: 'm', type: 'payment.cancelled', data: { metadata: { orderId: 'ord_1' } } }).kind).toBe('failed')
    expect(normalizeDodoEvent({ __webhookId: 'm', type: 'refund.succeeded', data: { payment_id: 'pay_1' } })).toMatchObject({
      kind: 'refunded',
      orderId: null,
      providerPaymentId: 'pay_1',
      refundAmountCents: null,
    })
    expect(
      normalizeDodoEvent({
        __webhookId: 'm2',
        type: 'refund.succeeded',
        data: { payment_id: 'pay_1', refund_id: 'ref_1', amount: 400, is_partial: true, currency: 'USD' },
      }),
    ).toMatchObject({ refundId: 'ref_1', refundAmountCents: 400 })
    expect(normalizeDodoEvent({ __webhookId: 'm', type: 'subscription.active' }).kind).toBe('ignored')
  })
})

describe('createDodoProvider.fetchPaidEvent', () => {
  afterEach(() => vi.unstubAllGlobals())
  const env = { DODO_API_KEY: 'sk_test', DODO_ENVIRONMENT: 'test_mode' } as unknown as Env

  it('checkout session 成功后取 Payment 对象，按 payment.succeeded 同样的规则归一化', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk_test')
      const path = new URL(url).pathname
      paths.push(path)
      if (path === '/checkouts/cks_1') return Response.json({ id: 'cks_1', payment_id: 'pay_1', payment_status: 'succeeded' })
      return Response.json({
        payment_id: 'pay_1',
        checkout_session_id: 'cks_1',
        status: 'succeeded',
        total_amount: 1069,
        currency: 'USD',
        metadata: { orderId: 'ord_1', site: 'example.com' },
        product_cart: [{ product_id: 'pdt_starter', quantity: 1 }],
        discount_id: null,
      })
    })
    const found = await createDodoProvider(env).fetchPaidEvent!({ id: 'ord_1', packageId: 'starter', providerSessionId: 'cks_1' })
    expect(paths).toEqual(['/checkouts/cks_1', '/payments/pay_1'])
    expect(found?.event).toEqual({
      kind: 'paid',
      eventId: 'reconcile:pay_1',
      eventType: 'reconcile',
      orderId: 'ord_1',
      providerOrderId: 'cks_1',
      providerPaymentId: 'pay_1',
      paidAmount: '10.69',
      paidCurrency: 'USD',
      paidAmountCents: 1069,
      productId: 'pdt_starter',
      discounted: false,
      site: 'example.com',
      subscription: null,
    })
  })

  it('未付款、处理中、session 不存在、订单没有 session id 时返回 null；接口出错时抛出', async () => {
    let session: Response | null = null
    const fetchSpy = vi.fn(async () => session!.clone())
    vi.stubGlobal('fetch', fetchSpy)
    const provider = createDodoProvider(env)
    expect(await provider.fetchPaidEvent!({ id: 'ord_1', packageId: 'starter', providerSessionId: null })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()

    for (const reply of [
      Response.json({ id: 'cks_1', payment_id: null, payment_status: null }),
      Response.json({ id: 'cks_1', payment_id: 'pay_1', payment_status: 'processing' }),
      Response.json({ id: 'cks_1', payment_id: 'pay_1', payment_status: 'failed' }),
      new Response('not found', { status: 404 }),
    ]) {
      session = reply
      expect(await provider.fetchPaidEvent!({ id: 'ord_1', packageId: 'starter', providerSessionId: 'cks_1' })).toBeNull()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(4)

    session = new Response('oops', { status: 500 })
    await expect(provider.fetchPaidEvent!({ id: 'ord_1', packageId: 'starter', providerSessionId: 'cks_1' })).rejects.toMatchObject({ status: 502 })
  })
})
