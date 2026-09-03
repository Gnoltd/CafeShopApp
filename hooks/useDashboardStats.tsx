"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
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

export function useDashboardStats(): { stats: DashboardStats; isLoading: boolean } {
  const [supabase] = useState(() => createClient())
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [isLoading, setIsLoading] = useState(true)

  async function load({ isStale }: LoadContext) {
    const result = await getDashboardStats(supabase)
    // Latest wins: an older aggregate resolving late must not replace a
    // newer one that already rendered.
    if (isStale()) return
    setStats(result)
  }

  const { trigger, run } = useLatestRefetch(load, DASHBOARD_REFETCH_DELAY_MS)

  useEffect(() => {
    run().finally(() => setIsLoading(false))
    // Runs once on mount; `supabase` is a stable client held in state and
    // `run` is a stable runner handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unfiltered subscribe + refetch, per this project's Realtime convention.
  useRealtimeChannel(supabase, "dashboard-stats-changes", [
    { table: "orders", event: "*", onChange: () => trigger() },
    { table: "order_items", event: "*", onChange: () => trigger() },
    { table: "loyalty_transactions", event: "*", onChange: () => trigger() },
  ])

  return { stats, isLoading }
}
