import type { SupabaseClient } from "@supabase/supabase-js"

export type RealOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "served" | "completed" | "cancelled"
export type RealOrderType = "pickup" | "dine_in"
export type OrderType = "pickup" | "dine-in"
export type RealPaymentMethod = "stripe" | "cash" | "vnpay"

export type OrderForTrackingItem = { menuItemId: string; nameVi: string; nameEn: string; quantity: number; unitPrice: number; note?: string }

export type OrderForTracking = {
  id: string
  createdAt: number
  orderType: OrderType
  table?: string
  items: OrderForTrackingItem[]
  subtotal: number
  discount: number
  taxAmount: number
  total: number
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: RealPaymentMethod | null
}

export type PlaceOrderItemInput = {
  menuItemId: string
  sizeId?: string | null
  modifierIds: string[]
  quantity: number
  note?: string | null
}

export type PlaceOrderInput = {
  orderType: OrderType
  tableId?: string | null
  pickupTime?: string | null
  paymentMethod: "cash"
  promoCode?: string | null
  redeemLoyaltyPoints?: number
  paymentCollected?: boolean
  items: PlaceOrderItemInput[]
}

function toRealOrderType(orderType: OrderType): RealOrderType {
  return orderType === "dine-in" ? "dine_in" : "pickup"
}

function fromRealOrderType(orderType: RealOrderType): OrderType {
  return orderType === "dine_in" ? "dine-in" : "pickup"
}

type TrackingJsonItem = { menuItemId: string; nameVi: string; nameEn: string; quantity: number; unitPrice: number; note: string | null }

type TrackingJson = {
  id: string
  createdAt: number
  orderType: RealOrderType
  table: string | null
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: RealPaymentMethod | null
  subtotal: number
  discount: number
  taxAmount: number
  total: number
  items: TrackingJsonItem[]
}

function mapTrackingJson(json: TrackingJson): OrderForTracking {
  return {
    id: json.id,
    createdAt: json.createdAt,
    orderType: fromRealOrderType(json.orderType),
    table: json.table ?? undefined,
    items: json.items.map((item) => ({ ...item, note: item.note ?? undefined })),
    subtotal: json.subtotal,
    discount: json.discount,
    taxAmount: json.taxAmount ?? 0,
    total: json.total,
    status: json.status,
    paymentStatus: json.paymentStatus,
    paymentMethod: json.paymentMethod,
  }
}

export async function placeOrder(
  supabase: SupabaseClient,
  input: PlaceOrderInput
): Promise<{ orderId: string; total: number }> {
  const { data, error } = await supabase.rpc("place_order", {
    p_payload: {
      orderType: toRealOrderType(input.orderType),
      tableId: input.tableId ?? null,
      pickupTime: input.pickupTime ?? null,
      paymentMethod: input.paymentMethod,
      promoCode: input.promoCode ?? null,
      redeemLoyaltyPoints: input.redeemLoyaltyPoints ?? 0,
      paymentCollected: input.paymentCollected ?? false,
      items: input.items.map((item) => ({
        menuItemId: item.menuItemId,
        sizeId: item.sizeId ?? null,
        modifierIds: item.modifierIds,
        quantity: item.quantity,
        note: item.note ?? null,
      })),
    },
  })
  if (error) throw error
  return data as { orderId: string; total: number }
}

export async function getOrderForTracking(supabase: SupabaseClient, orderId: string): Promise<OrderForTracking | null> {
  const { data, error } = await supabase.rpc("get_order_for_tracking", { p_order_id: orderId })
  if (error) throw error
  return data ? mapTrackingJson(data as TrackingJson) : null
}

type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  tax_amount: number
  total: number
  table_id: string | null
  payment_status: string
  payment_method: RealPaymentMethod | null
  tables: { table_number: string } | null
  order_items: { menu_item_id: string; menu_items: { name_vi: string; name_en: string }; quantity: number; unit_price: number; note: string | null }[]
}

const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, tax_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( menu_item_id, quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`

function mapOrderRow(row: OrderRow): OrderForTracking {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    orderType: fromRealOrderType(row.order_type),
    table: row.tables?.table_number,
    items: row.order_items.map((oi) => ({
      menuItemId: oi.menu_item_id,
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      unitPrice: oi.unit_price,
      note: oi.note ?? undefined,
    })),
    subtotal: row.subtotal,
    discount: row.discount_amount,
    taxAmount: row.tax_amount,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
  }
}

export async function getMyOrders(supabase: SupabaseClient): Promise<OrderForTracking[]> {
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapOrderRow)
}

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

export async function confirmOrderPayment(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("confirm_order_payment", { p_order_id: orderId })
  if (error) throw error
  return data as boolean
}

export async function payExistingOrder(
  supabase: SupabaseClient,
  orderId: string,
  locale: string,
  paymentMethod: RealPaymentMethod
): Promise<{ checkoutUrl?: string }> {
  const { data, error } = await supabase.functions.invoke("pay-order", { body: { orderId, locale, paymentMethod } })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { checkoutUrl?: string }
}

export async function setOrderPaymentMethodCash(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_method: "cash" }).eq("id", orderId)
  if (error) throw error
}

export async function changeOrderPaymentMethod(
  supabase: SupabaseClient,
  orderId: string,
  method: RealPaymentMethod | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc("change_order_payment_method", {
    p_order_id: orderId,
    p_method: method,
  })
  if (error) throw error
  return data as boolean
}

export async function cancelPendingOrder(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_pending_order", { p_order_id: orderId })
  if (error) throw error
  return data as boolean
}

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
