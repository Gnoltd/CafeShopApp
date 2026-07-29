import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"
import { ShiftProvider } from "@/hooks/useShift"

const ALLOWED_ROLES = ["staff", "manager", "admin"]

// Defense-in-depth (2026-07-29 review, L-4): middleware.ts is the real
// gate for /staff/*, but if it were ever bypassed this would otherwise
// still render the full staff UI shell (data itself stays RLS-gated
// regardless). Mirrors middleware's own resolveRedirect target exactly
// -- a wrong-role login goes to its own ROLE_HOME, a logged-out visitor
// to /login.
export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  if (!role || !ALLOWED_ROLES.includes(role)) {
    redirect(`/${locale}${role ? (ROLE_HOME[role] ?? "/menu") : "/login"}`)
  }

  return (
    <div className="h-dvh overflow-hidden">
      <ShiftProvider>
        <KitchenOrdersProvider>{children}</KitchenOrdersProvider>
      </ShiftProvider>
    </div>
  )
}
