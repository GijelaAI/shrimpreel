import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeDodoEvent, verifyDodoWebhook } from '#/server/payments/dodo'

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
