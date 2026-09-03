"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { nextAsyncLoadFlags } from "@/lib/async-refetch-flags"
import { getMyOrders, getOrderForTracking, type OrderForTracking } from "@/lib/supabase/orders-data"

export type { OrderForTracking }
export type OrderStatus = OrderForTracking["status"]

type OrdersContextValue = {
  myOrders: OrderForTracking[]
  isLoadingMyOrders: boolean
  /** True only when the list has never loaded successfully and its most
   * recent attempt failed -- nothing safe to show, distinct from a
   * genuinely empty "no orders yet" result. */
  myOrdersError: boolean
  /** True when the list HAS loaded successfully at least once but the most
   * recent Realtime-triggered refetch failed. `myOrders` still holds the
   * last-good rows -- never cleared on a refetch failure -- this only
   * flags them as possibly outdated. */
  myOrdersStale: boolean
  retryMyOrders: () => void
  getOrder: (orderId: string) => Promise<OrderForTracking | null>
}

const OrdersContext = createContext<OrdersContextValue | null>(null)

export function OrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [myOrders, setMyOrders] = useState<OrderForTracking[]>([])
  const [isLoadingMyOrders, setIsLoadingMyOrders] = useState(true)
  const [myOrdersError, setMyOrdersError] = useState(false)
  const [myOrdersStale, setMyOrdersStale] = useState(false)
  const hasLoadedMyOrdersOnceRef = useRef(false)

  const loadMyOrders = useCallback(async () => {
    try {
      const rows = await getMyOrders(supabase)
      setMyOrders(rows)
      hasLoadedMyOrdersOnceRef.current = true
      setMyOrdersError(false)
      setMyOrdersStale(false)
    } catch {
      // Order History is gated to logged-in customers already, so a
      // failure here is a real fetch error (network/RPC), not "no
      // session" -- must never be shown as a false "you have no orders"
      // empty state. First failure ever: nothing safe to show yet
      // (blocking). Failure after a prior success: keep showing the
      // last-good `myOrders` (untouched above) and just flag it stale.
      const flags = nextAsyncLoadFlags(hasLoadedMyOrdersOnceRef.current, "failure")
      setMyOrdersError(flags.hasBlockingError)
      setMyOrdersStale(flags.hasStaleData)
    }
  }, [supabase])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMyOrders().finally(() => setIsLoadingMyOrders(false))
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadMyOrders])

  const retryMyOrders = useCallback(() => {
    setIsLoadingMyOrders(true)
    void loadMyOrders().finally(() => setIsLoadingMyOrders(false))
  }, [loadMyOrders])

  // Realtime confirms *that* a row visible to this session changed;
  // re-fetching the small "my orders" list is simpler and cheap enough
  // than hand-merging a partial payload against joined table/menu_item
  // names this component doesn't have inline.
  useRealtimeChannel(supabase, "my-orders-changes", [
    {
      table: "orders",
      event: "*",
      onChange: () => {
        void loadMyOrders()
      },
    },
  ])

  async function getOrder(orderId: string): Promise<OrderForTracking | null> {
    return getOrderForTracking(supabase, orderId)
  }

  return (
    <OrdersContext.Provider
      value={{ myOrders, isLoadingMyOrders, myOrdersError, myOrdersStale, retryMyOrders, getOrder }}
    >
      {children}
    </OrdersContext.Provider>
  )
}

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext)
  if (!ctx) throw new Error("useOrders must be used within an OrdersProvider")
  return ctx
}
