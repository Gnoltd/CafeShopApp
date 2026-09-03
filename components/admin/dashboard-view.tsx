"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  Banknote,
  ShoppingBag,
  Gift,
  TriangleAlert,
  Coffee,
  Droplet,
  Wheat,
  Candy,
  ArrowRight,
  FileSpreadsheet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatVND, formatWeekdayShort } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useInventory, type IngredientIcon } from "@/hooks/useInventory"
import { useTables } from "@/hooks/useTables"
import { useDashboardStats } from "@/hooks/useDashboardStats"
import { AsyncRetryError, StaleNotice } from "@/components/shared/async-state"

const INGREDIENT_ICONS: Record<IngredientIcon, typeof Coffee> = {
  coffee: Coffee,
  droplet: Droplet,
  wheat: Wheat,
  candy: Candy,
}

export function DashboardView({ locale }: { locale: string }) {
  const t = useTranslations("Dashboard")
  const { ingredients, restock, isLoading } = useInventory()
  const lowStock = ingredients.filter((i) => i.stock < i.threshold)
  const { tables } = useTables()
  const availableCount = tables.filter((tbl) => tbl.status === "available").length
  const occupiedCount = tables.filter((tbl) => tbl.status === "occupied").length
  const cleaningCount = tables.filter((tbl) => tbl.status === "cleaning").length
  const needsCleaningAttention = tables.filter((tbl) => tbl.cleaningNotifiedAt !== null).length
  const {
    stats,
    isLoading: isStatsLoading,
    hasLoadError: hasStatsError,
    hasStaleData: hasStaleStats,
    retry: retryStats,
  } = useDashboardStats()
  const maxRevenue = Math.max(...stats.sevenDayRevenue.map((d) => d.revenue), 1)
  const [restockingId, setRestockingId] = useState<string | null>(null)
  const [restockError, setRestockError] = useState<string | null>(null)

  async function handleRestock(id: string) {
    setRestockError(null)
    setRestockingId(id)
    try {
      await restock(id)
    } catch {
      setRestockError(t("restockError"))
    } finally {
      setRestockingId(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">{t("overview")}</h2>
          <p className="text-muted-foreground">{t("welcomeMessage")}</p>
        </div>
        <Button
          variant="outline"
          className="h-10 gap-2"
          onClick={async () => {
            const { exportDashboardExcel } = await import("@/lib/export-dashboard-excel")
            exportDashboardExcel({
              stats,
              lowStock,
              tableCounts: { available: availableCount, occupied: occupiedCount, cleaning: cleaningCount },
              locale,
            })
          }}
        >
          <FileSpreadsheet className="h-4 w-4" />
          {t("exportExcel")}
        </Button>
      </div>

      {hasStatsError && (
        <AsyncRetryError onRetry={retryStats} message={t("statsLoadError")} compact />
      )}
      {hasStaleStats && !hasStatsError && <StaleNotice onRetry={retryStats} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/shift"
          className="nb-border-sm nb-shadow-sm nb-press-sm rounded-xl bg-card p-5"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Banknote className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-muted-foreground">{t("todaysRevenue")}</p>
          <h3 className="text-xl font-bold text-card-foreground">
            {/* A failed load must never render as a real $0 -- that's
                indistinguishable from an actually-quiet day. */}
            {isStatsLoading ? t("loadingStats") : hasStatsError ? "—" : formatVND(stats.todayRevenue)}
          </h3>
        </Link>
        <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/15 text-secondary">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-muted-foreground">{t("ordersToday")}</p>
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : hasStatsError ? "—" : stats.ordersToday}
          </h3>
        </div>
        <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground">
            <Gift className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-muted-foreground">{t("loyaltyIssued")}</p>
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : hasStatsError ? "—" : stats.loyaltyIssuedToday}
          </h3>
        </div>
        <div className="nb-border-sm nb-shadow-sm rounded-xl border-destructive bg-destructive/5 p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-destructive">{t("lowStockAlerts")}</p>
          <h3 className="text-xl font-bold text-destructive">{lowStock.length}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="font-bold text-card-foreground">{t("revenuePerformance")}</h4>
            <span className="rounded-lg bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
              {t("last7Days")}
            </span>
          </div>
          <div className="flex h-48 items-end justify-between gap-2">
            {stats.sevenDayRevenue.map((day, index) => (
              <div
                key={day.date}
                className={cn(
                  "flex-1 rounded-t-lg transition-colors",
                  index === stats.sevenDayRevenue.length - 1 ? "bg-primary" : "bg-primary/20 hover:bg-primary/40"
                )}
                style={{ height: `${(day.revenue / maxRevenue) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {stats.sevenDayRevenue.map((day) => (
              <span key={day.date}>{formatWeekdayShort(day.date, locale)}</span>
            ))}
          </div>
        </div>

        <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
          <h4 className="mb-4 font-bold text-card-foreground">{t("bestSellers")}</h4>
          <div className="space-y-3">
            {stats.bestSellers.map((item, index) => (
              <div key={`${item.nameEn}-${index}`} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Coffee className="h-5 w-5" />
                </div>
                <p className="flex-1 truncate text-sm font-bold text-card-foreground">
                  {locale === "vi" ? item.nameVi : item.nameEn}
                </p>
                <div className="text-right">
                  <p className="font-bold text-primary">{item.quantitySold}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("sold")}</p>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-4 h-9 w-full gap-1.5 border-dashed text-xs"
            render={<Link href="/admin/menu" />}
            nativeButton={false}
          >
            {t("viewAllItems")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="flex items-center gap-2 font-bold text-card-foreground">
            <TriangleAlert className="h-4 w-4 text-destructive" />
            {t("inventoryStatus")}
          </h4>
          <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">
            {t("itemsLowInStock", { count: lowStock.length })}
          </span>
        </div>
        {restockError && (
          <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{restockError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 pb-3 font-medium">{t("product")}</th>
                <th className="px-3 pb-3 font-medium">{t("category")}</th>
                <th className="px-3 pb-3 text-center font-medium">{t("stock")}</th>
                <th className="px-3 pb-3 font-medium">{t("status")}</th>
                <th className="px-3 pb-3 text-right font-medium">{t("action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("loadingInventory")}
                  </td>
                </tr>
              ) : lowStock.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("noLowStock")}
                  </td>
                </tr>
              ) : (
                lowStock.map((item) => {
                  const Icon = INGREDIENT_ICONS[item.icon]
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-bold text-card-foreground">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {locale === "vi" ? item.nameVi : item.nameEn}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {locale === "vi" ? item.subtitleVi : item.subtitleEn}
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-destructive">
                        {item.stock} {item.unit}
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-destructive">
                          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          {t("critical")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => handleRestock(item.id)}
                          disabled={restockingId === item.id}
                        >
                          {restockingId === item.id ? t("restocking") : t("restock")}
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="font-bold text-card-foreground">{t("tableStatus")}</h4>
          {needsCleaningAttention > 0 && (
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">
              {t("tablesNeedCleaning", { count: needsCleaningAttention })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-green-50 p-3 text-center dark:bg-green-950/20">
            <p className="text-xl font-bold text-green-700">{availableCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableAvailable")}</p>
          </div>
          <div className="rounded-lg bg-red-50 p-3 text-center dark:bg-red-950/20">
            <p className="text-xl font-bold text-red-700">{occupiedCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableOccupied")}</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-center dark:bg-amber-950/20">
            <p className="text-xl font-bold text-amber-700">{cleaningCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableCleaning")}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
