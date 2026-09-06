export const ROLE_HOME: Record<string, string> = {
  customer: "/",
  staff: "/staff/pos",
  manager: "/admin/dashboard",
  admin: "/admin/dashboard",
}

export function canAccessAdmin(role: string | null): boolean {
  return role === "manager" || role === "admin"
}
