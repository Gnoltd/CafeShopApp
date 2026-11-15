"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import {
  createSupabaseKdsPreparationAdapter,
  type KdsOrderRow,
  type KdsPreparationPort,
  type OrderItemStatus,
} from "@/lib/supabase/order-kds"
import type { RealOrderStatus } from "@/lib/supabase/order-mapping"

// Derived from the real order_status enum (not hand-typed) so it can never
// silently drift from it -- was a second, independently-declared status
// vocabulary until this refactor.
export type KdsStatus = Extract<RealOrderStatus, "paid" | "preparing" | "ready">
export type { KdsOrderRow as KdsOrder }

// One tap per drink -- lands on "ready" (visually identical to "served":
// green, checked, struck through; KitchenBoard treats status !== "preparing"
// as done). Sending the tap straight to "served" meant the last item
// finishing on an already-paid order satisfied complete_order_when_served_and_paid
// immediately, skipping the "Ready" column and recall. "served" is reached
// only through the ticket-level "Đã Giao Khách" bulk hand-over once ready.
const NEXT_ITEM_STATUS: Record<OrderItemStatus, OrderItemStatus | null> = {
  preparing: "ready",
  ready: "served",
  served: null,
}

// Per-ticket "back" arrow (mis-tapped done): order_items.status has no
// forward-only constraint, and sync_order_status_from_items (migration 0082)
// recomputes the parent order's rolled-up status on every update in either
// direction, so a regressed item correctly reopens its parent order too.
export const PREV_ITEM_STATUS: Record<OrderItemStatus, OrderItemStatus | null> = {
  preparing: null,
  ready: "preparing",
  served: "ready",
}

/**
 * Returns whether advancing `itemId` to `"served"` leaves every item in `order` served.
 */
export function willCompleteOrderOnAdvance(order: KdsOrderRow, itemId: string): boolean {
  return order.items.every((item) => item.id === itemId || item.status === "served")
}

/**
 * Returns a new `orders` array with one item's status replaced.
 */
export function withItemStatus(
  orders: KdsOrderRow[],
  orderId: string,
  itemId: string,
  status: OrderItemStatus
): KdsOrderRow[] {
  return orders.map((order) =>
    order.id !== orderId
      ? order
      : { ...order, items: order.items.map((item) => (item.id === itemId ? { ...item, status } : item)) }
  )
}

/**
 * Preserves local optimistic statuses for any items currently mid-flight in
 * `pendingKeys` when a background refetch lands before those writes commit.
 */
export function mergeInFlightItems(
  fresh: KdsOrderRow[],
  previous: KdsOrderRow[],
  pendingKeys: Set<string>
): KdsOrderRow[] {
  if (pendingKeys.size === 0) return fresh
  return fresh.map((order) => {
    const previousOrder = previous.find((o) => o.id === order.id)
    if (!previousOrder) return order
    let changed = false
    const items = order.items.map((item) => {
      if (!pendingKeys.has(itemPendingKey(order.id, item.id))) return item
      const previousItem = previousOrder.items.find((i) => i.id === item.id)
      if (!previousItem || previousItem.status === item.status) return item
      changed = true
      return { ...item, status: previousItem.status }
    })
    return changed ? { ...order, items } : order
  })
}

/**
 * Applies an item status optimistically and rolls back to the prior status if `advance` rejects.
 */
