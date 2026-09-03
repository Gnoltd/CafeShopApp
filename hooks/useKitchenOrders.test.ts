import { describe, it, expect, vi } from "vitest"
import {
  willCompleteOrderOnAdvance,
  withItemStatus,
  advanceItemOptimistically,
  advanceItemGuarded,
  itemPendingKey,
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

// Round-2 regression coverage: a prior fix added the optimistic update
// above, which itself introduced a same-item race (two overlapping
// advance calls for one item, whichever RPC settles last could clobber
// the other's result). advanceItemGuarded is the structural fix -- these
// tests prove the in-flight marker is set before the optimistic update,
// cleared via `finally` on both success and rejection, and that a call
// arriving while the marker is still set is a no-op (never reaches the
// RPC), which is what makes the button-disable in kitchen-board.tsx a
// real guarantee rather than just cosmetic.
describe("advanceItemGuarded", () => {
  function makePendingSet() {
    let pending = new Set<string>()
    const setPending = (updater: (current: Set<string>) => Set<string>) => {
      pending = updater(pending)
    }
    return { getPending: () => pending, setPending }
  }

  it("marks the item pending before the optimistic update, and clears it once the RPC resolves", async () => {
    let orders: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      orders = updater(orders)
    }
    const { getPending, setPending } = makePendingSet()
    const advance = vi.fn().mockResolvedValue(undefined)

    const call = advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-0", "ready", setOrders, advance)

    // Pending flag lands synchronously, ahead of the RPC settling.
    expect(getPending().has(itemPendingKey("order-1", "item-0"))).toBe(true)

    await call

    expect(getPending().has(itemPendingKey("order-1", "item-0"))).toBe(false)
  })

  it("clears the pending flag via finally even when the RPC rejects", async () => {
    let orders: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      orders = updater(orders)
    }
    const { getPending, setPending } = makePendingSet()
    const advance = vi.fn().mockRejectedValue(new Error("network_blip"))

    const call = advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-0", "ready", setOrders, advance)
    expect(getPending().has(itemPendingKey("order-1", "item-0"))).toBe(true)

    await expect(call).rejects.toThrow("network_blip")

    expect(getPending().has(itemPendingKey("order-1", "item-0"))).toBe(false)
  })

  it("no-ops a second call for the same item while the first is still in flight -- the regression this fix closes", async () => {
    let orders: KdsOrderRow[] = [makeOrder(["preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      orders = updater(orders)
    }
    const { getPending, setPending } = makePendingSet()
    // Never resolves -- simulates RPC1 (Mark Ready) still in flight.
    const advance = vi.fn(() => new Promise<void>(() => {}))

    // Tap 1: "Mark Ready" fires, RPC1 starts.
    void advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-0", "ready", setOrders, advance)
    expect(advance).toHaveBeenCalledTimes(1)

    // Tap 2: a same-item re-tap ("Mark Served") arriving before RPC1
    // settles must not fire a second overlapping RPC for this item.
    await advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-0", "served", setOrders, advance)

    expect(advance).toHaveBeenCalledTimes(1)
    // The optimistic status stays whatever RPC1's tap applied -- RPC2
    // never got a chance to touch it.
    expect(orders[0].items[0].status).toBe("ready")
  })

  it("does not block a call for a different item on the same order", async () => {
    let orders: KdsOrderRow[] = [makeOrder(["preparing", "preparing"])]
    const setOrders = (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
      orders = updater(orders)
    }
    const { getPending, setPending } = makePendingSet()
    const advance = vi.fn(() => new Promise<void>(() => {}))

    // Neither call's RPC resolves in this test -- both stay in flight, so
    // this only asserts against the synchronous part of each call.
    void advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-0", "ready", setOrders, advance)
    void advanceItemGuarded(getPending(), setPending, orders, "order-1", "item-1", "ready", setOrders, advance)

    expect(advance).toHaveBeenCalledTimes(2)
    expect(getPending().has(itemPendingKey("order-1", "item-0"))).toBe(true)
    expect(getPending().has(itemPendingKey("order-1", "item-1"))).toBe(true)
  })
})
