"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import {
  getShiftReport,
  getShiftHistory,
  openShift as openShiftQuery,
  closeShift as closeShiftQuery,
  joinShift as joinShiftQuery,
  leaveShift as leaveShiftQuery,
  type ShiftReport,
  type ShiftHistoryEntry,
} from "@/lib/supabase/shift-data"

type ShiftContextValue = {
  report: ShiftReport | null
  isLoading: boolean
  isShiftOpen: boolean
  currentUserId: string | null
  isCurrentUserWorking: boolean
  refetch: () => void
  openShift: (startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) => Promise<void>
  closeShift: (countedCash: number, notes?: string) => Promise<ShiftReport>
  joinShift: () => Promise<void>
  leaveShift: () => Promise<void>
  getHistory: () => Promise<ShiftHistoryEntry[]>
  getReportDetail: (shiftId?: string) => Promise<ShiftReport | null>
}

const ShiftContext = createContext<ShiftContextValue | null>(null)

// Same burst shape as the dashboard (one placed/paid order = an `orders`
// event plus, on open/close/join, `shifts`/`shift_workers` events), and the
// live shift report is likewise a passive read-only screen.
const SHIFT_REFETCH_DELAY_MS = 500

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [report, setReport] = useState<ShiftReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null))
  }, [supabase])

  async function load({ isStale }: LoadContext) {
    const result = await getShiftReport(supabase)
    // Latest wins: a slower earlier report must not clobber a newer one.
    if (isStale()) return
    setReport(result)
  }

  const { trigger, run, invalidate } = useLatestRefetch(load, SHIFT_REFETCH_DELAY_MS)

  useEffect(() => {
    run().finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // Shift open/close/join/leave never touch `orders`, and a paid order
  // changes what the live report's totals show — all three tables need
  // their own subscription for the report to stay live for every staff
  // member watching, not just the one who took the action. Unfiltered by
  // convention; the burst coalescing lives in the refetch.
  useRealtimeChannel(supabase, "shift-report-changes", [
    { table: "orders", event: "*", onChange: () => trigger() },
    { table: "shifts", event: "*", onChange: () => trigger() },
    { table: "shift_workers", event: "*", onChange: () => trigger() },
  ])

  // Each mutation returns the authoritative post-mutation report, so it is
  // by definition newer than anything a refetch started earlier could
  // return -- invalidate() marks those in-flight refetches stale so they
  // can't roll the UI back to the pre-mutation state.
  function applyMutationResult(result: ShiftReport | null) {
    invalidate()
    setReport(result)
  }

  async function openShift(startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) {
    applyMutationResult(await openShiftQuery(supabase, startingCash, plannedStartAt, plannedEndAt))
  }

  async function closeShift(countedCash: number, notes?: string): Promise<ShiftReport> {
    const result = await closeShiftQuery(supabase, countedCash, notes)
    applyMutationResult(result)
    return result
  }

  async function joinShift() {
    applyMutationResult(await joinShiftQuery(supabase))
  }

  async function leaveShift() {
    applyMutationResult(await leaveShiftQuery(supabase))
  }

  function getHistory(): Promise<ShiftHistoryEntry[]> {
    return getShiftHistory(supabase)
  }

  function getReportDetail(shiftId?: string): Promise<ShiftReport | null> {
    return getShiftReport(supabase, shiftId)
  }

  const isCurrentUserWorking =
    currentUserId !== null &&
    (report?.workers.some((w) => w.staffId === currentUserId && w.leftAt === null) ?? false)

  return (
    <ShiftContext.Provider
      value={{
        report,
        isLoading,
        isShiftOpen: report !== null,
        currentUserId,
        isCurrentUserWorking,
        refetch: () => void run(),
        openShift,
        closeShift,
        joinShift,
        leaveShift,
        getHistory,
        getReportDetail,
      }}
    >
      {children}
    </ShiftContext.Provider>
  )
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error("useShift must be used within a ShiftProvider")
  return ctx
}
