import { describe, expect, it } from 'vitest'
import { anchorPrice, type CreditPackage } from '#/config/site'

const pack = (fields: { priceCents: number; anchorPriceCents?: number }) => ({ id: 'starter', credits: 20, currency: 'USD', ...fields }) as unknown as CreditPackage

// 划线原价只在填了真实原价且高于售价时出现；填错（等于或低于售价）不能显示成“打折”
describe('anchorPrice', () => {
  it('没填原价时不显示', () => {
    expect(anchorPrice(pack({ priceCents: 990 }))).toBeNull()
  })

  it('原价等于或低于售价时不显示', () => {
    expect(anchorPrice(pack({ priceCents: 990, anchorPriceCents: 990 }))).toBeNull()
    expect(anchorPrice(pack({ priceCents: 990, anchorPriceCents: 500 }))).toBeNull()
  })

  it('原价高于售价时返回原价和四舍五入的折扣百分比', () => {
    expect(anchorPrice(pack({ priceCents: 1990, anchorPriceCents: 2990 }))).toEqual({ cents: 2990, percentOff: 33 })
    expect(anchorPrice(pack({ priceCents: 990, anchorPriceCents: 1980 }))).toEqual({ cents: 1980, percentOff: 50 })
  })
})
