// Re-export barrel: kept so existing imports of "@/lib/supabase/orders-data"
// keep working unchanged. The real modules are split by caller population --
// order-tracking.ts (customer/guest), order-kds.ts (staff KDS), and
// order-history.ts (staff Order History) -- sharing order-mapping.ts for the
// row<->type translation. New code should import from the specific module
// it needs rather than this barrel.

export type {
  RealOrderStatus,
  RealOrderType,
  OrderType,
  RealPaymentMethod,
  OrderForTrackingItem,
  OrderForTracking,
} from "./order-mapping"

export type { PlaceOrderItemInput, PlaceOrderInput } from "./order-tracking"
export {
  placeOrder,
  getOrderForTracking,
  getMyOrders,
  cancelPendingOrder,
  changeOrderPaymentMethod,
  payExistingOrder,
  setOrderPaymentMethodCash,
} from "./order-tracking"

export type { KdsOrderItemRow, KdsOrderRow, OrderItemStatus } from "./order-kds"
export {
  getKitchenOrders,
  getPendingPaymentOrders,
  advanceOrderItemStatus,
  markOrderItemsServed,
  confirmCashPayment,
  confirmServedCashPayment,
  confirmTableCashPayment,
  markTableCashPayment,
  recallLastCompletedOrder,
  NOTHING_TO_RECALL_ERROR,
} from "./order-kds"

export type { OrderHistoryFilters, OrderHistoryRow, OrderHistoryPage, OrderHistoryDetail } from "./order-history"
export { getOrderHistory, getOrderHistoryDetail } from "./order-history"
