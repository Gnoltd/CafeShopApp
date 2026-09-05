"use client"

import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

type LoadLevel = "light" | "moderate" | "busy"

function loadLevelFor(activeCount: number): LoadLevel {
  if (activeCount <= 2) return "light"
  if (activeCount <= 5) return "moderate"
  return "busy"
}

const LOAD_STYLES: Record<LoadLevel, { bar: string; text: string; labelKey: "loadLight" | "loadModerate" | "loadBusy" }> = {
  light: { bar: "bg-green-600", text: "text-green-600", labelKey: "loadLight" },
  moderate: { bar: "bg-amber-600", text: "text-amber-600", labelKey: "loadModerate" },
  busy: { bar: "bg-destructive", text: "text-destructive", labelKey: "loadBusy" },
}

// Pinned to the shop's own timezone (not the visitor's) — without this,
// SSR (Vercel's server, UTC) and hydration (the browser's local
// timezone) render different clock text on the very first paint,
// producing a React hydration mismatch (error #418).
export function formatKitchenClock(now: number, locale: string): string {
  return new Date(now).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: locale !== "vi",
  })
}

export function KitchenStatsFooter({ orders, now }: { orders: KdsOrder[]; now: number }) {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")

  const activeOrders = orders.filter((o) => o.status !== "ready" && o.status !== "served")
  const activeCount = activeOrders.length
  const level = loadLevelFor(activeCount)
  const barWidth = Math.min(100, (activeCount / 8) * 100)

  const avgWaitMinutes =
    activeCount === 0
      ? 0
      : Math.round(
          activeOrders.reduce((sum, o) => sum + (now - o.createdAt), 0) / activeCount / 60000
        )

  const clock = formatKitchenClock(now, locale)

  return (
    <footer className="nb-border-sm flex shrink-0 flex-col gap-2 rounded-xl bg-card px-4 py-3 md:min-h-12 md:flex-row md:items-center md:gap-6 md:px-6 md:py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">{t("currentLoad")}:</span>
          <div className="nb-border-sm h-2.5 w-20 overflow-hidden rounded-full bg-muted md:w-32">
            <div className={cn("h-full transition-all", LOAD_STYLES[level].bar)} style={{ width: `${barWidth}%` }} />
          </div>
          <span className={cn("text-xs font-bold", LOAD_STYLES[level].text)}>{t(LOAD_STYLES[level].labelKey)}</span>
        </div>
        <span className="text-base font-bold text-primary md:hidden">{clock}</span>
      </div>
      <div className="hidden h-4 w-px bg-border md:block" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm text-muted-foreground">
          {t("queueLabel")}: <strong className="text-card-foreground">{t("queueOrders", { count: activeCount })}</strong>
        </span>
        <span className="text-sm text-muted-foreground">
          {t("waitTimeLabel")}: <strong className="text-card-foreground">{t("waitTimeValue", { minutes: avgWaitMinutes })}</strong>
        </span>
      </div>
      <span className="ml-auto hidden text-lg font-bold text-primary md:block">{clock}</span>
      <p className="w-full text-[11px] font-semibold text-muted-foreground md:order-first md:w-auto md:flex-1">
        {t("footerHint")}
      </p>
    </footer>
  )
}
