export type RealOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "served" | "completed" | "cancelled"
export type RealOrderType = "pickup" | "dine_in"
export type OrderType = "pickup" | "dine-in"
export type RealPaymentMethod = "stripe" | "cash" | "vnpay"
export type RealOrderItemStatus = "preparing" | "ready" | "served"

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
  order_items: {
    id: string
    menu_item_id: string
    menu_items: { name_vi: string; name_en: string }
    quantity: number
    unit_price: number
    note: string | null
    status: RealOrderItemStatus
    size_id?: string | null
    menu_item_sizes?: { name: string } | null
    order_item_modifiers?: { modifier_id: string; modifiers: { name_vi: string; name_en: string } }[] | null
  }[]
}

export const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, tax_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( id, menu_item_id, size_id, quantity, unit_price, note, status, menu_item_sizes ( name ), order_item_modifiers ( modifier_id, modifiers ( name_vi, name_en ) ), menu_items ( name_vi, name_en ) )
`
