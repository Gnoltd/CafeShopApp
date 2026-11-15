import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KitchenOrdersProvider, useKitchenOrders } from "./useKitchenOrders"
import type { KdsOrderRow, KdsPreparationPort, OrderItemStatus } from "@/lib/supabase/order-kds"

function makeOrder(
  itemStatuses: OrderItemStatus[],
  overrides: Partial<KdsOrderRow> = {}
): KdsOrderRow {
  return {
    id: "order-1",
    orderType: "dine-in",
    table: "T1",
    tableId: "table-1",
    status: "paid",
    paymentStatus: "pending",
    paymentMethod: null,
    createdAt: 0,
    total: 50_000,
    items: itemStatuses.map((status, i) => ({
      id: `item-${i}`,
      nameVi: `Món ${i}`,
      nameEn: `Item ${i}`,
      quantity: 1,
      note: null,
      status,
      sizeName: null,
      modifierNames: [],
    })),
    ...overrides,
  }
}

function createInMemoryPort(initialOrders: KdsOrderRow[], initialPending: KdsOrderRow[] = []) {
  let activeOrders = initialOrders
  const pendingOrders = initialPending
  let onChangeCb: (() => void) | null = null
  let onConnectionCb: ((connected: boolean) => void) | null = null

  const getKitchenOrders = vi.fn(async () => activeOrders)
  const getPendingPaymentOrders = vi.fn(async () => pendingOrders)
  const updateItemStatus = vi.fn(async () => {})
  const markOrdersServed = vi.fn(async () => {})
  const recallLastCompletedOrder = vi.fn(async () => {})

  const port: KdsPreparationPort = {
    getKitchenOrders,
    getPendingPaymentOrders,
    updateItemStatus,
    markOrdersServed,
    recallLastCompletedOrder,
    subscribe: ({ onChange, onConnectionChange }) => {
      onChangeCb = onChange
      onConnectionCb = onConnectionChange ?? null
      return () => {
        onChangeCb = null
        onConnectionCb = null
      }
    },
  }

  return {
    port,
    spies: {
      getKitchenOrders,
      getPendingPaymentOrders,
      updateItemStatus,
      markOrdersServed,
      recallLastCompletedOrder,
    },
    setServerOrders(next: KdsOrderRow[]) {
      activeOrders = next
    },
    emitChange() {
      onChangeCb?.()
    },
    emitConnection(connected: boolean) {
      onConnectionCb?.(connected)
    },
  }
}

function renderKdsHook(port: KdsPreparationPort) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <KitchenOrdersProvider port={port}>{children}</KitchenOrdersProvider>
  )
  return renderHook(() => useKitchenOrders(), { wrapper })
}

