import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTableSession } from "./useTableSession"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), channel: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks,
}))

const session = (quantity = 1) => ({
  session: { id: "session-a", paymentPending: false, checkoutPromoCode: null, checkoutDiscountAmount: 0 },
  cartItems: [{ id: "item-a", menuItemId: "coffee", nameVi: "Cà phê", nameEn: "Coffee", sizeId: null, modifierIds: [], note: null, unitPrice: 20000, quantity, version: quantity }],
  rounds: [], unpaidTotal: 0,
})

describe("QR-scoped table session reads", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.rpc.mockReset()
    mocks.channel.mockReset()
    mocks.rpc.mockResolvedValue({ data: session(), error: null })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it("polls through the QR RPC without subscribing to other tables' records", async () => {
    const { unmount } = renderHook(() => useTableSession("qr-a"))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mocks.rpc).toHaveBeenCalledWith("get_table_session", { p_qr_token: "qr-a" })
    expect(mocks.channel).not.toHaveBeenCalled()
    mocks.rpc.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(3300) })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it("refreshes after a successful mutation without waiting for a broadcast", async () => {
    const { result } = renderHook(() => useTableSession("qr-a"))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: session(2), error: null })
    await act(async () => { await result.current.addItem({ menuItemId: "coffee", modifierIds: [] }) })
    expect(result.current.cartItems[0].quantity).toBe(2)
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_table_session", { p_qr_token: "qr-a" })
  })

  it("keeps previous data marked stale when a secure RPC read fails", async () => {
    const { result } = renderHook(() => useTableSession("qr-a"))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("offline") })
    await act(async () => { await vi.advanceTimersByTimeAsync(3300) })
    expect(result.current.cartItems).toHaveLength(1)
    expect(result.current.hasStaleData).toBe(true)
  })
})
