import { describe, it, expect, vi } from "vitest"
import {
  willCompleteOrderOnAdvance,
  withItemStatus,
  advanceItemOptimistically,
  itemPendingKey,
  PREV_ITEM_STATUS,
  mergeInFlightItems,
} from "./useKitchenOrders"
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
      sizeName: null,
      modifierNames: [],
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
    expect(next[0].items[1].status).toBe("ready")
    expect(orders[0].items[0].status).toBe("preparing")
  })
})

describe("advanceItemOptimistically", () => {
  it("applies the optimistic status synchronously, ahead of the RPC resolving", () => {
    let state: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      state = updater(state)
    }
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

    expect(state[0].items[0].status).toBe("ready")
    await expect(call).rejects.toThrow("not_authorized")
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

describe("PREV_ITEM_STATUS", () => {
  it("has no previous step before preparing, the item's own starting status", () => {
    expect(PREV_ITEM_STATUS.preparing).toBeNull()
  })

  it("reverses ready back to preparing, and served back to ready -- one step at a time", () => {
    expect(PREV_ITEM_STATUS.ready).toBe("preparing")
    expect(PREV_ITEM_STATUS.served).toBe("ready")
  })
})

describe("mergeInFlightItems", () => {
  it("returns the fresh snapshot untouched when nothing is pending", () => {
    const fresh = [makeOrder(["ready"])]
    expect(mergeInFlightItems(fresh, [makeOrder(["preparing"])], new Set())).toBe(fresh)
  })

  it("keeps the previous (optimistic) status for a pending item even when the fresh fetch disagrees", () => {
    const previous = [makeOrder(["ready"])]
    const fresh = [makeOrder(["preparing"])]
    const pending = new Set([itemPendingKey("order-1", "item-0")])

    const merged = mergeInFlightItems(fresh, previous, pending)

    expect(merged[0].items[0].status).toBe("ready")
  })

  it("still applies the fresh status for every item that isn't pending", () => {
    const previous = [makeOrder(["ready", "preparing"])]
    const fresh = [makeOrder(["served", "ready"])]
    const pending = new Set([itemPendingKey("order-1", "item-0")])

    const merged = mergeInFlightItems(fresh, previous, pending)

    expect(merged[0].items[0].status).toBe("ready")
    expect(merged[0].items[1].status).toBe("ready")
  })

  it("passes through an order the previous snapshot doesn't have (e.g. a brand-new ticket)", () => {
    const fresh = [makeOrder(["preparing"])]
    const merged = mergeInFlightItems(fresh, [], new Set([itemPendingKey("order-1", "item-0")]))
    expect(merged).toEqual(fresh)
  })
})
