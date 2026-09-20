export const ROLE_HOME: Record<string, string> = {
  staff: "/staff/orders",
  manager: "/staff/orders",
  admin: "/staff/orders",
}

export function canAccessAdmin(role: string | null): boolean {
  return role === "manager" || role === "admin"
}
