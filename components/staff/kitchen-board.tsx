"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, PackageCheck, Utensils, ShoppingBag, ListTodo, RefreshCw, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatOrderId } from "@/lib/format"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { KitchenTablesColumn } from "@/components/staff/kitchen-tables-column"
import type { KdsStatus, KdsOrder } from "@/hooks/useKitchenOrders"

const COLUMNS: {
  status: KdsStatus
  headerClass: string
  labelKey: "columnNew" | "columnPreparing" | "columnReady"
  icon: typeof ListTodo
  iconClass?: string
}[] = [
  { status: "paid", headerClass: "bg-zinc-500", labelKey: "columnNew", icon: ListTodo },
  { status: "preparing", headerClass: "bg-amber-600", labelKey: "columnPreparing", icon: RefreshCw, iconClass: "animate-spin [animation-duration:3s]" },
  { status: "ready", headerClass: "bg-green-600", labelKey: "columnReady", icon: CheckCheck },
]

type BoardColumnKey = "paid" | "preparing" | "ready" | "tables"

export function formatElapsed(createdAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export type UrgencyLevel = "normal" | "warning" | "critical"

const WARNING_MINUTES = 10
const CRITICAL_MINUTES = 15

// Driven by actual wait time rather than column -- an order sitting in
// "New" for 12 minutes is just as urgent as one sitting in "Preparing"
// for 12 minutes, and staff should see that at a glance.
export function urgencyLevelFor(createdAt: number, now: number): UrgencyLevel {
  const minutes = Math.max(0, now - createdAt) / 60_000
  if (minutes >= CRITICAL_MINUTES) return "critical"
  if (minutes >= WARNING_MINUTES) return "warning"
  return "normal"
}

const URGENCY_TIMER_CLASS: Record<UrgencyLevel, string> = {
  normal: "",
  warning: "text-amber-600",
  critical: "animate-pulse text-destructive",
}

export function KitchenBoard({
  orders,
  now,
  onAdvanceItem,
  isItemPending,
}: {
  orders: KdsOrder[]
  now: number
  onAdvanceItem: (orderId: string, itemId: string) => void
  isItemPending: (orderId: string, itemId: string) => boolean
}) {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const [activeColumn, setActiveColumn] = useState<BoardColumnKey>("paid")

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3 sm:p-4 md:grid md:grid-cols-2 md:grid-rows-2 md:gap-3 xl:grid-cols-4 xl:grid-rows-1 xl:gap-4">
      <SegmentedControl
        variant="tabs"
        layoutId="kds-column-pill"
        className="shrink-0 md:hidden"
        value={activeColumn}
        onChange={setActiveColumn}
        options={[
          { value: "paid", label: t("columnNew") },
          { value: "preparing", label: t("columnPreparing") },
          { value: "ready", label: t("columnReady") },
          { value: "tables", label: t("columnTables") },
        ]}
      />
      {COLUMNS.map((column) => {
        const columnOrders = orders.filter((o) => o.status === column.status)
        const Icon = column.icon
        return (
          <section
            key={column.status}
            className={cn(
              "nb-border-sm min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-muted",
              activeColumn === column.status ? "flex" : "hidden",
              "md:h-full md:flex"
            )}
          >
            <header className={cn("flex shrink-0 items-center justify-between p-4 text-white", column.headerClass)}>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                {t(column.labelKey)}
                <span className="rounded bg-white/20 px-2 py-0.5 text-sm">{columnOrders.length}</span>
              </h2>
              <Icon className={cn("h-5 w-5", column.iconClass)} />
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {columnOrders.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
              )}
              {columnOrders.map((order) => {
                const isReady = column.status === "ready"
                const urgency = isReady ? "normal" : urgencyLevelFor(order.createdAt, now)
                return (
                  <div key={order.id} className="nb-border-sm nb-shadow-sm rounded-xl bg-card">
                    <div
                      className={cn(
                        "flex items-start justify-between gap-2 border-b p-3",
                        isReady && "bg-green-50 dark:bg-green-950/20"
                      )}
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-black text-card-foreground">#{formatOrderId(order.id)}</h3>
                        <span
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
                            order.orderType === "pickup"
                              ? "bg-primary text-primary-foreground"
                              : "border bg-muted text-card-foreground"
                          )}
                        >
                          {order.orderType === "pickup" ? (
                            <ShoppingBag className="h-3 w-3" />
                          ) : (
                            <Utensils className="h-3 w-3" />
                          )}
                          {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        {isReady ? (
                          <div className="text-xl font-bold text-green-600">{t("doneLabel")}</div>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "text-xl font-bold",
                                urgency === "normal" && (column.status === "paid" ? "text-primary" : "text-amber-600"),
                                URGENCY_TIMER_CLASS[urgency]
                              )}
                            >
                              {formatElapsed(order.createdAt, now)}
                            </div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              {column.status === "paid" ? t("elapsedTimeCaption") : t("preparingTimeCaption")}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 p-3">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="nb-border-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chip text-sm font-bold text-card-foreground">
                              {item.quantity}x
                            </div>
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "break-words font-bold text-card-foreground",
                                  item.status === "served" && "text-muted-foreground line-through decoration-muted-foreground"
                                )}
                              >
                                {locale === "vi" ? item.nameVi : item.nameEn}
                              </p>
                              {item.note && (
                                <p className="break-words text-sm font-medium italic text-secondary">{item.note}</p>
                              )}
                            </div>
                          </div>
                          {item.status === "served" ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onAdvanceItem(order.id, item.id)}
                              disabled={isItemPending(order.id, item.id)}
                              className={cn(
                                "nb-press-sm nb-border-sm nb-shadow-sm ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-extrabold text-white disabled:pointer-events-none disabled:opacity-40",
                                item.status === "preparing" && "bg-amber-600",
                                item.status === "ready" && "bg-green-600"
                              )}
                            >
                              {item.status === "preparing" ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <PackageCheck className="h-4 w-4" />
                              )}
                              {item.status === "preparing" ? t("markReady") : t("markServed")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      <KitchenTablesColumn active={activeColumn === "tables"} />
    </div>
  )
}
