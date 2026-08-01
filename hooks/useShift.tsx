"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
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

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [report, setReport] = useState<ShiftReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null))
  }, [supabase])

  function refetch() {
    getShiftReport(supabase)
      .then((result) => setReport(result))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    getShiftReport(supabase)
      .then((result) => {
        if (!cancelled) setReport(result)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [supabase])

  // Shift open/close/join/leave never touch `orders`, and a paid order
  // changes what the live report's totals show — all three tables need
  // their own subscription for the report to stay live for every staff
  // member watching, not just the one who took the action.
  useRealtimeChannel(supabase, "shift-report-changes", [
    { table: "orders", event: "*", onChange: () => refetch() },
    { table: "shifts", event: "*", onChange: () => refetch() },
    { table: "shift_workers", event: "*", onChange: () => refetch() },
  ])

  async function openShift(startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) {
    const result = await openShiftQuery(supabase, startingCash, plannedStartAt, plannedEndAt)
    setReport(result)
  }

  async function closeShift(countedCash: number, notes?: string): Promise<ShiftReport> {
    const result = await closeShiftQuery(supabase, countedCash, notes)
    setReport(result)
    return result
  }

  async function joinShift() {
    const result = await joinShiftQuery(supabase)
    setReport(result)
  }

  async function leaveShift() {
    const result = await leaveShiftQuery(supabase)
    setReport(result)
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
        refetch,
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
