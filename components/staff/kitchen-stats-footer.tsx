"use client"

import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

export function formatKitchenClock(now: number, locale: string): string {
  return new Date(now).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: locale !== "vi" })
}
export function KitchenStatsFooter({ now }: { orders: KdsOrder[]; now: number }) {
  const t = useTranslations("KitchenDisplay"); const locale = useLocale()
  return <footer className="flex shrink-0 items-center gap-3 border-t-2 border-ink bg-card px-5 py-3"><p className="flex-1 text-[11px] font-semibold text-muted-foreground">{t("footerHint")}</p><span className="hidden text-[11px] font-bold text-success sm:inline">{formatKitchenClock(now, locale)}</span><Button variant="outline" size="sm" disabled title={t("demoUnavailable")}>{t("simulate")}</Button><Button variant="neubrutal" size="sm" disabled title={t("demoUnavailable")}>{t("recall")}</Button></footer>
}
