"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
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

// The mockup's per-ticket "back" arrow (mis-tapped Mark Ready/Mark Served)
// -- safe to send straight through advanceOrderItemStatus with no new RPC:
// order_items.status has no forward-only constraint, and
// sync_order_status_from_items (migration 0082) recomputes the parent
// order's rolled-up status from its items' current statuses on every
// update, in either direction, so a regressed item correctly reopens its
// parent order too (e.g. "ready" -> "preparing" flips the order itself
// back to "preparing").
export const PREV_ITEM_STATUS: Record<OrderItemStatus, OrderItemStatus | null> = {
  preparing: null,
  ready: "preparing",
  served: "ready",
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

// Pure so it's directly testable: returns a new `orders` array with one
// item's status swapped. Used both to apply the optimistic guess the
// instant a staff member taps an item, and to roll that guess back if the
// RPC confirming it server-side turns out to have failed.
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

// Real bug this closes: KDS_REFETCH_DELAY_MS's debounce is capped at
// maxDelayMs (4x delayMs = 1200ms) so a continuous burst of taps -- the
// documented "normal interaction pattern" below -- still forces a refetch
// on a fixed cadence even while events keep arriving. If a tap's RPC is
// still in flight when that capped refetch's SELECT fires, the fetch can
// legitimately return a snapshot from *before* that write committed --
// Realtime/refetch and the optimistic update are two entirely separate
// paths with no coordination between them. Blindly overwriting `orders`
// with that snapshot reverts the still-pending tap's optimistic status
// back to what the server had a moment ago, indistinguishable from the tap
// never having registered; the next refetch (triggered once the RPC's own
// write actually lands) then shows the correct status with no new tap
// from the user, indistinguishable from the board "jumping on its own."
// Fix: for any item currently mid-flight (tracked in pendingItemKeys),
// keep showing its last-known-locally-applied status instead of trusting
// a fetch that may have raced ahead of that item's own commit -- every
// other item in the same snapshot is unaffected and applied as fetched.
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

// The debounced Realtime refetch (useLatestRefetch, KDS_REFETCH_DELAY_MS
// below) can take up to ~1.2s to confirm a tap on a busy board -- ticking
// several items in quick succession is the NORMAL interaction pattern, not
// an edge case, and each tick restarts that window. Without this, the
// tapped item shows literally no feedback until the debounce finally
// fires. So the item's local status is flipped immediately, ahead of the
// RPC that makes it real; the later coalesced refetch just reconciles
// (normally confirming what's already shown). If the RPC actually fails,
// the optimistic guess is rolled back and the caller's error handling
// still fires (`advance` rejecting propagates out of this function).
//
// Kept as a standalone function (state passed as explicit get/set) rather
// than inlined in `advanceItem` so the rollback path is unit-testable
// without a React render harness -- this project's Vitest setup has no
// DOM/render environment.
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

// Composite key -- orderId + itemId -- rather than the bare item id: item
// ids are order_items primary keys (globally unique in practice), but the
// key shouldn't quietly assume that forever, and pairing with orderId
// costs nothing.
export function itemPendingKey(orderId: string, itemId: string): string {
  return `${orderId}:${itemId}`
}

// Round-2 fix for the regression the optimistic update above introduced:
// without in-flight tracking, a staff member could tap the SAME item
// through two overlapping transitions (e.g. Mark Ready then, before RPC1
// resolves, Mark Served -- the optimistic update already flipped the
// button's label/action) before either RPC settled. If RPC1 later
// rejected, its unconditional rollback to the pre-RPC1 status could
// clobber RPC2's already-succeeded result, and a stray re-tap in that
// window could fire a real UPDATE that regresses the server's actual
// status. Structural fix: mark the item "pending" BEFORE the optimistic
// update even runs (so a UI reading the flag can disable the button
// before any flicker), clear it in `finally` regardless of outcome, and
// no-op a call that arrives while the item is already pending -- so two
// RPCs can never be in flight for the same item at once. The UI disabling
// the button is the primary defense; this is the structural backstop.
//
// Kept standalone (state passed as explicit get/set, like
// advanceItemOptimistically above) so it's unit-testable without a React
// render harness -- this project's Vitest setup has no DOM/render
// environment.
export async function advanceItemGuarded(
  pendingKeys: Set<string>,
  setPendingKeys: (updater: (current: Set<string>) => Set<string>) => void,
  orders: KdsOrderRow[],
  orderId: string,
  itemId: string,
  nextStatus: OrderItemStatus,
  setOrders: (updater: (current: KdsOrderRow[]) => KdsOrderRow[]) => void,
  advance: (itemId: string, newStatus: OrderItemStatus) => Promise<void>
): Promise<void> {
  const key = itemPendingKey(orderId, itemId)
  if (pendingKeys.has(key)) return
  setPendingKeys((current) => {
    const next = new Set(current)
    next.add(key)
    return next
  })
  try {
    await advanceItemOptimistically(orders, orderId, itemId, nextStatus, setOrders, advance)
  } finally {
    setPendingKeys((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }
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

// Placing a table round writes one `orders` row plus one `order_items` row
// per line, all inside a single transaction -- Realtime delivers those as N+1
// separate change events milliseconds apart, which used to mean N+1 full
// board refetches. 300ms is far longer than that burst and short enough that
// a single staff tick still feels immediate on the board.
const KDS_REFETCH_DELAY_MS = 300

export function KitchenOrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [orders, setOrders] = useState<KdsOrderRow[]>([])
  const [pendingPaymentOrders, setPendingPaymentOrders] = useState<KdsOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [completedDurations, setCompletedDurations] = useState<number[]>([])
  // Item ids currently mid-flight through advanceItem -- see
  // advanceItemGuarded above for why this exists.
  const [pendingItemKeys, setPendingItemKeys] = useState<Set<string>>(new Set())

  function isItemPending(orderId: string, itemId: string): boolean {
    return pendingItemKeys.has(itemPendingKey(orderId, itemId))
  }

  async function load({ isStale }: LoadContext) {
    const [active, pending] = await Promise.all([getKitchenOrders(supabase), getPendingPaymentOrders(supabase)])
    // A straggling older response must never overwrite a newer one that
    // already landed -- overlapping fetches don't resolve in call order.
    if (isStale()) return
    // mergeInFlightItems: don't let a refetch that raced ahead of a still-
    // in-flight tap revert that tap's optimistic status -- see its own
    // comment above for the exact race this closes.
    setOrders((current) => mergeInFlightItems(active, current, pendingItemKeys))
    setPendingPaymentOrders(pending)
  }

  const { trigger, run } = useLatestRefetch(load, KDS_REFETCH_DELAY_MS)

  useEffect(() => {
    run().finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // Staff sees every order (orders_select_staff has no per-row filtering
  // concerns), so a plain refetch on any change is both correct and
  // simple -- the board is small enough this is cheap. order_items is
  // also watched now: an item tick that doesn't flip the parent order's
  // own status (e.g. one of four drinks going ready) only ever shows up
  // as an order_items change, never an orders change. The subscription
  // stays deliberately unfiltered (this project's Realtime convention --
  // a server-side `filter` doesn't reliably combine with RLS-gated
  // Realtime); the coalescing lives in the refetch, not the subscription.
  useRealtimeChannel(
    supabase,
    "kitchen-orders-changes",
    [
      { table: "orders", event: "*", onChange: () => trigger() },
      { table: "order_items", event: "*", onChange: () => trigger() },
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
    // Belt-and-suspenders: the UI disables the tick button while
    // isItemPending is true, so this shouldn't normally be reachable --
    // but checking here too (ahead of the completedCount side effect)
    // keeps that side effect from firing on a call that's about to be a
    // structural no-op inside advanceItemGuarded.
    if (isItemPending(orderId, itemId)) return
    if (next === "served" && willCompleteOrderOnAdvance(order, itemId)) {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await advanceItemGuarded(pendingItemKeys, setPendingItemKeys, orders, orderId, itemId, next, setOrders, (id, status) =>
      advanceOrderItemStatus(supabase, id, status)
    )
  }

  async function regressItem(orderId: string, itemId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const item = order.items.find((i) => i.id === itemId)
    if (!item) return
    const prev = PREV_ITEM_STATUS[item.status]
    if (!prev) return
    if (isItemPending(orderId, itemId)) return
    await advanceItemGuarded(pendingItemKeys, setPendingItemKeys, orders, orderId, itemId, prev, setOrders, (id, status) =>
      advanceOrderItemStatus(supabase, id, status)
    )
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
        regressItem,
        isItemPending,
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
