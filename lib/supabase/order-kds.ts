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

export async function confirmServedCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

export async function confirmTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<number> {
  const { data, error } = await supabase.rpc("confirm_table_cash_payment", { p_table_id: tableId })
  if (error) throw error
  return data as number
}

// I-3: a table round placed via the shared-table-ordering flow starts
// with payment_method null and only gets one once someone taps Check
// Bill. If guests never tap it, staff had no way to settle the table
// from KDS at all. Plain multi-row update, not an RPC -- verified live
// that orders_update_staff RLS already allows staff/manager/admin to
// UPDATE orders directly, matching the existing single-order
// setOrderPaymentMethodCash (order-tracking.ts) which does exactly
// this pattern for one order.
export async function markTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ payment_method: "cash" })
    .eq("table_id", tableId)
    .eq("payment_status", "pending")
    .is("payment_method", null)
  if (error) throw error
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
