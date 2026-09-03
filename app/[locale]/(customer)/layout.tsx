import { MotionConfig } from "framer-motion"
import { CustomerHeader } from "@/components/customer/header"
import { BottomNav } from "@/components/customer/bottom-nav"
import { RouteTransition } from "@/components/motion/route-transition"
import { TablesProvider } from "@/hooks/useTables"
import { CartProvider } from "@/hooks/useCart"
import { OrdersProvider } from "@/hooks/useOrders"

// Cart/Orders/Tables are only ever consumed by customer-facing components
// (table-landing, checkout, cart, order history/tracking, the header/bottom
// nav rendered right here) -- scoped to this route group instead of the
// root layout so marketing/auth/staff/admin routes don't pay for their
// initial fetch + Realtime subscription. See daily.md Task 4.
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <TablesProvider>
      <CartProvider>
        <OrdersProvider>
          <MotionConfig reducedMotion="user">
            <CustomerHeader showBack />
            <div className="min-h-dvh pb-20 md:pb-0">
              <RouteTransition>{children}</RouteTransition>
            </div>
            <BottomNav />
          </MotionConfig>
        </OrdersProvider>
      </CartProvider>
    </TablesProvider>
  )
}
