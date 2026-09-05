"use client"

import { useTranslations } from "next-intl"
import { CookingPot, Gauge, History, Wallet, Boxes, ShoppingCart, LayoutDashboard } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { canAccessAdmin } from "@/lib/roles"

export function KitchenSidebar({
  completedCount,
  avgTimeLabel,
  role,
}: {
  completedCount: number
  avgTimeLabel: string
  role: string | null
}) {
  const t = useTranslations("KitchenDisplay")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()
  const isHistoryActive = pathname === "/staff/orders/history"
  const isShiftHistoryActive = pathname === "/staff/orders/shift-history"
  const isLiveOrdersActive = !isHistoryActive && !isShiftHistoryActive

  return (
    <aside className="nb-border border-y-0 border-l-0 hidden w-56 shrink-0 flex-col bg-muted/60 py-4 md:flex">
      <div className="flex items-center gap-3 px-4 pb-4">
        <div className="nb-border-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-chip text-secondary">
          <CookingPot className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-card-foreground">{t("terminalName")}</p>
          <p className="text-xs text-muted-foreground">{t("terminalSubtitle")}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        <Link
          href="/staff/orders"
          className={
            isLiveOrdersActive
              ? "nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-lg bg-chip px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <Gauge className="h-4 w-4" />
          {t("liveOrders")}
        </Link>
        <Link
          href="/staff/orders/history"
          className={
            isHistoryActive
              ? "nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-lg bg-chip px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <History className="h-4 w-4" />
          {t("orderHistoryNav")}
        </Link>
        <Link
          href="/staff/orders/shift-history"
          className={
            isShiftHistoryActive
              ? "nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-lg bg-chip px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <Wallet className="h-4 w-4" />
          {t("shiftHistoryNav")}
        </Link>
        <button
          type="button"
          disabled
          title={t("inventoryTooltip")}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground opacity-60"
        >
          <Boxes className="h-4 w-4" />
          {t("inventoryNav")}
        </button>
      </nav>

      <nav className="nb-border border-x-0 border-b-0 space-y-1 px-2 pt-3">
        <Link
          href="/staff/pos"
          className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
        >
          <ShoppingCart className="h-4 w-4" />
          {tNav("pos")}
        </Link>
        {canAccessAdmin(role) && (
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          >
            <LayoutDashboard className="h-4 w-4" />
            {tNav("dashboard")}
          </Link>
        )}
      </nav>

      <div className="nb-border-sm mx-2 mt-auto rounded-xl bg-card p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t("shiftStats")}
        </p>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("completedLabel")}:</span>
          <span className="font-bold text-card-foreground">{completedCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("avgTimeLabel")}:</span>
          <span className="font-bold text-card-foreground">{avgTimeLabel}</span>
        </div>
      </div>
    </aside>
  )
}
