import { describe, it, expect } from "vitest"
import { computeOrderTotal, resolvePromoDiscount } from "./order-total"

describe("computeOrderTotal", () => {
  it("returns the subtotal as total when there is no discount and no tax", () => {
    expect(computeOrderTotal({ subtotal: 100_000, taxRatePercent: 0 })).toEqual({
      taxableAmount: 100_000,
      tax: 0,
      total: 100_000,
    })
  })

  it("taxes the post-discount subtotal, not the raw subtotal", () => {
    expect(computeOrderTotal({ subtotal: 100_000, discount: 20_000, taxRatePercent: 10 })).toEqual({
      taxableAmount: 80_000,
      tax: 8_000,
      total: 88_000,
    })
  })

  it("clamps the taxable amount at zero when discount exceeds subtotal", () => {
    expect(computeOrderTotal({ subtotal: 50_000, discount: 80_000, taxRatePercent: 10 })).toEqual({
      taxableAmount: 0,
      tax: 0,
      total: 0,
    })
  })

  it("rounds tax to the nearest whole VND", () => {
    expect(computeOrderTotal({ subtotal: 33_333, taxRatePercent: 8 })).toEqual({
      taxableAmount: 33_333,
      tax: 2_667,
      total: 36_000,
    })
  })

  it("defaults discount to zero when omitted, matching POS (no discounts at POS)", () => {
    expect(computeOrderTotal({ subtotal: 45_000, taxRatePercent: 10 })).toEqual({
      taxableAmount: 45_000,
      tax: 4_500,
      total: 49_500,
    })
  })
})

describe("resolvePromoDiscount", () => {
  it("returns 0 when there is no applied rule", () => {
    expect(resolvePromoDiscount(100_000, null)).toBe(0)
  })

  it("computes a percent discount off the subtotal", () => {
    expect(resolvePromoDiscount(100_000, { discountType: "percent", discountValue: 10 })).toBe(10_000)
  })

  it("uses a fixed discount value as-is", () => {
    expect(resolvePromoDiscount(100_000, { discountType: "fixed", discountValue: 15_000 })).toBe(15_000)
  })

  it("clamps a fixed discount at the subtotal", () => {
    expect(resolvePromoDiscount(10_000, { discountType: "fixed", discountValue: 15_000 })).toBe(10_000)
  })

  it("rounds a percent discount to the nearest whole VND", () => {
    expect(resolvePromoDiscount(33_333, { discountType: "percent", discountValue: 10 })).toBe(3_333)
  })
})
