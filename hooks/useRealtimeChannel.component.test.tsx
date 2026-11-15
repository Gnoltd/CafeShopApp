import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { REALTIME_SUBSCRIBE_STATES, type RealtimePostgresChangesPayload, type SupabaseClient } from "@supabase/supabase-js"
import { useRealtimeChannel } from "./useRealtimeChannel"

type Handler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void

function createMockSupabase() {
  const channels: {
    name: string
    handlers: Array<{ table: string; event: string; callback: Handler }>
    reportStatus: (status: REALTIME_SUBSCRIBE_STATES) => void
  }[] = []

  const supabase = {
    channel: vi.fn((name: string) => {
      const entry = {
        name,
        handlers: [] as Array<{ table: string; event: string; callback: Handler }>,
        reportStatus: (() => {}) as (status: REALTIME_SUBSCRIBE_STATES) => void,
      }
      channels.push(entry)
      const channel = {
        on: vi.fn((_type: string, filter: { table: string; event: string }, callback: Handler) => {
          entry.handlers.push({ table: filter.table, event: filter.event, callback })
          return channel
        }),
        subscribe: vi.fn((callback: typeof entry.reportStatus) => {
          entry.reportStatus = callback
          return channel
        }),
      }
      return channel
    }),
    removeChannel: vi.fn(),
  } as unknown as SupabaseClient

  return { supabase, channels }
}

describe("useRealtimeChannel", () => {
  it("reports a disconnect and a later successful resubscription", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { supabase, channels } = createMockSupabase()
    const onStatusChange = vi.fn()

    renderHook(() =>
      useRealtimeChannel(
        supabase,
        "orders-test",
        [{ table: "orders", event: "*", onChange: vi.fn() }],
        { onStatusChange }
      )
    )

    act(() => channels[0].reportStatus(REALTIME_SUBSCRIBE_STATES.TIMED_OUT))
    act(() => channels[0].reportStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED))

    expect(onStatusChange).toHaveBeenNthCalledWith(1, "TIMED_OUT")
    expect(onStatusChange).toHaveBeenNthCalledWith(2, "SUBSCRIBED")
    expect(warn).toHaveBeenCalledWith("orders-test realtime subscription status: TIMED_OUT")
    warn.mockRestore()
  })

  it("invokes the latest onChange and onStatusChange closures on re-render without re-subscribing", () => {
    const { supabase, channels } = createMockSupabase()
    const seenEvents: string[] = []
    const seenStatuses: string[] = []

    const { rerender } = renderHook(
      ({ version }: { version: string }) =>
        useRealtimeChannel(
          supabase,
          "orders-test",
          [{ table: "orders", event: "*", onChange: () => seenEvents.push(version) }],
          { onStatusChange: (status) => seenStatuses.push(`${version}:${status}`) }
        ),
      { initialProps: { version: "v1" } }
    )

    expect(supabase.channel).toHaveBeenCalledTimes(1)
    expect(supabase.removeChannel).not.toHaveBeenCalled()

    rerender({ version: "v2" })
    rerender({ version: "v3" })

    // Inline arrays/handlers on re-render must not tear down or recreate the channel.
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    expect(supabase.removeChannel).not.toHaveBeenCalled()

    act(() => {
      channels[0].handlers[0].callback({} as RealtimePostgresChangesPayload<Record<string, unknown>>)
      channels[0].reportStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    })

    expect(seenEvents).toEqual(["v3"])
    expect(seenStatuses).toEqual(["v3:SUBSCRIBED"])
  })

  it("resubscribes when channelName or options.deps change and ignores late events on the closed channel", () => {
    const { supabase, channels } = createMockSupabase()
    const events: string[] = []

    const { rerender, unmount } = renderHook(
      ({ channelName, dep }: { channelName: string; dep: string }) =>
        useRealtimeChannel(
          supabase,
          channelName,
          [{ table: "orders", event: "*", onChange: () => events.push(`${channelName}:${dep}`) }],
          { deps: [dep] }
        ),
      { initialProps: { channelName: "ch-a", dep: "d1" } }
    )

    expect(channels).toHaveLength(1)

    // Changing dep recreates the channel.
    rerender({ channelName: "ch-a", dep: "d2" })
    expect(channels).toHaveLength(2)
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)

    // Late callbacks on channel 0 are ignored after cleanup.
    act(() => {
      channels[0].handlers[0].callback({} as RealtimePostgresChangesPayload<Record<string, unknown>>)
      channels[1].handlers[0].callback({} as RealtimePostgresChangesPayload<Record<string, unknown>>)
    })
    expect(events).toEqual(["ch-a:d2"])

    // Changing channelName recreates the channel.
    rerender({ channelName: "ch-b", dep: "d2" })
    expect(channels).toHaveLength(3)
    expect(supabase.removeChannel).toHaveBeenCalledTimes(2)

    unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(3)

    act(() => {
      channels[2].handlers[0].callback({} as RealtimePostgresChangesPayload<Record<string, unknown>>)
    })
    expect(events).toEqual(["ch-a:d2"])
  })
})
