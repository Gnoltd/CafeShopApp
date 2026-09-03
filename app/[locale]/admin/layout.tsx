import { redirect } from "next/navigation"
import { headers } from "next/headers"
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
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null

  if (!canAccessAdmin(role)) {
    redirect(`/${locale}${role ? (ROLE_HOME[role] ?? "/menu") : "/login"}`)
  }

  return <AdminLayoutClient>{children}</AdminLayoutClient>
}
