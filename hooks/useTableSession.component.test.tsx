import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTableSession } from "./useTableSession"
import type {
  AddCartItemInput,
  TableSession,
  TableSessionCartItem,
  TableSessionPort,
} from "@/lib/supabase/table-session-data"

const mocks = vi.hoisted(() => ({
  createClientCalls: 0,
  rpc: vi.fn(),
  channel: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    mocks.createClientCalls += 1
    return { rpc: mocks.rpc, channel: mocks.channel }
  },
}))

const rawSession = (quantity = 1) => ({
  session: {
    id: "session-a",
    paymentPending: false,
    checkoutPromoCode: null,
    checkoutDiscountAmount: 0,
  },
  cartItems: [
    {
      id: "item-a",
      menuItemId: "coffee",
      nameVi: "Cà phê",
      nameEn: "Coffee",
      sizeId: null,
      modifierIds: [],
      note: null,
      unitPrice: 20000,
      quantity,
      version: quantity,
    },
  ],
  rounds: [],
  unpaidTotal: 0,
})

function makeItem(overrides: Partial<TableSessionCartItem> = {}): TableSessionCartItem {
  return {
    id: "item-a",
    menuItemId: "coffee",
    nameVi: "Cà phê",
    nameEn: "Coffee",
    sizeId: null,
    modifierIds: [],
    note: null,
    unitPrice: 20000,
    quantity: 1,
    version: 1,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<TableSession> = {}): TableSession {
  return {
    sessionId: "session-a",
    hasSession: true,
    paymentPending: false,
    checkoutPromoCode: null,
    checkoutDiscountAmount: 0,
    cartItems: [makeItem()],
    rounds: [],
    unpaidTotal: 0,
    ...overrides,
  }
}

function createInMemoryPort(initial: TableSession = makeSnapshot()) {
  let state: TableSession = structuredClone(initial)
  let nextId = 1

  const port: TableSessionPort = {
    getSession: vi.fn(async () => structuredClone(state)),
    addCartItem: vi.fn(async (_qrToken: string, input: AddCartItemInput) => {
      state.hasSession = true
      state.sessionId ??= "session-a"
      state.cartItems.push(
        makeItem({
          id: `item-${++nextId}`,
          menuItemId: input.menuItemId,
          sizeId: input.sizeId ?? null,
          modifierIds: [...input.modifierIds].sort(),
          note: input.note ?? null,
          quantity: input.quantity ?? 1,
          version: 1,
        })
      )
    }),
    updateCartItemQuantity: vi.fn(
      async (_qrToken: string, cartItemId: string, delta: number, expectedVersion?: number) => {
        const target = state.cartItems.find((item) => item.id === cartItemId)
        if (!target) throw new Error("cart_item_not_found")
        if (expectedVersion !== undefined && target.version !== expectedVersion) {
          throw { code: "P0001", message: "stale_cart_item" }
        }
        const nextQty = target.quantity + delta
        if (nextQty <= 0) {
          state.cartItems = state.cartItems.filter((item) => item.id !== cartItemId)
        } else {
          target.quantity = nextQty
          target.version += 1
        }
      }
    ),
    removeCartItem: vi.fn(async (_qrToken: string, cartItemId: string) => {
      state.cartItems = state.cartItems.filter((item) => item.id !== cartItemId)
    }),
    placeRound: vi.fn(async () => {
      const total = state.cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
      const roundId = `order-${++nextId}`
      state.rounds.push({
        id: roundId,
        createdAt: Date.now(),
        status: "preparing",
        paymentStatus: "pending",
        paymentMethod: null,
        subtotal: total,
        taxAmount: 0,
        total,
        items: state.cartItems.map((i) => ({
          nameVi: i.nameVi,
          nameEn: i.nameEn,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          note: i.note,
        })),
      })
      state.cartItems = []
      state.unpaidTotal += total
      return { orderId: roundId, total }
    }),
    abandonSession: vi.fn(async () => {
      state = makeSnapshot({ sessionId: null, hasSession: false, cartItems: [] })
      return true
    }),
    requestBill: vi.fn(async () => {
      state.paymentPending = true
    }),
  }

  return {
    port,
    getState: () => state,
    setState: (next: TableSession) => {
      state = structuredClone(next)
    },
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useTableSession", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.createClientCalls = 0
    mocks.rpc.mockReset()
    mocks.channel.mockReset()
    mocks.rpc.mockResolvedValue({ data: rawSession(), error: null })
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe("default Supabase browser adapter", () => {
    it("polls through the QR RPC without subscribing to other tables' records", async () => {
      const { unmount } = renderHook(() => useTableSession("qr-a"))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mocks.createClientCalls).toBe(1)
      expect(mocks.rpc).toHaveBeenCalledWith("get_table_session", { p_qr_token: "qr-a" })
      expect(mocks.channel).not.toHaveBeenCalled()
      mocks.rpc.mockClear()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3300)
      })
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
    })

    it("refreshes after a successful mutation without waiting for a broadcast", async () => {
      const { result } = renderHook(() => useTableSession("qr-a"))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      mocks.rpc
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: rawSession(2), error: null })
      await act(async () => {
        await result.current.addItem({ menuItemId: "coffee", modifierIds: [] })
      })
      expect(result.current.cartItems[0].quantity).toBe(2)
      expect(mocks.rpc).toHaveBeenLastCalledWith("get_table_session", { p_qr_token: "qr-a" })
    })

    it("keeps previous data marked stale when a secure RPC read fails", async () => {
      const { result } = renderHook(() => useTableSession("qr-a"))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      mocks.rpc.mockResolvedValue({ data: null, error: new Error("offline") })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3300)
      })
      expect(result.current.cartItems).toHaveLength(1)
      expect(result.current.hasStaleData).toBe(true)
    })
  })

  describe("injected TableSessionPort", () => {
    it("never instantiates a Supabase client when a port is injected", async () => {
      const { port } = createInMemoryPort()
      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mocks.createClientCalls).toBe(0)
      expect(result.current.cartItems).toHaveLength(1)
    })

    it("tracks pendingCartItemIds per row and drops concurrent duplicate mutations on the same item", async () => {
      const { port } = createInMemoryPort(
        makeSnapshot({
          cartItems: [makeItem({ id: "item-a" }), makeItem({ id: "item-b", menuItemId: "tea" })],
        })
      )
      const gate = deferred()
      vi.mocked(port.updateCartItemQuantity).mockImplementationOnce(async () => {
        await gate.promise
      })

      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      let firstCall!: Promise<void>
      let secondCall!: Promise<void>
      await act(async () => {
        firstCall = result.current.updateQuantity("item-a", 2)
        secondCall = result.current.updateQuantity("item-a", 3)
      })

      expect(result.current.pendingCartItemIds.has("item-a")).toBe(true)
      expect(result.current.pendingCartItemIds.has("item-b")).toBe(false)
      expect(port.updateCartItemQuantity).toHaveBeenCalledTimes(1)

      await act(async () => {
        gate.resolve()
        await firstCall
        await secondCall
      })

      expect(result.current.pendingCartItemIds.size).toBe(0)
    })

    it("maps addItem failures to error='add_item' and clears on next mutation", async () => {
      const { port } = createInMemoryPort()
      vi.mocked(port.addCartItem).mockRejectedValueOnce(new Error("boom"))

      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        await result.current.addItem({ menuItemId: "tea", modifierIds: [] })
      })
      expect(result.current.error).toBe("add_item")

      await act(async () => {
        await result.current.addItem({ menuItemId: "tea", modifierIds: [] })
      })
      expect(result.current.error).toBeNull()
      expect(result.current.cartItems).toHaveLength(2)
    })

    it("detects stale_cart_item conflicts, sets error='stale_cart_item', and auto-refetches fresh version", async () => {
      const memory = createInMemoryPort(
        makeSnapshot({ cartItems: [makeItem({ id: "item-a", quantity: 1, version: 1 })] })
      )

      const { result } = renderHook(() => useTableSession("qr-a", { port: memory.port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      // Simulate another device bumping item-a on the server before this device acts.
      memory.setState(
        makeSnapshot({ cartItems: [makeItem({ id: "item-a", quantity: 3, version: 2 })] })
      )

      await act(async () => {
        await result.current.updateQuantity("item-a", 2)
      })

      expect(result.current.error).toBe("stale_cart_item")
      expect(result.current.cartItems[0].quantity).toBe(3)
      expect(result.current.cartItems[0].version).toBe(2)
      expect(result.current.pendingCartItemIds.size).toBe(0)

      // Next mutation uses refreshed quantity/version and succeeds.
      await act(async () => {
        await result.current.updateQuantity("item-a", 4)
      })
      expect(result.current.error).toBeNull()
      expect(result.current.cartItems[0].quantity).toBe(4)
      expect(result.current.cartItems[0].version).toBe(3)
    })

    it("maps non-stale update/remove failures to error='cart_update' and refetches", async () => {
      const { port } = createInMemoryPort()
      vi.mocked(port.removeCartItem).mockRejectedValueOnce(new Error("network down"))

      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      const readsBefore = vi.mocked(port.getSession).mock.calls.length
      await act(async () => {
        await result.current.removeItem("item-a")
      })

      expect(result.current.error).toBe("cart_update")
      expect(vi.mocked(port.getSession).mock.calls.length).toBeGreaterThan(readsBefore)
      expect(result.current.pendingCartItemIds.size).toBe(0)
    })

    it("manages isPlacingRound, error='place_round', and submissionId retry idempotency", async () => {
      const { port } = createInMemoryPort()
      const gate = deferred<{ orderId: string; total: number }>()
      vi.mocked(port.placeRound)
        .mockRejectedValueOnce(new Error("timeout"))
        .mockImplementationOnce(() => gate.promise)

      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      let failedResult: unknown
      await act(async () => {
        failedResult = await result.current.placeRound()
      })
      expect(failedResult).toBeNull()
      expect(result.current.error).toBe("place_round")
      expect(result.current.isPlacingRound).toBe(false)

      const firstSubmissionId = vi.mocked(port.placeRound).mock.calls[0][1]

      let secondAttempt!: Promise<unknown>
      await act(async () => {
        secondAttempt = result.current.placeRound()
      })
      expect(result.current.isPlacingRound).toBe(true)
      expect(result.current.error).toBeNull()

      const retrySubmissionId = vi.mocked(port.placeRound).mock.calls[1][1]
      expect(retrySubmissionId).toBe(firstSubmissionId)

      await act(async () => {
        gate.resolve({ orderId: "order-99", total: 20000 })
        const placed = await secondAttempt
        expect(placed).toEqual({ orderId: "order-99", total: 20000 })
      })
      expect(result.current.isPlacingRound).toBe(false)

      // Next round receives a fresh submissionId after prior success.
      await act(async () => {
        await result.current.placeRound()
      })
      const thirdSubmissionId = vi.mocked(port.placeRound).mock.calls[2][1]
      expect(thirdSubmissionId).not.toBe(firstSubmissionId)
    })

    it("routes requestBill through port, refreshes paymentPending, and propagates rejection", async () => {
      const { port } = createInMemoryPort(
        makeSnapshot({
          cartItems: [],
          rounds: [
            {
              id: "r1",
              createdAt: 1,
              status: "served",
              paymentStatus: "pending",
              paymentMethod: null,
              subtotal: 20000,
              taxAmount: 0,
              total: 20000,
              items: [],
            },
          ],
          unpaidTotal: 20000,
        })
      )

      const { result } = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      vi.mocked(port.requestBill).mockRejectedValueOnce(new Error("bill_failed"))
      await expect(
        act(async () => {
          await result.current.requestBill()
        })
      ).rejects.toThrow("bill_failed")
      expect(result.current.paymentPending).toBe(false)

      await act(async () => {
        await result.current.requestBill()
      })
      expect(port.requestBill).toHaveBeenLastCalledWith("qr-a")
      expect(result.current.paymentPending).toBe(true)
    })

    it("invokes onAbandon callback when supplied or cleans matching phadincafe-active-table localStorage", async () => {
      const { port } = createInMemoryPort()
      const onAbandon = vi.fn()
      window.localStorage.setItem("phadincafe-active-table", JSON.stringify({ number: "1", qrToken: "qr-a" }))

      const { result, unmount } = renderHook(() =>
        useTableSession("qr-a", { port, onAbandon })
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        await result.current.dismissAndAbandon()
      })
      expect(onAbandon).toHaveBeenCalledWith("qr-a")
      // When custom onAbandon is supplied, hook delegates storage cleanup to it.
      expect(window.localStorage.getItem("phadincafe-active-table")).not.toBeNull()
      unmount()

      // Fallback without onAbandon clears matching JSON or plain tokens, never other tables.
      window.localStorage.setItem("phadincafe-active-table", JSON.stringify({ number: "2", qrToken: "qr-other" }))
      const fallbackHook = renderHook(() => useTableSession("qr-a", { port }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await fallbackHook.result.current.dismissAndAbandon()
      })
      expect(window.localStorage.getItem("phadincafe-active-table")).toBe(
        JSON.stringify({ number: "2", qrToken: "qr-other" })
      )

      window.localStorage.setItem("phadincafe-active-table", "qr-a")
      await act(async () => {
        await fallbackHook.result.current.dismissAndAbandon()
      })
      expect(window.localStorage.getItem("phadincafe-active-table")).toBeNull()
    })

    it("prompts after 5 minutes of idle draft cart and auto-abandons 1 minute later unless confirmed", async () => {
      const { port } = createInMemoryPort()
      const onAbandon = vi.fn()
      const { result } = renderHook(() => useTableSession("qr-a", { port, onAbandon }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      expect(result.current.showIdlePrompt).toBe(true)

      await act(async () => {
        result.current.confirmStillHere()
      })
      expect(result.current.showIdlePrompt).toBe(false)
      expect(port.abandonSession).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      expect(result.current.showIdlePrompt).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 1000)
      })
      expect(port.abandonSession).toHaveBeenCalledWith("qr-a")
      expect(onAbandon).toHaveBeenCalledWith("qr-a")
    })
  })
})
