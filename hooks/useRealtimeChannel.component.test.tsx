import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { REALTIME_SUBSCRIBE_STATES, type SupabaseClient } from "@supabase/supabase-js"
import { useRealtimeChannel } from "./useRealtimeChannel"

describe("useRealtimeChannel connection recovery", () => {
  it("reports a disconnect and a later successful resubscription", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let reportStatus!: (status: REALTIME_SUBSCRIBE_STATES) => void
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((callback: typeof reportStatus) => { reportStatus = callback; return channel }),
    }
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient
    const onStatusChange = vi.fn()

    renderHook(() => useRealtimeChannel(
      supabase,
      "orders-test",
      [{ table: "orders", event: "*", onChange: vi.fn() }],
      { onStatusChange }
    ))

    act(() => reportStatus(REALTIME_SUBSCRIBE_STATES.TIMED_OUT))
    act(() => reportStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED))

    expect(onStatusChange).toHaveBeenNthCalledWith(1, "TIMED_OUT")
    expect(onStatusChange).toHaveBeenNthCalledWith(2, "SUBSCRIBED")
    expect(warn).toHaveBeenCalledWith("orders-test realtime subscription status: TIMED_OUT")
    warn.mockRestore()
  })
})
