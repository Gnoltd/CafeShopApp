import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type OrderType,
  type RealOrderType,
  type RealOrderStatus,
  type RealPaymentMethod,
  type OrderForTracking,
  type OrderRow,
  ORDER_SELECT,
  toRealOrderType,
  fromRealOrderType,
  mapOrderRow,
} from "./order-mapping"

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
  submissionId?: string
}

type TrackingJsonItem = { menuItemId: string; nameVi: string; nameEn: string; quantity: number; unitPrice: number; note: string | null; sizeId?: string | null; modifierIds?: string[] }

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
    items: json.items.map((item) => ({ ...item, note: item.note ?? undefined, ...(item.sizeId !== undefined ? { sizeId: item.sizeId, modifierIds: item.modifierIds ?? [] } : {}) })),
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
      submissionId: input.submissionId ?? crypto.randomUUID(),
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

export async function getMyOrders(supabase: SupabaseClient): Promise<OrderForTracking[]> {
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapOrderRow)
}

export async function cancelPendingOrder(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_pending_order", { p_order_id: orderId })
  if (error) throw error
  return data as boolean
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

export async function payExistingOrder(
  supabase: SupabaseClient,
  orderId: string,
  locale: string,
  paymentMethod: RealPaymentMethod,
  attemptId = crypto.randomUUID()
): Promise<{ checkoutUrl?: string }> {
  const { data, error } = await supabase.functions.invoke("pay-order", { body: { orderId, locale, paymentMethod, attemptId } })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { checkoutUrl?: string }
}

export async function setOrderPaymentMethodCash(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_method: "cash" }).eq("id", orderId)
  if (error) throw error
}
