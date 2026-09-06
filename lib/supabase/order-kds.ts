import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type OrderType,
  type RealOrderStatus,
  type RealOrderItemStatus,
  type RealPaymentMethod,
  type OrderRow,
  ORDER_SELECT,
  fromRealOrderType,
} from "./order-mapping"

export type OrderItemStatus = RealOrderItemStatus
export type KdsOrderItemRow = {
  id: string
  nameVi: string
  nameEn: string
  quantity: number
  note: string | null
  status: OrderItemStatus
  sizeName: string | null
  modifierNames: { nameVi: string; nameEn: string }[]
}
export type KdsOrderRow = {
  id: string
  orderType: OrderType
  table?: string
  tableId?: string
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: RealPaymentMethod | null
  createdAt: number
  items: KdsOrderItemRow[]
  total: number
}

function mapKdsRow(row: OrderRow): KdsOrderRow {
  return {
    id: row.id,
    orderType: fromRealOrderType(row.order_type),
    table: row.tables?.table_number,
    tableId: row.table_id ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    createdAt: new Date(row.created_at).getTime(),
    items: row.order_items.map((oi) => ({
      id: oi.id,
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      note: oi.note,
      status: oi.status,
      sizeName: oi.menu_item_sizes?.name ?? null,
      modifierNames: (oi.order_item_modifiers ?? []).map((modifier) => ({
        nameVi: modifier.modifiers.name_vi,
        nameEn: modifier.modifiers.name_en,
      })),
    })),
    total: row.total,
  }
}

export async function getKitchenOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("status", ["paid", "preparing", "ready", "served"])
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}

export async function getPendingPaymentOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("payment_method", "cash")
    .eq("payment_status", "pending")
    .or("status.eq.pending_payment,and(status.eq.served,order_type.eq.pickup)")
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}

// Advances a single item -- the KDS card's per-item tick control.
export async function advanceOrderItemStatus(
  supabase: SupabaseClient,
  itemId: string,
  newStatus: OrderItemStatus
): Promise<void> {
  const { error } = await supabase.from("order_items").update({ status: newStatus }).eq("id", itemId)
  if (error) throw error
}

// Bulk-marks every not-yet-served item across the given orders as
// served in one call -- backs the table's "Mark Served" bulk action.
// The 0082 roll-up trigger then flips each order to 'served' itself.
export async function markOrderItemsServed(supabase: SupabaseClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return
  const { error } = await supabase
    .from("order_items")
    .update({ status: "served" })
    .in("order_id", orderIds)
    .neq("status", "served")
  if (error) throw error
}

export async function confirmCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: "paid", payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

// A served pickup order's deferred payment can be confirmed as paid via
// whichever method the customer actually used, not just cash -- staff picks
// the method in the KDS UI and this records both in one write. Scoped to
// status='served' AND payment_status='pending' so a stale/duplicate tap
// can't overwrite an order a gateway webhook already settled independently.
export async function confirmServedPayment(
  supabase: SupabaseClient,
  orderId: string,
  method: RealPaymentMethod
): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ payment_method: method, payment_status: "paid" })
    .eq("id", orderId)
    .eq("status", "served")
    .eq("payment_status", "pending")
  if (error) throw error
}

// Confirms a table's whole unpaid balance as paid via whichever method the
// customer actually used -- replaces the old cash-only RPC and the separate
// "set method with no method chosen yet" step (markTableCashPayment): this
// covers both a round that never had a method chosen and one where the
// customer's own pick needs correcting, in one action.
export async function confirmTablePayment(
  supabase: SupabaseClient,
  tableId: string,
  method: RealPaymentMethod
): Promise<number> {
  const { data, error } = await supabase.rpc("confirm_table_payment", { p_table_id: tableId, p_method: method })
  if (error) throw error
  return data as number
}

// Undo a mistaken "Đã Giao Khách" tap. recall_last_completed_order (migration
// 0087) reverts the single most recent completed+paid pickup order (within a
// 15-minute window) back to "ready" -- never straight to "served", since that
// would just be immediately re-completed by complete_order_when_served_and_paid.
// Raises a distinct 'nothing_to_recall' message when there's no eligible order,
// which the caller surfaces as a specific hint rather than the generic
// updateError -- everything else (wrong role, window expired) collapses to
// the generic error like every other action in this file.
export const NOTHING_TO_RECALL_ERROR = "nothing_to_recall"

export async function recallLastCompletedOrder(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("recall_last_completed_order")
  if (error) throw error
}
