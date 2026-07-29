import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME, canAccessAdmin } from "@/lib/roles"
import { AdminLayoutClient } from "@/components/admin/admin-layout-client"

// Defense-in-depth (2026-07-29 review, L-4): middleware.ts is the real
// gate for /admin/*, but if it were ever bypassed this would otherwise
// still render the full admin UI shell (data itself stays RLS-gated
// regardless). Mirrors middleware's own resolveRedirect target exactly
// -- a wrong-role login goes to its own ROLE_HOME, a logged-out visitor
// to /login.
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  if (!canAccessAdmin(role)) {
    redirect(`/${locale}${role ? (ROLE_HOME[role] ?? "/menu") : "/login"}`)
  }

  return <AdminLayoutClient>{children}</AdminLayoutClient>
}
