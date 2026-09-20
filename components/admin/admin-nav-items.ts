import { UtensilsCrossed, Users, Settings, ClipboardList } from "lucide-react"

// Single source of truth for admin-shell navigation -- shared by the
// desktop sidebar, the mobile drawer, and the mobile header's page-title
// lookup, so all three stay in sync with one edit.
export const ADMIN_NAV_ITEMS = [
  { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/admin/staff", labelKey: "staff", icon: Users },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const

// Links out of the admin shell entirely (outside /admin/*) to the staff
// operations area -- admin/manager still need a way to reach KDS/Tables
// even though those pages no longer live under /admin/*. Kept as its own
// list (rendered in its own bordered-off section, distinct from
// ADMIN_NAV_ITEMS) since it's conceptually "leaving the admin shell", not
// one more admin page.
export const ADMIN_EXTERNAL_NAV_ITEMS = [
  { href: "/staff/orders", labelKey: "operations", icon: ClipboardList },
] as const