export async function advanceItemOptimistically(
  orders: KdsOrderRow[],
  orderId: string,
  itemId: string,
  nextStatus: OrderItemStatus,
  setOrders: (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => void,
  advance: (itemId: string, newStatus: OrderItemStatus) => Promise<void>
): Promise<void> {
  const previousStatus = orders.find((o) => o.id === orderId)?.items.find((i) => i.id === itemId)?.status
  setOrders((current) => withItemStatus(current, orderId, itemId, nextStatus))
  try {
    await advance(itemId, nextStatus)
  } catch (err) {
    if (previousStatus) {
      setOrders((current) => withItemStatus(current, orderId, itemId, previousStatus))
    }
    throw err
  }
}

export function itemPendingKey(orderId: string, itemId: string): string {
  return `${orderId}:${itemId}`
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
  regressItem: (orderId: string, itemId: string) => Promise<void>
  isItemPending: (orderId: string, itemId: string) => boolean
  handOverOrder: (orderId: string) => Promise<void>
  recallLastOrder: () => Promise<void>
  refetch: () => Promise<void>
  completedCount: number
  avgTimeLabel: string
}

const KitchenOrdersContext = createContext<KitchenOrdersContextValue | null>(null)

// Placing a table round writes one `orders` row plus one `order_items` row
// per line in one transaction -- Realtime delivers N+1 change events ms apart.
const KDS_REFETCH_DELAY_MS = 300

function KdsRealtimeBridge({
  supabase,
  onChange,
  onConnectionChange,
}: {
  supabase: SupabaseClient
  onChange: () => void
  onConnectionChange: (connected: boolean) => void
}) {
  // Unfiltered subscriptions: server-side filters don't reliably combine with
  // RLS-gated Realtime; coalescing lives in useLatestRefetch.
  useRealtimeChannel(
    supabase,
    "kitchen-orders-changes",
    [
      { table: "orders", event: "*", onChange },
      { table: "order_items", event: "*", onChange },
    ],
    { onStatusChange: (status) => onConnectionChange(status === "SUBSCRIBED") }
  )
  return null
}

/**
 * Provides live KDS ticket state, per-item optimistic progression, hand-over,
 * and last-order recall for staff operations views.
 */
export function KitchenOrdersProvider({
  children,
  port,
}: {
  children: ReactNode
  port?: KdsPreparationPort
}) {
  const [defaultSupabase] = useState<SupabaseClient | null>(() => (port ? null : createClient()))
  const [defaultPort] = useState<KdsPreparationPort>(() =>
    port ?? createSupabaseKdsPreparationAdapter(defaultSupabase!)
  )
  const activePort = port ?? defaultPort

  const [orders, setOrders] = useState<KdsOrderRow[]>([])
  const ordersRef = useRef<KdsOrderRow[]>([])
  const [pendingPaymentOrders, setPendingPaymentOrders] = useState<KdsOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [completedDurations, setCompletedDurations] = useState<number[]>([])
  const [pendingItemKeys, setPendingItemKeys] = useState<Set<string>>(() => new Set())
  // Synchronized ref so async load() completions always see the live set of
  // in-flight item keys instead of a stale render-time closure snapshot.
  const pendingItemKeysRef = useRef<Set<string>>(new Set())

  const applyOrdersUpdate = useCallback((updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => {
    const next = updater(ordersRef.current)
    ordersRef.current = next
    setOrders(next)
  }, [])

  const isItemPending = useCallback(
    (orderId: string, itemId: string): boolean => pendingItemKeys.has(itemPendingKey(orderId, itemId)),
    [pendingItemKeys]
  )

  async function load({ isStale }: LoadContext) {
    const [active, pending] = await Promise.all([
      activePort.getKitchenOrders(),
      activePort.getPendingPaymentOrders(),
    ])
    if (isStale()) return
    applyOrdersUpdate((current) => mergeInFlightItems(active, current, pendingItemKeysRef.current))
    setPendingPaymentOrders(pending)
  }

  const refetch = useLatestRefetch(load, KDS_REFETCH_DELAY_MS)

  useEffect(() => {
    let active = true
    refetch.run().finally(() => {
      if (active) setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [activePort, refetch])

  useEffect(() => {
    if (!activePort.subscribe) return
    return activePort.subscribe({
      onChange: refetch.trigger,
      onConnectionChange: setIsRealtimeConnected,
    })
  }, [activePort, refetch])

  const recordCompletedOrder = useCallback((createdAt: number) => {
    setCompletedCount((count) => count + 1)
    setCompletedDurations((durations) => [...durations, Date.now() - createdAt])
  }, [])

  const transitionItem = useCallback(
    async (
      orderId: string,
      itemId: string,
      nextStatus: OrderItemStatus,
      onCompleted?: () => void
    ) => {
      const key = itemPendingKey(orderId, itemId)
      if (pendingItemKeysRef.current.has(key)) return

      const added = new Set(pendingItemKeysRef.current)
      added.add(key)
      pendingItemKeysRef.current = added
      setPendingItemKeys(added)

      try {
        await advanceItemOptimistically(
          ordersRef.current,
          orderId,
          itemId,
          nextStatus,
          applyOrdersUpdate,
          (id, status) => activePort.updateItemStatus(id, status)
        )
        onCompleted?.()
      } finally {
        const removed = new Set(pendingItemKeysRef.current)
        removed.delete(key)
        pendingItemKeysRef.current = removed
        setPendingItemKeys(removed)
      }
    },
    [activePort, applyOrdersUpdate]
  )

  const advanceItem = useCallback(
    async (orderId: string, itemId: string) => {
      const order = ordersRef.current.find((o) => o.id === orderId)
      if (!order) return
      const item = order.items.find((i) => i.id === itemId)
      if (!item) return
      const next = NEXT_ITEM_STATUS[item.status]
      if (!next) return

      await transitionItem(orderId, itemId, next, () => {
        if (next === "served" && willCompleteOrderOnAdvance(order, itemId)) {
          recordCompletedOrder(order.createdAt)
        }
      })
    },
    [recordCompletedOrder, transitionItem]
  )

  const regressItem = useCallback(
    async (orderId: string, itemId: string) => {
      const order = ordersRef.current.find((o) => o.id === orderId)
      if (!order) return
      const item = order.items.find((i) => i.id === itemId)
      if (!item) return
      const prev = PREV_ITEM_STATUS[item.status]
      if (!prev) return

      await transitionItem(orderId, itemId, prev)
    },
    [transitionItem]
  )

  const handOverOrder = useCallback(
    async (orderId: string) => {
      const order = ordersRef.current.find((o) => o.id === orderId && o.status === "ready")
      if (!order) return
      await activePort.markOrdersServed([order.id])
      if (order.paymentStatus === "paid") {
        recordCompletedOrder(order.createdAt)
      }
      await refetch.run()
    },
    [activePort, recordCompletedOrder, refetch]
  )

  const recallLastOrder = useCallback(async () => {
    await activePort.recallLastCompletedOrder()
    setCompletedCount((count) => Math.max(0, count - 1))
    setCompletedDurations((durations) => durations.slice(0, -1))
    await refetch.run()
  }, [activePort, refetch])

  const avgTimeLabel =
    completedDurations.length === 0
      ? "--:--"
      : formatDuration(completedDurations.reduce((sum, d) => sum + d, 0) / completedDurations.length)

  const value = useMemo<KitchenOrdersContextValue>(
    () => ({
      orders,
      pendingPaymentOrders,
      isLoading,
      isRealtimeConnected,
      advanceItem,
      regressItem,
      isItemPending,
      handOverOrder,
      recallLastOrder,
      refetch: refetch.run,
      completedCount,
      avgTimeLabel,
    }),
    [
      orders,
      pendingPaymentOrders,
      isLoading,
      isRealtimeConnected,
      advanceItem,
      regressItem,
      isItemPending,
      handOverOrder,
      recallLastOrder,
      refetch.run,
      completedCount,
      avgTimeLabel,
    ]
  )

  return (
    <KitchenOrdersContext.Provider value={value}>
      {defaultSupabase && (
        <KdsRealtimeBridge
          supabase={defaultSupabase}
          onChange={refetch.trigger}
          onConnectionChange={setIsRealtimeConnected}
        />
      )}
      {children}
    </KitchenOrdersContext.Provider>
  )
}

export function useKitchenOrders(): KitchenOrdersContextValue {
  const ctx = useContext(KitchenOrdersContext)
  if (!ctx) throw new Error("useKitchenOrders must be used within a KitchenOrdersProvider")
  return ctx
}

export function useOptionalKitchenOrdersRefetch(): (() => Promise<void>) | undefined {
  return useContext(KitchenOrdersContext)?.refetch
}
