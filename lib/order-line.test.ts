import { describe, it, expect } from "vitest"
import { buildOrderLineKey, computeOrderTotals } from "./order-line"

describe("buildOrderLineKey", () => {
  it("produces the same key regardless of modifier order", () => {
    const a = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: ["mod-a", "mod-b"] })
    const b = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: ["mod-b", "mod-a"] })
    expect(a).toBe(b)
  })

  it("treats a missing size as distinct from any real size", () => {
    const noSize = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [] })
    const withSize = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: [] })
    expect(noSize).not.toBe(withSize)
  })

  it("treats two different notes as distinct lines", () => {
    const a = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "less sugar" })
    const b = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "extra ice" })
    expect(a).not.toBe(b)
  })

  it("treats an omitted note the same as an empty note", () => {
    const omitted = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [] })
    const empty = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "" })
    expect(omitted).toBe(empty)
  })
})

describe("computeOrderTotals", () => {
  it("computes tax on the post-discount amount, rounded", () => {
    const result = computeOrderTotals(100000, 10000, 8)
    expect(result).toEqual({ taxableAmount: 90000, tax: 7200, total: 97200 })
  })

  it("clamps taxable amount at zero when discount exceeds subtotal", () => {
    const result = computeOrderTotals(10000, 50000, 8)
    expect(result).toEqual({ taxableAmount: 0, tax: 0, total: 0 })
  })

  it("applies zero tax when the rate is zero", () => {
    const result = computeOrderTotals(50000, 0, 0)
    expect(result).toEqual({ taxableAmount: 50000, tax: 0, total: 50000 })
  })
})
