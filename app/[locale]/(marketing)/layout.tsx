import { MotionConfig } from "framer-motion"
import { BottomNav } from "@/components/customer/bottom-nav"
import { CartProvider } from "@/hooks/useCart"

// No CustomerHeader here: the landing hero's LandingNav is the header for this
// route; a second brand bar above the 100dvh hero pushes its bottom CTAs
// underneath the fixed BottomNav.
//
// CartProvider is still required here even though marketing has no cart UI
// of its own: BottomNav (rendered right below) reads useCart() for its item
// badge. Task 4's provider-scoping pass moved CartProvider out of the root
// layout down to just (customer) and missed that BottomNav/CustomerHeader
// are shared chrome also rendered by (marketing) and (auth) -- caused a
// live "must be used within CartProvider" 500 on both routes, hotfixed here.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <MotionConfig reducedMotion="user">
        <div className="min-h-dvh pb-20 md:pb-0">{children}</div>
        <BottomNav />
      </MotionConfig>
    </CartProvider>
  )
}
