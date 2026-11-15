"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Link, usePathname } from "@/i18n/navigation"
import { getOperationsNavItems } from "@/lib/roles"

// Operations switcher shared by /staff/orders (KDS) and /staff/tables.
// Tabs and admin-page links come from the unified route authorization policy
// so plain staff see KDS + Tables, managers also see Menu, and admins see all.
function OperationsTabSwitcher({ pathname, role }: { pathname: string; role: string | null }) {
  const tNav = useTranslations("Nav")
  const navItems = getOperationsNavItems(role)

  return (
    <nav className="nb-border-sm nb-shadow-sm inline-flex w-fit max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-card p-1">
      {navItems.map(({ href, labelKey }) => {
        const isActive = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-extrabold",
              isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {tNav(labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}

export function StaffOrdersLayoutClient({
  children,
  role,
}: {
  children: React.ReactNode
  role: string | null
}) {
  const pathname = usePathname()
  const isTablesActive = pathname === "/staff/tables"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={cn("flex shrink-0 items-center px-3 pb-2", isTablesActive ? "pt-14" : "pt-2")}>
        <OperationsTabSwitcher pathname={pathname} role={role} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
