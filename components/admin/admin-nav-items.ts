import {
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  Table2,
  Users,
  Calculator,
  Settings,
  ShoppingCart,
  CookingPot,
  Wallet,
  Ticket,
} from "lucide-react"

// Single source of truth for admin-shell navigation -- shared by the
// desktop sidebar, the mobile drawer, and the mobile header's page-title
// lookup, so all three stay in sync with one edit.
export const ADMIN_NAV_ITEMS = [
  { href: "/admin/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/admin/inventory", labelKey: "inventory", icon: Package },
  { href: "/admin/tables", labelKey: "tables", icon: Table2 },
  { href: "/admin/staff", labelKey: "staff", icon: Users },
  { href: "/admin/food-cost", labelKey: "foodCost", icon: Calculator },
  { href: "/admin/shift", labelKey: "shift", icon: Wallet },
  { href: "/admin/promotions", labelKey: "promotions", icon: Ticket },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const

export const ADMIN_FULFILLMENT_NAV_ITEMS = [
  { href: "/staff/pos", labelKey: "pos", icon: ShoppingCart },
  { href: "/staff/orders", labelKey: "kitchenDisplay", icon: CookingPot },
] as const
