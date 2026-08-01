import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type OrderType,
  type RealOrderType,
  type RealOrderStatus,
  type RealPaymentMethod,
  type OrderForTracking,
  type OrderRow,
  mapOrderRow,
  toRealOrderType,
  fromRealOrderType,
} from "./order-mapping"

export type OrderHistoryFilters = {
  dateFrom?: string
  dateTo?: string
  statuses?: RealOrderStatus[]
  orderType?: OrderType
  search?: string
}

export type OrderHistoryRow = {
  id: string
  createdAt: number
  orderType: OrderType
  table?: string
  customerName?: string
  paymentMethod: RealPaymentMethod | null
  status: RealOrderStatus
  total: number
}

export type OrderHistoryPage = { rows: OrderHistoryRow[]; totalCount: number }

type OrderHistoryRpcRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  table_number: string | null
  customer_name: string | null
  payment_method: RealPaymentMethod | null
  status: RealOrderStatus
  total: number
}

function mapOrderHistoryRow(row: OrderHistoryRpcRow): OrderHistoryRow {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    orderType: fromRealOrderType(row.order_type),
    table: row.table_number ?? undefined,
    customerName: row.customer_name ?? undefined,
    paymentMethod: row.payment_method,
    status: row.status,
    total: row.total,
  }
}

export async function getOrderHistory(
  supabase: SupabaseClient,
  filters: OrderHistoryFilters,
  page: { limit: number; offset: number }
): Promise<OrderHistoryPage> {
  const { data, error } = await supabase.rpc("get_order_history", {
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_statuses: filters.statuses ?? null,
    p_order_type: filters.orderType ? toRealOrderType(filters.orderType) : null,
    p_search: filters.search ?? null,
    p_limit: page.limit,
    p_offset: page.offset,
  })
  if (error) throw error
  const result = data as { rows: OrderHistoryRpcRow[]; totalCount: number }
  return { rows: result.rows.map(mapOrderHistoryRow), totalCount: result.totalCount }
}

export type OrderHistoryDetail = OrderForTracking & {
  paymentMethod: RealPaymentMethod | null
  paymentStatus: string
  customerName?: string
}

type OrderHistoryDetailRow = OrderRow & {
  payment_method: RealPaymentMethod | null
  payment_status: string
  profiles: { full_name: string } | null
}

const ORDER_HISTORY_DETAIL_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, tax_amount, total,
  payment_method, payment_status,
  tables ( table_number ),
  profiles ( full_name ),
  order_items ( quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`

export async function getOrderHistoryDetail(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderHistoryDetail | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_HISTORY_DETAIL_SELECT)
    .eq("id", orderId)
    .single()
  if (error) return null
  const row = data as unknown as OrderHistoryDetailRow
  return {
    ...mapOrderRow(row),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    customerName: row.profiles?.full_name ?? undefined,
  }
}
