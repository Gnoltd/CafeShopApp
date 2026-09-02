import { describe, it, expect } from "vitest"
import { willCompleteOrderOnAdvance } from "./useKitchenOrders"
import type { KdsOrderRow, OrderItemStatus } from "@/lib/supabase/order-kds"

function makeOrder(itemStatuses: OrderItemStatus[]): KdsOrderRow {
  return {
    id: "order-1",
    orderType: "pickup",
    status: "ready",
    paymentStatus: "paid",
    paymentMethod: "cash",
    createdAt: 0,
    total: 0,
    items: itemStatuses.map((status, i) => ({
      id: `item-${i}`,
      nameVi: "x",
      nameEn: "x",
      quantity: 1,
      note: null,
      status,
    })),
  }
}

describe("willCompleteOrderOnAdvance", () => {
  it("returns true when every other item is already served", () => {
    const order = makeOrder(["served", "ready"])
    expect(willCompleteOrderOnAdvance(order, "item-1")).toBe(true)
  })

  it("returns false when another item is still preparing", () => {
    const order = makeOrder(["preparing", "ready"])
    expect(willCompleteOrderOnAdvance(order, "item-1")).toBe(false)
  })

  it("returns true for a single-item order", () => {
    const order = makeOrder(["ready"])
    expect(willCompleteOrderOnAdvance(order, "item-0")).toBe(true)
  })
})
