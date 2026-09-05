"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Link, usePathname } from "@/i18n/navigation"
import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { canAccessAdmin } from "@/lib/roles"

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
  const isHistoryActive = pathname === "/staff/orders/history"
  const isShiftHistoryActive = pathname === "/staff/orders/shift-history"
  const { completedCount, avgTimeLabel } = useKitchenOrders()

  if (isLiveOrdersActive) {
    return <div className="h-full overflow-hidden">{children}</div>
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
          <Link
            href="/staff/orders/history"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              isHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground"
            )}
          >
            {t("orderHistoryNav")}
          </Link>
          <Link
            href="/staff/orders/shift-history"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              isShiftHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground"
            )}
          >
            {t("shiftHistoryNav")}
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
