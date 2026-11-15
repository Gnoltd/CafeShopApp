export type AppRole = "customer" | "staff" | "manager" | "admin"
export type StaffRole = "staff" | "manager" | "admin"

export const ROLE_HOME: Record<string, string> = {
  staff: "/staff/orders",
  manager: "/staff/orders",
  admin: "/staff/orders",
}

export const AUTH_REQUIRED_EXACT_PATHS: string[] = []

export type RoutePolicy = {
  prefix: string
  allowedRoles: readonly StaffRole[]
}

/**
 * Canonical route authorization rules ordered most-specific first so narrower
 * subtrees (/admin/staff, /admin/settings) take precedence over /admin.
 */
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  { prefix: "/admin/staff", allowedRoles: ["admin"] },
  { prefix: "/admin/settings", allowedRoles: ["admin"] },
  { prefix: "/admin", allowedRoles: ["manager", "admin"] },
  { prefix: "/staff", allowedRoles: ["staff", "manager", "admin"] },
]

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Returns the allowed staff roles for a protected route, or null when public. */
export function getAllowedRolesForRoute(pathname: string): readonly StaffRole[] | null {
  return ROUTE_POLICIES.find((policy) => matchesRoutePrefix(pathname, policy.prefix))?.allowedRoles ?? null
}

/** True when `role` is authorized to access `pathname` (locale prefix already stripped). */
export function canAccessRoute(pathname: string, role: string | null): boolean {
  if (AUTH_REQUIRED_EXACT_PATHS.includes(pathname) && !role) {
    return false
  }

  const allowedRoles = getAllowedRolesForRoute(pathname)
  if (!allowedRoles) return true

  return role !== null && (allowedRoles as readonly string[]).includes(role)
}

/**
 * Returns the locale-relative redirect target if `role` cannot access `pathname`,
 * or null when access is allowed.
 */
export function resolveRedirect(pathname: string, role: string | null): string | null {
  if (canAccessRoute(pathname, role)) return null
  return role ? (ROLE_HOME[role] ?? "/menu") : "/login"
}

export function canAccessAdmin(role: string | null): boolean {
  return canAccessRoute("/admin", role)
}

export const ADMIN_NAV_ITEMS = [
  { href: "/admin/menu", labelKey: "menu" },
  { href: "/admin/staff", labelKey: "staff" },
  { href: "/admin/settings", labelKey: "settings" },
] as const

export const ADMIN_EXTERNAL_NAV_ITEMS = [
  { href: "/staff/orders", labelKey: "operations" },
] as const

export const OPERATIONS_NAV_ITEMS = [
  { href: "/staff/orders", labelKey: "kitchenDisplay" },
  { href: "/staff/tables", labelKey: "tables" },
  ...ADMIN_NAV_ITEMS,
] as const

/** Returns admin shell navigation items permitted for `role`. */
export function getAdminNavItems(role: string | null) {
  return ADMIN_NAV_ITEMS.filter((item) => canAccessRoute(item.href, role))
}

/** Returns external navigation items from the admin shell permitted for `role`. */
export function getAdminExternalNavItems(role: string | null) {
  return ADMIN_EXTERNAL_NAV_ITEMS.filter((item) => canAccessRoute(item.href, role))
}

/** Returns operations-switcher navigation items permitted for `role`. */
export function getOperationsNavItems(role: string | null) {
  return OPERATIONS_NAV_ITEMS.filter((item) => canAccessRoute(item.href, role))
}
