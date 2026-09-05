"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, Timer } from "lucide-react"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { KitchenStatsFooter, formatKitchenClock } from "@/components/staff/kitchen-stats-footer"
import { KitchenBoard, type PaymentAction } from "@/components/staff/kitchen-board"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export function KitchenDisplay() {
  const { orders, pendingPaymentOrders, advanceItem, isItemPending, confirmCashPayment, confirmTableCashPayment, markTableCashPayment, completedCount, avgTimeLabel } = useKitchenOrders()
  const t = useTranslations("KitchenDisplay")
  const locale = useLocale()
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "pickup" | "dine-in">("all")

  useEffect(() => {
    const immediate = setTimeout(() => setNow(Date.now()), 0)
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearTimeout(immediate)
      clearInterval(interval)
    }
  }, [])

  // Stable references so KitchenPendingPayment/KitchenTablesColumn (memoized
  // below and in their own files) can actually skip re-rendering on the
  // once-a-second `now` tick, instead of getting a fresh closure every time.
  const handleAdvanceItem = useCallback(
    (orderId: string, itemId: string) => {
      setError(null)
      advanceItem(orderId, itemId).catch(() => setError(t("updateError")))
    },
    [advanceItem, t]
  )
  const handlePaymentAction = useCallback(async (order: (typeof orders)[number], action: PaymentAction) => {
    setError(null)
    try {
      if (action === "confirm-pickup-cash") await confirmCashPayment(order.id)
      if (action === "mark-table-cash" && order.tableId) await markTableCashPayment(order.tableId)
      if (action === "confirm-table-cash" && order.tableId) await confirmTableCashPayment(order.tableId)
    } catch { setError(t("updateError")) }
  }, [confirmCashPayment, confirmTableCashPayment, markTableCashPayment, t])

  const visibleOrders = useMemo(() => {
    const all = [...orders, ...pendingPaymentOrders.filter((pending) => !orders.some((order) => order.id === pending.id))]
    return all.filter((order) => filter === "all" || order.orderType === filter)
  }, [filter, orders, pendingPaymentOrders])
  const openCount = orders.filter((order) => order.status !== "served").length
  const clock = now === 0 ? "--:--:--" : formatKitchenClock(now, locale)

  return (
    <div className="flex h-full min-h-[680px] items-center justify-center overflow-hidden bg-muted/60 p-3 sm:p-4 lg:p-7">
      <section className="nb-border mx-auto flex h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-[22px] border-[10px] bg-background shadow-[0_24px_70px_rgb(0_0_0_/_30%)] lg:h-[760px] lg:max-h-[calc(100dvh-56px)]">
        <header className="flex shrink-0 flex-col gap-3 border-b-2 border-ink bg-card px-4 py-3 lg:flex-row lg:items-center lg:gap-5 lg:px-5">
          <div className="flex items-center gap-3">
            <div className="nb-border-sm flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-card-foreground">{t("stationLabel")}</p>
              <p className="text-xs font-semibold text-muted-foreground">PhaDinCafe</p>
            </div>
            <div className="nb-border-sm ml-1 flex items-center gap-2 rounded-full bg-chip px-3 py-1.5 text-xs font-extrabold text-card-foreground">
              <span className="live-pulse-dot" />
              <Timer className="h-3.5 w-3.5" />
              <span>{clock}</span>
            </div>
          </div>

          <SegmentedControl
            variant="tabs"
            layoutId="kds-order-filter"
            className="w-full max-w-md lg:ml-2"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("filterAll") },
              { value: "pickup", label: t("filterPickup") },
              { value: "dine-in", label: t("filterDineIn") },
            ]}
          />

          <div className="grid grid-cols-3 gap-3 lg:ml-auto lg:gap-5">
            <Kpi label={t("openTickets")} value={openCount} />
            <Kpi label={t("completedLabel")} value={completedCount} tone="success" />
            <Kpi label={t("avgTimeLabel")} value={avgTimeLabel} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {error && (
            <p className="shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            <KitchenBoard orders={visibleOrders} now={now} onAdvanceItem={handleAdvanceItem} isItemPending={isItemPending} onPaymentAction={handlePaymentAction} />
          </div>
          <KitchenStatsFooter orders={orders} now={now} />
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "success" }) {
  return (
    <div className="min-w-0 text-center lg:text-right">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={tone === "success" ? "text-lg font-extrabold text-success" : "text-lg font-extrabold text-card-foreground"}>
        {value}
      </p>
    </div>
  )
}
