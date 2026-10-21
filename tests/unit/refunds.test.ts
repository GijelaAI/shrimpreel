import { describe, expect, it } from 'vitest'
import { assertProviderRefundAllowed, checkPaidEvent, localRefundKey, planRefund } from '#/server/orders'
import { displayToMinor, minorToDisplay } from '#/server/payments/amount'

// 部分退款按金额比例回收积分；累计退满才把订单置为 refunded
describe('planRefund', () => {
  const order = {
    status: 'paid' as const,
    credits: 60,
    amount_cents: 1990,
    paid_amount_cents: 1990,
    refunded_amount_cents: 0,
    refunded_credits: 0,
  }

  it('不带金额 = 全额退剩余部分', () => {
    expect(planRefund(order, { amountCents: null })).toEqual({ full: true, paidCents: 1990, credits: 60, amountCents: 1990 })
  })

  it('部分退款按比例回收并四舍五入', () => {
    expect(planRefund(order, { amountCents: 995 })).toEqual({ full: false, paidCents: 1990, credits: 30, amountCents: 995 })
    expect(planRefund(order, { amountCents: 500 })).toMatchObject({ full: false, credits: 15 })
  })

  it('第二次部分退款把剩余退满时转为全额，只回收剩余积分', () => {
    const afterFirst = { ...order, refunded_amount_cents: 995, refunded_credits: 30 }
    expect(planRefund(afterFirst, { amountCents: 995 })).toEqual({ full: true, paidCents: 1990, credits: 30, amountCents: 995 })
    expect(planRefund(afterFirst, { amountCents: 5000 })).toMatchObject({ full: true, credits: 30, amountCents: 995 })
  })

  it('实收与标价不同（含税/换汇）时以实收为分母；事件里的原始金额优先', () => {
    const taxed = { ...order, paid_amount_cents: 2189 }
    expect(planRefund(taxed, { amountCents: 1990 })).toMatchObject({ full: false, credits: 55 })
    expect(planRefund(taxed, { amountCents: 1990, originalAmountCents: 1990 })).toMatchObject({ full: true, credits: 60 })
  })

  it('非 paid 状态不可退', () => {
    expect(planRefund({ ...order, status: 'refunded' }, { amountCents: null })).toBeNull()
    expect(planRefund({ ...order, status: 'pending' }, { amountCents: 100 })).toBeNull()
  })
})

describe('金额换算', () => {
  it('按币种小数位换算最小单位', () => {
    expect(displayToMinor('29.00', 'USD')).toBe(2900)
    expect(displayToMinor('19.99', 'EUR')).toBe(1999)
    expect(displayToMinor('4500', 'JPY')).toBe(4500)
    expect(displayToMinor('1,234.50', 'USD')).toBe(123450)
    expect(displayToMinor('abc', 'USD')).toBeNull()
    expect(displayToMinor(undefined, 'USD')).toBeNull()
    expect(minorToDisplay(990, 'USD')).toBe('9.90')
    expect(minorToDisplay(4500, 'JPY')).toBe('4500')
  })
})

// 后台"仅记账"的幂等键必须和退款 webhook 一致，否则 webhook 迟到时会重复回收积分
describe('localRefundKey', () => {
  const order = (provider: 'mock' | 'waffo' | 'dodo', refunded = 0) => ({ provider, refunded_amount_cents: refunded })

  it('mock 订单由已退金额派生：并发连点同键，下一笔部分退款换新键', () => {
    expect(localRefundKey(order('mock'), undefined, 330)).toBe('admin:0:330')
    expect(localRefundKey(order('mock'), '  ', 330)).toBe('admin:0:330')
    expect(localRefundKey(order('mock', 330), undefined, 330)).toBe('admin:330:330')
  })

  it('真实支付商订单必须填退款单号', () => {
    expect(() => localRefundKey(order('dodo'), undefined, 100)).toThrow(expect.objectContaining({ status: 400, code: 'refund_id_required' }))
    expect(localRefundKey(order('dodo'), ' rfnd_123 ', 100)).toBe('rfnd_123')
  })

  it('Waffo 只接受 REF_ 退款单号，拒绝 TKT_ 工单号', () => {
    expect(() => localRefundKey(order('waffo'), 'TKT_68bVCM3pOK9scverXJYjFe', 330)).toThrow(expect.objectContaining({ code: 'invalid_refund_id' }))
    expect(localRefundKey(order('waffo'), 'REF_4iYlsb1X7Zc6wUMZL2VHLs', 330)).toBe('REF_4iYlsb1X7Zc6wUMZL2VHLs')
  })
})

