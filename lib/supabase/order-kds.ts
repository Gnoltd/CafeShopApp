import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type OrderType,
  type RealOrderStatus,
  type RealPaymentMethod,
  type OrderRow,
  ORDER_SELECT,
  fromRealOrderType,
} from "./order-mapping"

export type KdsOrderItemRow = { nameVi: string; nameEn: string; quantity: number; note: string | null }
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
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      note: oi.note,
    })),
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

export async function advanceOrderStatus(
  supabase: SupabaseClient,
  orderId: string,
  newStatus: RealOrderStatus
): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId)
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
