import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"

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

  // Shift/KitchenOrders data is only needed on /staff/orders/* (live board,
  // history, shift-history all share the top bar's shift/realtime status)
  // and /staff/pos (cash-confirm banner + shift gate) -- each mounts its
  // own provider so /staff/rewards doesn't pay for either fetch/Realtime
  // subscription. See daily.md Task 4.
  return <div className="h-dvh overflow-hidden">{children}</div>
}
