"use client"

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import { nextAsyncLoadFlags } from "@/lib/async-refetch-flags"
import { getDashboardStats, type DashboardStats } from "@/lib/supabase/dashboard-data"

export type { DashboardStats }

const EMPTY_STATS: DashboardStats = {
  todayRevenue: 0,
  ordersToday: 0,
  loyaltyIssuedToday: 0,
  sevenDayRevenue: [],
  bestSellers: [],
}

// One placed order fans out into an `orders` row, N `order_items` rows and
// (once paid) a `loyalty_transactions` row -- every one of which used to
// re-run the whole `get_dashboard_stats` aggregate separately. The dashboard
// is a passive read-only screen, so a longer window than KDS's is free.
const DASHBOARD_REFETCH_DELAY_MS = 500

export function useDashboardStats(): {
  stats: DashboardStats
  isLoading: boolean
  /** True only when stats have never loaded successfully -- distinct from a
   * genuine "$0 / 0 orders today" result, which is a legitimate value this
   * hook must never fabricate by silently leaving EMPTY_STATS in place
   * after a failed fetch. */
  hasLoadError: boolean
  /** True once stats have loaded at least once but the latest background
   * refetch (Realtime-triggered) failed -- `stats` still holds the last-good
   * aggregate. */
  hasStaleData: boolean
  retry: () => void
} {
  const [supabase] = useState(() => createClient())
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [hasStaleData, setHasStaleData] = useState(false)
  const hasLoadedOnceRef = useRef(false)

  async function load({ isStale }: LoadContext) {
    try {
      const result = await getDashboardStats(supabase)
      // Latest wins: an older aggregate resolving late must not replace a
      // newer one that already rendered.
      if (isStale()) return
      setStats(result)
      hasLoadedOnceRef.current = true
      setHasLoadError(false)
      setHasStaleData(false)
    } catch (error) {
      if (isStale()) return
      const flags = nextAsyncLoadFlags(hasLoadedOnceRef.current, "failure")
      setHasLoadError(flags.hasBlockingError)
      setHasStaleData(flags.hasStaleData)
      throw error
    }
  }

  const { trigger, run } = useLatestRefetch(load, DASHBOARD_REFETCH_DELAY_MS)

  useEffect(() => {
    run().finally(() => setIsLoading(false))
    // Runs once on mount; `supabase` is a stable client held in state and
    // `run` is a stable runner handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = () => {
    setIsLoading(true)
    void run().finally(() => setIsLoading(false))
  }

  // Unfiltered subscribe + refetch, per this project's Realtime convention.
  useRealtimeChannel(supabase, "dashboard-stats-changes", [
    { table: "orders", event: "*", onChange: () => trigger() },
    { table: "order_items", event: "*", onChange: () => trigger() },
    { table: "loyalty_transactions", event: "*", onChange: () => trigger() },
  ])

  return { stats, isLoading, hasLoadError, hasStaleData, retry }
}
