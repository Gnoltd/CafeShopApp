"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  advanceOrderStatus,
  confirmOrderPayment,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"

export type KdsStatus = "paid" | "preparing" | "ready"
export type { KdsOrderRow as KdsOrder }

export const NEXT_STATUS: Record<KdsStatus, RealOrderStatus | null> = {
  paid: "preparing",
  preparing: "ready",
  ready: "served",
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

type KitchenOrdersContextValue = {
  orders: KdsOrderRow[]
  pendingPaymentOrders: KdsOrderRow[]
  isLoading: boolean
  isRealtimeConnected: boolean
  advance: (orderId: string) => Promise<void>
  serveTable: (orderIds: string[]) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
  markCashPayment: (orderId: string) => Promise<void>
  undoCashPayment: (orderId: string) => Promise<void>
  completedCount: number
  avgTimeLabel: string
}

const KitchenOrdersContext = createContext<KitchenOrdersContextValue | null>(null)

export function KitchenOrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [orders, setOrders] = useState<KdsOrderRow[]>([])
  const [pendingPaymentOrders, setPendingPaymentOrders] = useState<KdsOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [completedDurations, setCompletedDurations] = useState<number[]>([])

  async function refetch() {
    const [active, pending] = await Promise.all([getKitchenOrders(supabase), getPendingPaymentOrders(supabase)])
    setOrders(active)
    setPendingPaymentOrders(pending)
  }

  useEffect(() => {
    let cancelled = false

    refetch().finally(() => {
      if (!cancelled) setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // Staff sees every order (orders_select_staff has no per-row filtering
  // concerns), so a plain refetch on any change is both correct and
  // simple — the board is small enough this is cheap.
  useRealtimeChannel(
    supabase,
    "kitchen-orders-changes",
    [{ table: "orders", event: "*", onChange: () => refetch() }],
    { onStatusChange: (status) => setIsRealtimeConnected(status === "SUBSCRIBED") }
  )

  async function advance(orderId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const next = NEXT_STATUS[order.status as KdsStatus]
    if (!next) return
    if (order.status === "ready") {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await advanceOrderStatus(supabase, orderId, next)
  }

  async function serveTable(orderIds: string[]) {
    for (const orderId of orderIds) {
      const order = orders.find((o) => o.id === orderId)
      if (!order || order.status !== "ready") continue
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
      await advanceOrderStatus(supabase, orderId, "served")
    }
  }

  async function confirmCashPayment(orderId: string) {
    await confirmOrderPayment(supabase, orderId)
  }

  async function markCashPayment(orderId: string) {
    await setOrderPaymentMethodCash(supabase, orderId)
  }

  async function undoCashPayment(orderId: string) {
    await changeOrderPaymentMethod(supabase, orderId, null)
  }

  const avgTimeLabel =
    completedDurations.length === 0
      ? "--:--"
      : formatDuration(completedDurations.reduce((sum, d) => sum + d, 0) / completedDurations.length)

  return (
    <KitchenOrdersContext.Provider
      value={{
        orders,
        pendingPaymentOrders,
        isLoading,
        isRealtimeConnected,
        advance,
        serveTable,
        confirmCashPayment,
        markCashPayment,
        undoCashPayment,
        completedCount,
        avgTimeLabel,
      }}
    >
      {children}
    </KitchenOrdersContext.Provider>
  )
}

export function useKitchenOrders(): KitchenOrdersContextValue {
  const ctx = useContext(KitchenOrdersContext)
  if (!ctx) throw new Error("useKitchenOrders must be used within a KitchenOrdersProvider")
  return ctx
}
