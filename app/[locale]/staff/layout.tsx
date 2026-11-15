import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { resolveRedirect } from "@/lib/roles"

// Defense-in-depth (2026-07-29 review, L-4): middleware.ts is the real
// gate for /staff/*, but if it were ever bypassed this would otherwise
// still render the full staff UI shell (data itself stays RLS-gated
// regardless). Consults the same resolveRedirect policy as middleware --
// a wrong-role login goes to its own ROLE_HOME, a logged-out visitor
// to /login.
export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // Deliberately NOT the x-resolved-role request header the rest of the
  // app reads. That header is only trustworthy on a request middleware
  // actually ran on -- and a matcher gap (or any future one) means "did
  // middleware run here?" is exactly the question this gate must not have
  // to answer. Resolving the role independently, server-side, is what
  // makes the defense-in-depth claim above true rather than circular; the
  // extra Auth + profiles round trip is the accepted cost on the
  // authorization gates specifically (the display/data-only readers
  // keep the header optimization).
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  const redirectPath = resolveRedirect("/staff", role)
  if (redirectPath) {
    redirect(`/${locale}${redirectPath}`)
  }

  // KitchenOrders and Tables providers mount in the `(operations)` route-group
  // layout (`app/[locale]/staff/(operations)/layout.tsx`) so /staff/orders and
  // /staff/tables share one live subscription and state tree.
  return <div className="h-dvh overflow-hidden">{children}</div>
}
