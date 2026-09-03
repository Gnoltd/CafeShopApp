import { describe, it, expect, vi } from "vitest"
import { willCompleteOrderOnAdvance, withItemStatus, advanceItemOptimistically } from "./useKitchenOrders"
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

describe("withItemStatus", () => {
  it("swaps only the targeted item's status, leaving sibling items and other orders untouched", () => {
    const orders = [makeOrder(["preparing", "ready"])]
    const next = withItemStatus(orders, "order-1", "item-0", "ready")
    expect(next[0].items[0].status).toBe("ready")
    expect(next[0].items[1].status).toBe("ready") // unchanged, was already "ready"
    expect(orders[0].items[0].status).toBe("preparing") // original array untouched
  })
})

describe("advanceItemOptimistically", () => {
  it("applies the optimistic status synchronously, ahead of the RPC resolving", () => {
    let state: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      state = updater(state)
    }
    // Never resolves within this test -- proves the UI update doesn't wait on it.
    const advance = vi.fn(() => new Promise<void>(() => {}))

    void advanceItemOptimistically(state, "order-1", "item-0", "ready", setOrders, advance)

    expect(state[0].items[0].status).toBe("ready")
  })

  it("rolls back to the pre-tap status when the RPC rejects", async () => {
    let state: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      state = updater(state)
    }
    const advance = vi.fn().mockRejectedValue(new Error("not_authorized"))

    const call = advanceItemOptimistically(state, "order-1", "item-0", "ready", setOrders, advance)

    // Optimistic guess is visible immediately, before the rejection settles.
    expect(state[0].items[0].status).toBe("ready")

    // The failure must still propagate so the caller's existing error
    // surfacing (kitchen-display.tsx's setError) fires.
    await expect(call).rejects.toThrow("not_authorized")

    // And the optimistic guess must be reverted -- not left showing a
    // status that never actually happened server-side.
    expect(state[0].items[0].status).toBe("preparing")
  })

  it("leaves the optimistic status in place once the RPC succeeds", async () => {
    let state: KdsOrderRow[] = [makeOrder(["ready"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      state = updater(state)
    }
    const advance = vi.fn().mockResolvedValue(undefined)

    await advanceItemOptimistically(state, "order-1", "item-0", "served", setOrders, advance)

    expect(state[0].items[0].status).toBe("served")
    expect(advance).toHaveBeenCalledWith("item-0", "served")
  })
})
