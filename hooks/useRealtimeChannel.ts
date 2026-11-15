import { useEffect, useRef } from "react"
import type { RealtimePostgresChangesPayload, REALTIME_SUBSCRIBE_STATES, SupabaseClient } from "@supabase/supabase-js"

type ChangeEvent = "*" | "INSERT" | "UPDATE" | "DELETE"

// Each subscription's row shape is only known to its own onChange body
// (which already casts payload.new/payload.old to its real row type, same
// as before this hook existed) — kept untyped-by-row here so a single
// array can mix subscriptions across different tables.
export type RealtimeSubscription = {
  table: string
  event: ChangeEvent
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
}

const EMPTY_DEPS: unknown[] = []

type SubConfig = { table: string; event: ChangeEvent }

function depsEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

function subConfigsEqual(a: SubConfig[], b: RealtimeSubscription[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].table !== b[i].table || a[i].event !== b[i].event) return false
  }
  return true
}

/**
 * Owns the channel create/subscribe/cleanup lifecycle shared by every
 * Realtime-backed hook in this app. Keeps `subscriptions` and `onStatusChange`
 * in commit-updated refs so callers can pass inline handlers without tearing
 * down the channel on re-render or closing over stale state.
 */
export function useRealtimeChannel(
  supabase: SupabaseClient,
  channelName: string,
  subscriptions: RealtimeSubscription[],
  options?: {
    onStatusChange?: (status: REALTIME_SUBSCRIBE_STATES) => void
    deps?: unknown[]
  }
): void {
  const { onStatusChange, deps = EMPTY_DEPS } = options ?? {}

  const subsRef = useRef(subscriptions)
  const onStatusRef = useRef(onStatusChange)
  const activeRef = useRef<{
    supabase: SupabaseClient
    channelName: string
    subConfigs: SubConfig[]
    deps: unknown[]
    cleanup: () => void
  } | null>(null)

  // Commit-time sync keeps latest closures installed without tearing down the
  // channel, and only resubscribes when connection config, filters, or `deps` change.
  useEffect(() => {
    subsRef.current = subscriptions
    onStatusRef.current = onStatusChange

    const current = activeRef.current
    if (
      current &&
      Object.is(current.supabase, supabase) &&
      current.channelName === channelName &&
      subConfigsEqual(current.subConfigs, subscriptions) &&
      depsEqual(current.deps, deps)
    ) {
      return
    }

    current?.cleanup()

    let cancelled = false
    let channel = supabase.channel(channelName)
    subsRef.current.forEach((sub, index) => {
      channel = channel.on(
        "postgres_changes",
        { event: sub.event, schema: "public", table: sub.table },
        (payload) => {
          if (!cancelled) subsRef.current[index]?.onChange(payload)
        }
      )
    })
    channel.subscribe((status) => {
      if (cancelled) return
      onStatusRef.current?.(status)
      if (status !== "SUBSCRIBED" && status !== "CLOSED") {
        console.warn(`${channelName} realtime subscription status: ${status}`)
      }
    })

    activeRef.current = {
      supabase,
      channelName,
      subConfigs: subscriptions.map(({ table, event }) => ({ table, event })),
      deps: deps.slice(),
      cleanup: () => {
        cancelled = true
        supabase.removeChannel(channel)
      },
    }
  })

  useEffect(() => {
    return () => {
      activeRef.current?.cleanup()
      activeRef.current = null
    }
  }, [])
}
