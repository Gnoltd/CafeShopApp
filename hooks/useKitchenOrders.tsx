"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  advanceOrderItemStatus,
  markOrderItemsServed,
  confirmCashPayment as confirmCashPaymentQuery,
  confirmServedCashPayment as confirmServedCashPaymentQuery,
  confirmTableCashPayment as confirmTableCashPaymentQuery,
  markTableCashPayment as markTableCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type OrderItemStatus,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"

// Derived from the real order_status enum (not hand-typed) so it can never
// silently drift from it -- was a second, independently-declared status
// vocabulary until this refactor.
export type KdsStatus = Extract<RealOrderStatus, "paid" | "preparing" | "ready">
export type { KdsOrderRow as KdsOrder }

const NEXT_ITEM_STATUS: Record<OrderItemStatus, OrderItemStatus | null> = {
  preparing: "ready",
  ready: "served",
  served: null,
}

// Pure so it's directly testable: given the order this item belongs to,
// would advancing this one item to "served" leave every item in the
// order served? Order completion (and the completedCount/avgTimeLabel
// stats below) is a derived side effect of the *last* item being
// ticked -- it can happen from either a single advanceItem call or a
// table-wide serveTable bulk call, so both consult this.
export function willCompleteOrderOnAdvance(order: KdsOrderRow, itemId: string): boolean {
  return order.items.every((item) => item.id === itemId || item.status === "served")
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
  advanceItem: (orderId: string, itemId: string) => Promise<void>
  serveTable: (orderIds: string[]) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
  confirmTableCashPayment: (tableId: string) => Promise<void>
  markTableCashPayment: (tableId: string) => Promise<void>
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
  // simple -- the board is small enough this is cheap. order_items is
  // also watched now: an item tick that doesn't flip the parent order's
  // own status (e.g. one of four drinks going ready) only ever shows up
  // as an order_items change, never an orders change.
  useRealtimeChannel(
    supabase,
    "kitchen-orders-changes",
    [
      { table: "orders", event: "*", onChange: () => refetch() },
      { table: "order_items", event: "*", onChange: () => refetch() },
    ],
    { onStatusChange: (status) => setIsRealtimeConnected(status === "SUBSCRIBED") }
  )

  async function advanceItem(orderId: string, itemId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const item = order.items.find((i) => i.id === itemId)
    if (!item) return
    const next = NEXT_ITEM_STATUS[item.status]
    if (!next) return
    if (next === "served" && willCompleteOrderOnAdvance(order, itemId)) {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await advanceOrderItemStatus(supabase, itemId, next)
  }

  async function serveTable(orderIds: string[]) {
    const ordersToServe = orders.filter((o) => orderIds.includes(o.id) && o.status === "ready")
    for (const order of ordersToServe) {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await markOrderItemsServed(
      supabase,
      ordersToServe.map((o) => o.id)
    )
  }

  async function confirmCashPayment(orderId: string) {
    const order = orders.find((o) => o.id === orderId) ?? pendingPaymentOrders.find((o) => o.id === orderId)
    if (order?.status === "served") {
      await confirmServedCashPaymentQuery(supabase, orderId)
    } else {
      await confirmCashPaymentQuery(supabase, orderId)
    }
  }

  async function confirmTableCashPayment(tableId: string) {
    await confirmTableCashPaymentQuery(supabase, tableId)
  }

  async function markTableCashPayment(tableId: string) {
    await markTableCashPaymentQuery(supabase, tableId)
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
        advanceItem,
        serveTable,
        confirmCashPayment,
        confirmTableCashPayment,
        markTableCashPayment,
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