// Waffo 实测：已部分退款的支付再提交退款返回 409 "A refund record already exists for this payment"
describe('assertProviderRefundAllowed', () => {
  const paidAt = '2026-10-01T00:00:00.000Z'
  const day = 24 * 60 * 60 * 1000
  const order = (provider: 'waffo' | 'dodo', refunded = 0) => ({ provider, refunded_amount_cents: refunded, paid_at: paidAt })

  it('Waffo 每笔支付只能退一次，14 天窗口按 paid_at 计算', () => {
    const now = Date.parse(paidAt) + 14 * day
    expect(() => assertProviderRefundAllowed(order('waffo'), now)).not.toThrow()
    expect(() => assertProviderRefundAllowed(order('waffo', 330), now)).toThrow(expect.objectContaining({ status: 409, code: 'waffo_refund_exists' }))
    expect(() => assertProviderRefundAllowed(order('waffo'), now + 1)).toThrow(expect.objectContaining({ status: 409, code: 'refund_window_expired' }))
  })

  it('Dodo 可多次部分退款，窗口为 30 天', () => {
    const now = Date.parse(paidAt) + 30 * day
    expect(() => assertProviderRefundAllowed(order('dodo', 330), now)).not.toThrow()
    expect(() => assertProviderRefundAllowed(order('dodo', 330), now + 1)).toThrow(expect.objectContaining({ status: 409, code: 'refund_window_expired' }))
  })
})

// 付款回调入账前核对：只拦买错商品和同币种少付；换币种、折扣码、缺字段时不误拦
describe('checkPaidEvent', () => {
  const order = { package_id: 'starter', amount_cents: 990, currency: 'USD' }
  const paid = {
    kind: 'paid' as const,
    eventId: 'e',
    eventType: 'payment.succeeded',
    orderId: 'ord_1',
    providerOrderId: null,
    providerPaymentId: null,
    paidAmount: '9.90',
    paidCurrency: 'USD',
    paidAmountCents: 990,
  }

  it('金额相等或含税多付都通过', () => {
    expect(checkPaidEvent(order, paid, null)).toBeNull()
    expect(checkPaidEvent(order, { ...paid, paidAmountCents: 1079, paidCurrency: 'usd' }, null)).toBeNull()
  })

  it('同币种少付、商品或套餐不符时返回原因', () => {
    expect(checkPaidEvent(order, { ...paid, paidAmountCents: 1 }, null)).toMatch(/paid 1 < price 990/)
    expect(checkPaidEvent(order, { ...paid, productId: 'pdt_pro' }, 'pdt_starter')).toMatch(/product pdt_pro/)
    expect(checkPaidEvent(order, { ...paid, packageId: 'pro' }, null)).toMatch(/package pro/)
  })

  it('换币种、折扣码、缺金额或未配置商品映射时不拦', () => {
    expect(checkPaidEvent(order, { ...paid, paidAmountCents: 70000, paidCurrency: 'JPY' }, null)).toBeNull()
    expect(checkPaidEvent(order, { ...paid, paidAmountCents: 500, discounted: true }, null)).toBeNull()
    expect(checkPaidEvent(order, { ...paid, paidAmountCents: null }, null)).toBeNull()
    expect(checkPaidEvent(order, { ...paid, productId: 'pdt_x' }, null)).toBeNull()
  })

  it('折扣码不豁免商品核对', () => {
    expect(checkPaidEvent(order, { ...paid, discounted: true, productId: 'pdt_pro' }, 'pdt_starter')).toMatch(/product/)
  })
})
