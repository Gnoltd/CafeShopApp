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

export function toRealOrderType(orderType: OrderType): RealOrderType {
  return orderType === "dine-in" ? "dine_in" : "pickup"
}

export function fromRealOrderType(orderType: RealOrderType): OrderType {
  return orderType === "dine_in" ? "dine-in" : "pickup"
}

export type OrderRow = {
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

export const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, tax_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( menu_item_id, quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`

export function mapOrderRow(row: OrderRow): OrderForTracking {
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