describe("KitchenOrdersProvider / useKitchenOrders", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("throws when used outside KitchenOrdersProvider", () => {
    expect(() => renderHook(() => useKitchenOrders())).toThrow(
      "useKitchenOrders must be used within a KitchenOrdersProvider"
    )
  })

  it("loads active and pending-payment tickets through the injected port and tracks realtime status", async () => {
    const active = [makeOrder(["preparing"], { id: "ord-a" })]
    const pending = [makeOrder(["preparing"], { id: "ord-p", orderType: "pickup", status: "pending_payment" })]
    const env = createInMemoryPort(active, pending)

    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.orders).toEqual(active)
    expect(result.current.pendingPaymentOrders).toEqual(pending)
    expect(result.current.isRealtimeConnected).toBe(false)

    act(() => env.emitConnection(true))
    expect(result.current.isRealtimeConnected).toBe(true)
  })

  it("applies optimistic item progression, sets pending state, and rolls back on RPC rejection", async () => {
    const env = createInMemoryPort([makeOrder(["preparing"])])
    let rejectUpdate!: (err: Error) => void
    env.spies.updateItemStatus.mockImplementation(
      () => new Promise<void>((_, reject) => { rejectUpdate = reject })
    )

    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    let pendingPromise!: Promise<void>
    act(() => {
      pendingPromise = result.current.advanceItem("order-1", "item-0")
    })

    expect(result.current.isItemPending("order-1", "item-0")).toBe(true)
    expect(result.current.orders[0].items[0].status).toBe("ready")

    await act(async () => {
      rejectUpdate(new Error("not_authorized"))
      await expect(pendingPromise).rejects.toThrow("not_authorized")
    })

    expect(result.current.isItemPending("order-1", "item-0")).toBe(false)
    expect(result.current.orders[0].items[0].status).toBe("preparing")
  })

  it("supports regressItem undo and rolls back if the RPC rejects", async () => {
    const env = createInMemoryPort([makeOrder(["ready"], { status: "ready" })])
    let resolveSuccess!: () => void
    env.spies.updateItemStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveSuccess = resolve })
    )

    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    let regressCall!: Promise<void>
    act(() => {
      regressCall = result.current.regressItem("order-1", "item-0")
    })
    expect(result.current.orders[0].items[0].status).toBe("preparing")
    expect(result.current.isItemPending("order-1", "item-0")).toBe(true)

    await act(async () => {
      resolveSuccess()
      await regressCall
    })
    expect(env.spies.updateItemStatus).toHaveBeenCalledWith("item-0", "preparing")
    expect(result.current.isItemPending("order-1", "item-0")).toBe(false)
    expect(result.current.orders[0].items[0].status).toBe("preparing")
  })

  it("guards against duplicate overlapping taps on the same item while allowing different items", async () => {
    const env = createInMemoryPort([makeOrder(["preparing", "preparing"])])
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    env.spies.updateItemStatus
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSecond = resolve }))

    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    let firstCall!: Promise<void>
    let duplicateCall!: Promise<void>
    let siblingCall!: Promise<void>
    act(() => {
      firstCall = result.current.advanceItem("order-1", "item-0")
      // Duplicate tap on the same item while still in-flight (and before React re-renders!)
      duplicateCall = result.current.advanceItem("order-1", "item-0")
      // Concurrent tap on a different item on the same order
      siblingCall = result.current.advanceItem("order-1", "item-1")
    })

    await act(async () => {
      await duplicateCall
    })

    expect(env.spies.updateItemStatus).toHaveBeenCalledTimes(2)
    expect(env.spies.updateItemStatus).toHaveBeenNthCalledWith(1, "item-0", "ready")
    expect(env.spies.updateItemStatus).toHaveBeenNthCalledWith(2, "item-1", "ready")
    expect(result.current.orders[0].items[0].status).toBe("ready")
    expect(result.current.orders[0].items[1].status).toBe("ready")

    await act(async () => {
      resolveFirst()
      resolveSecond()
      await Promise.all([firstCall, siblingCall])
    })

    expect(result.current.isItemPending("order-1", "item-0")).toBe(false)
    expect(result.current.isItemPending("order-1", "item-1")).toBe(false)
  })

  it("fixes the stale closure bug in load() so an overlapping refetch never reverts an in-flight item", async () => {
    const env = createInMemoryPort([makeOrder(["preparing", "preparing"])])
    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    // Set up a slow refetch that starts BEFORE advanceItem is tapped and
    // carries a stale pre-tap snapshot (`item-0: preparing`, `item-1: ready`).
    let resolveStaleRefetch!: (rows: KdsOrderRow[]) => void
    env.spies.getKitchenOrders.mockImplementationOnce(
      () => new Promise<KdsOrderRow[]>((resolve) => { resolveStaleRefetch = resolve })
    )
    let resolveAdvance!: () => void
    env.spies.updateItemStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveAdvance = resolve })
    )

    // 1. Trigger debounced refetch and let load() begin awaiting getKitchenOrders().
    act(() => {
      env.emitChange()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(env.spies.getKitchenOrders).toHaveBeenCalledTimes(2)

    // 2. While load() is STILL awaiting network (so its closure was created BEFORE
    // this tap!), staff taps item-0 optimistically -> "ready".
    let advanceCall!: Promise<void>
    act(() => {
      advanceCall = result.current.advanceItem("order-1", "item-0")
    })
    expect(result.current.orders[0].items[0].status).toBe("ready")

    // 3. Now the stale load() resolves. Without pendingItemKeysRef, load()'s
    // render-time closure had an empty Set and reverted item-0 back to "preparing".
    await act(async () => {
      resolveStaleRefetch([makeOrder(["preparing", "ready"])])
      await Promise.resolve()
    })

    // In-flight item-0 stays optimistic "ready", while non-pending item-1
    // picks up the fresh server status "ready".
    expect(result.current.orders[0].items[0].status).toBe("ready")
    expect(result.current.orders[0].items[1].status).toBe("ready")

    await act(async () => {
      resolveAdvance()
      await advanceCall
    })
    expect(result.current.isItemPending("order-1", "item-0")).toBe(false)
  })

  it("hands over ready tickets, counts only paid completions, and recalls the last completed order", async () => {
    const paidReady = makeOrder(["ready"], {
      id: "ord-paid",
      orderType: "pickup",
      status: "ready",
      paymentStatus: "paid",
      createdAt: 10_000,
    })
    const unpaidReady = makeOrder(["ready"], {
      id: "ord-unpaid",
      orderType: "dine-in",
      status: "ready",
      paymentStatus: "pending",
      createdAt: 20_000,
    })
    const env = createInMemoryPort([paidReady, unpaidReady])
    vi.setSystemTime(75_000)

    const { result } = renderKdsHook(env.port)
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.handOverOrder("ord-unpaid")
    })
    expect(env.spies.markOrdersServed).toHaveBeenCalledWith(["ord-unpaid"])
    expect(result.current.completedCount).toBe(0)
    expect(result.current.avgTimeLabel).toBe("--:--")

    await act(async () => {
      await result.current.handOverOrder("ord-paid")
    })
    expect(env.spies.markOrdersServed).toHaveBeenCalledWith(["ord-paid"])
    expect(result.current.completedCount).toBe(1)
    expect(result.current.avgTimeLabel).toBe("01:05")

    await act(async () => {
      await result.current.recallLastOrder()
    })
    expect(env.spies.recallLastCompletedOrder).toHaveBeenCalledTimes(1)
    expect(result.current.completedCount).toBe(0)
    expect(result.current.avgTimeLabel).toBe("--:--")

    await act(async () => {
      await result.current.advanceItem("ord-paid", "item-0")
    })
    expect(env.spies.updateItemStatus).toHaveBeenCalledWith("item-0", "served")
    expect(result.current.completedCount).toBe(1)
  })
})
