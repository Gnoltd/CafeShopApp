"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Link, usePathname } from "@/i18n/navigation"
import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { canAccessAdmin } from "@/lib/roles"

// The two-tab "Operations" switcher (Task 16) -- the only real navigation
// affordance the live KDS board exposes (it otherwise bare-renders with no
// chrome of its own, see the isLiveOrdersActive/isTablesActive branch
// below), so this is what makes /staff/tables actually reachable by a
// plain `staff` account, which has no admin sidebar to fall back on.
function OperationsTabSwitcher({ isTablesActive, role }: { isTablesActive: boolean; role: string | null }) {
  const tNav = useTranslations("Nav")
  // Admin pages are only reachable from here: manager+admin manage the menu,
  // admin alone manages staff accounts and shop settings (same split as middleware).
  const adminLinks = [
    ...(canAccessAdmin(role) ? [{ href: "/admin/menu", label: tNav("menu") }] : []),
    ...(role === "admin"
      ? [
          { href: "/admin/staff", label: tNav("staff") },
          { href: "/admin/settings", label: tNav("settings") },
        ]
      : []),
  ]
  return (
    <nav className="nb-border-sm nb-shadow-sm inline-flex w-fit max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-card p-1">
      <Link
        href="/staff/orders"
        className={cn(
          "shrink-0 rounded-md px-3 py-1.5 text-xs font-extrabold",
          !isTablesActive ? "bg-primary text-primary-foreground" : "text-muted-foreground"
        )}
      >
        {tNav("kitchenDisplay")}
      </Link>
      <Link
        href="/staff/tables"
        className={cn(
          "shrink-0 rounded-md px-3 py-1.5 text-xs font-extrabold",
          isTablesActive ? "bg-primary text-primary-foreground" : "text-muted-foreground"
        )}
      >
        {tNav("tables")}
      </Link>
      {adminLinks.map(({ href, label }) => (
        <Link key={href} href={href} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-extrabold text-muted-foreground">
          {label}
        </Link>
      ))}
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
  const t = useTranslations("KitchenDisplay")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()
  const isLiveOrdersActive = pathname === "/staff/orders"
  const isTablesActive = pathname === "/staff/tables"
  const { completedCount, avgTimeLabel } = useKitchenOrders()

  if (isLiveOrdersActive || isTablesActive) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className={cn("flex shrink-0 items-center px-3 pb-2", isTablesActive ? "pt-14" : "pt-2")}>
          <OperationsTabSwitcher isTablesActive={isTablesActive} role={role} />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KitchenTopBar />
      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b bg-muted/40 px-3 py-2 md:hidden">
        <nav className="flex shrink-0 gap-1">
          <Link
            href="/staff/orders"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              isLiveOrdersActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground"
            )}
          >
            {t("liveOrders")}
          </Link>
          <Link href="/staff/pos" className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground">
            {tNav("pos")}
          </Link>
          {canAccessAdmin(role) && (
            <Link href="/admin/dashboard" className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground">
              {tNav("dashboard")}
            </Link>
          )}
        </nav>
        <div className="flex shrink-0 gap-3 text-[11px] text-muted-foreground">
          <span>
            {t("completedLabel")}: <strong className="text-card-foreground">{completedCount}</strong>
          </span>
          <span>
            {t("avgTimeLabel")}: <strong className="text-card-foreground">{avgTimeLabel}</strong>
          </span>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} role={role} />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
