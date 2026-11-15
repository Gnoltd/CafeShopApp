import { UtensilsCrossed, Users, Settings, ClipboardList, type LucideIcon } from "lucide-react"
import {
  ADMIN_NAV_ITEMS as ADMIN_NAV_ROUTES,
  ADMIN_EXTERNAL_NAV_ITEMS as ADMIN_EXTERNAL_NAV_ROUTES,
  getAdminNavItems as getAuthorizedAdminNavRoutes,
  getAdminExternalNavItems as getAuthorizedAdminExternalNavRoutes,
} from "@/lib/roles"

type AdminNavHref = (typeof ADMIN_NAV_ROUTES)[number]["href"]
type AdminExternalNavHref = (typeof ADMIN_EXTERNAL_NAV_ROUTES)[number]["href"]

const ADMIN_NAV_ICONS: Record<AdminNavHref, LucideIcon> = {
  "/admin/menu": UtensilsCrossed,
  "/admin/staff": Users,
  "/admin/settings": Settings,
}

const ADMIN_EXTERNAL_NAV_ICONS: Record<AdminExternalNavHref, LucideIcon> = {
  "/staff/orders": ClipboardList,
}

// Single source of truth for admin-shell navigation -- route definitions and
// role gates come from lib/roles.ts; this module binds UI icons so the desktop
// sidebar, mobile drawer, and mobile header page-title lookup stay in sync.
export const ADMIN_NAV_ITEMS = ADMIN_NAV_ROUTES.map((item) => ({
  ...item,
  icon: ADMIN_NAV_ICONS[item.href],
}))

// Links out of the admin shell (outside /admin/*) to staff operations.
export const ADMIN_EXTERNAL_NAV_ITEMS = ADMIN_EXTERNAL_NAV_ROUTES.map((item) => ({
  ...item,
  icon: ADMIN_EXTERNAL_NAV_ICONS[item.href],
}))

export function getAdminNavItems(role: string | null) {
  return getAuthorizedAdminNavRoutes(role).map((item) => ({
    ...item,
    icon: ADMIN_NAV_ICONS[item.href],
  }))
}

export function getAdminExternalNavItems(role: string | null) {
  return getAuthorizedAdminExternalNavRoutes(role).map((item) => ({
    ...item,
    icon: ADMIN_EXTERNAL_NAV_ICONS[item.href],
  }))
}
