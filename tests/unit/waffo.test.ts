import { createVerify, generateKeyPairSync, createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookVerificationError } from '#/server/payments/types'
import { createWaffoProvider, normalizeWaffoEvent, verifyWaffoWebhook } from '#/server/payments/waffo'

const NOW = Date.UTC(2026, 9, 20, 8, 0, 0)

async function signingPair() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const sign = async (timestamp: number | string, body: string) => {
    const bytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${timestamp}.${body}`))
    return `t=${timestamp},v1=${Buffer.from(bytes).toString('base64')}`
  }
  return { publicKey: pair.publicKey, sign }
}

describe('verifyWaffoWebhook', () => {
  const body = JSON.stringify({ eventId: 'evt_1', eventType: 'order.completed', mode: 'test', data: {} })

  it('接受平台私钥签名的事件并返回 payload', async () => {
    const { publicKey, sign } = await signingPair()
    const payload = await verifyWaffoWebhook(body, await sign(NOW, body), 'test', { nowMs: NOW, publicKey })
    expect(payload.eventId).toBe('evt_1')
  })

  it('拒绝被篡改的 body', async () => {
    const { publicKey, sign } = await signingPair()
    const header = await sign(NOW, body)
    const tampered = body.replace('evt_1', 'evt_2')
    await expect(verifyWaffoWebhook(tampered, header, 'test', { nowMs: NOW, publicKey })).rejects.toThrow('invalid signature')
  })

  it('拒绝超出时间窗口的重放与未来时间戳', async () => {
    const { publicKey, sign } = await signingPair()
    const stale = NOW - 46 * 60 * 1000
    await expect(verifyWaffoWebhook(body, await sign(stale, body), 'test', { nowMs: NOW, publicKey })).rejects.toThrow('timestamp')
    const future = NOW + 2 * 60 * 1000
    await expect(verifyWaffoWebhook(body, await sign(future, body), 'test', { nowMs: NOW, publicKey })).rejects.toThrow('timestamp')
  })

  it('拒绝缺失或格式错误的签名头', async () => {
    await expect(verifyWaffoWebhook(body, null, 'test')).rejects.toBeInstanceOf(WebhookVerificationError)
    await expect(verifyWaffoWebhook(body, 'garbage', 'test')).rejects.toThrow('malformed')
    await expect(verifyWaffoWebhook(body, `t=${NOW},v1=***`, 'test', { nowMs: NOW })).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('拒绝 test 事件打到 prod 环境（mode 不一致）', async () => {
    const { publicKey, sign } = await signingPair()
    await expect(verifyWaffoWebhook(body, await sign(NOW, body), 'prod', { nowMs: NOW, publicKey })).rejects.toThrow('mode mismatch')
  })

  it('内置平台公钥可正常导入，并拒绝非平台签名', async () => {
    const { sign } = await signingPair()
    for (const environment of ['test', 'prod'] as const) {
      await expect(verifyWaffoWebhook(body, await sign(NOW, body), environment, { nowMs: NOW })).rejects.toThrow('invalid signature')
    }
  })
})

describe('normalizeWaffoEvent', () => {
  it('order.completed → paid，优先使用 orderMerchantExternalId 和 chargedAmount', () => {
    const event = normalizeWaffoEvent({
      eventId: 'evt_1',
      eventType: 'order.completed',
      data: {
        orderMerchantExternalId: 'ord_a',
        orderId: 'wo_1',
        paymentId: 'wp_1',
        chargedAmount: '10.79',
        listPrice: { total: '9.90' },
        total: '9.90',
        currency: 'USD',
        metadata: { orderId: 'ord_b' },
      },
    })
    expect(event).toMatchObject({
      kind: 'paid',
      orderId: 'ord_a',
      providerOrderId: 'wo_1',
      providerPaymentId: 'wp_1',
      paidAmount: '10.79',
      paidCurrency: 'USD',
      paidAmountCents: 1079,
    })
  })

  it('旧 payload 只有 total 时回退；零小数币种按整数换算', () => {
    const legacy = normalizeWaffoEvent({ eventId: 'e', eventType: 'order.completed', data: { total: '29.00', currency: 'USD' } })
    expect(legacy).toMatchObject({ paidAmount: '29.00', paidAmountCents: 2900 })
    const jpy = normalizeWaffoEvent({ eventId: 'e', eventType: 'order.completed', data: { chargedAmount: '4500', currency: 'JPY' } })
    expect(jpy).toMatchObject({ paidAmountCents: 4500, paidCurrency: 'JPY' })
  })

  it('没有 external id 时回退到 metadata.orderId', () => {
    const event = normalizeWaffoEvent({ eventId: 'evt_1', eventType: 'order.completed', data: { orderMetadata: { orderId: 'ord_b' } } })
    expect(event).toMatchObject({ kind: 'paid', orderId: 'ord_b' })
  })

  it('refund.succeeded → refunded（带部分退款金额）；未知类型 → ignored；缺 eventId 报错', () => {
    expect(
      normalizeWaffoEvent({
        eventId: 'e',
        eventType: 'refund.succeeded',
        data: { paymentId: 'wp_1', refundId: 'rf_1', refundedAmount: '3.00', originalChargedAmount: '9.90', currency: 'USD' },
      }),
    ).toMatchObject({ kind: 'refunded', providerPaymentId: 'wp_1', refundId: 'rf_1', refundAmountCents: 300, originalAmountCents: 990 })
    expect(normalizeWaffoEvent({ eventId: 'e2', eventType: 'refund.succeeded', data: { paymentId: 'wp_1' } })).toMatchObject({
      kind: 'refunded',
      refundId: 'e2',
      refundAmountCents: null,
    })
    expect(normalizeWaffoEvent({ eventId: 'e', eventType: 'subscription.created' }).kind).toBe('ignored')
    expect(() => normalizeWaffoEvent({ eventType: 'order.completed' })).toThrow(WebhookVerificationError)
  })
})

describe('createWaffoProvider.createCheckout', () => {
  afterEach(() => vi.unstubAllGlobals())

  // 商户私钥可能是 PKCS#1（BEGIN RSA PRIVATE KEY）或 PKCS#8；PKCS#1 走手写的 DER 包装，必须产出可被公钥验证的签名
  it.each(['pkcs1', 'pkcs8'] as const)('%s 私钥签出的请求可被对应公钥验证', async (type) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type, format: 'pem' },
    })
    const calls: Array<{ url: string; headers: Headers; body: string }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: String(init.body) })
      const data = url.endsWith('/issue-session-token') ? { token: 'tok_1' } : { sessionId: 'ses_1', checkoutUrl: 'https://pay.example/c/1' }
      return new Response(JSON.stringify({ data }), { status: 200 })
    })
    const env = {
      WAFFO_MERCHANT_ID: 'mer_1',
      // 环境变量里通常是单行、用字面量 \n 分隔
      WAFFO_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      WAFFO_PRODUCTS: JSON.stringify({ starter: 'prod_starter' }),
    } as unknown as Env

    const result = await createWaffoProvider(env).createCheckout({
      order: { id: 'ord_1', packageId: 'starter', credits: 100, amountCents: 990, currency: 'USD' },
      user: { id: 'usr_1', email: 'a@example.com', name: null },
      successUrl: 'https://example.com/checkout/success?order=ord_1',
      cancelUrl: 'https://example.com/pricing',
    })

    expect(result).toEqual({ url: 'https://pay.example/c/1#token=tok_1', sessionId: 'ses_1' })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const path = new URL(call.url).pathname
      const bodyHash = createHash('sha256').update(call.body).digest('base64')
      const verifier = createVerify('RSA-SHA256').update(`POST\n${path}\n${call.headers.get('x-timestamp')}\n${bodyHash}`)
      expect(verifier.verify(publicKey, call.headers.get('x-signature')!, 'base64')).toBe(true)
      expect(call.headers.get('x-merchant-id')).toBe('mer_1')
    }
    const session = JSON.parse(calls.find((c) => c.url.endsWith('/create-session'))!.body)
    expect(session).toMatchObject({ productId: 'prod_starter', orderMerchantExternalId: 'ord_1', metadata: { orderId: 'ord_1' } })
  })

  it('套餐未配置 Waffo 产品时返回 503，不发起请求', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const env = { WAFFO_MERCHANT_ID: 'mer_1', WAFFO_PRIVATE_KEY: 'x', WAFFO_PRODUCTS: '{}' } as unknown as Env
    await expect(
      createWaffoProvider(env).createCheckout({
        order: { id: 'ord_1', packageId: 'starter', credits: 100, amountCents: 990, currency: 'USD' },
        user: { id: 'usr_1', email: 'a@example.com', name: null },
        successUrl: 'https://example.com/s',
        cancelUrl: 'https://example.com/c',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'payment_not_configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
