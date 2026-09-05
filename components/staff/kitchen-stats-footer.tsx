"use client"

import { Plus } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatKitchenClock } from "@/components/staff/kitchen-clock"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

export function KitchenStatsFooter({ now, onRecall }: { orders: KdsOrder[]; now: number; onRecall: () => void }) {
  const t = useTranslations("KitchenDisplay")
  const locale = useLocale()
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t-2 border-ink bg-card px-5 py-3">
      <p className="flex-1 text-[11px] font-semibold text-muted-foreground">{t("footerHint")}</p>
      <span className="hidden text-[11px] font-bold text-success sm:inline">{formatKitchenClock(now, locale)}</span>
      {/* A walk-in/phone order has nowhere to go from the live board itself --
          staff-orders-layout-client.tsx deliberately renders no sidebar/top-bar
          on this exact route (a full-bleed terminal, matching the mockup), so
          this is the only way back to POS without leaving the page via the
          URL bar. Real navigation now, not the mockup's fabricate-a-fake-order
          simulate button -- that would recreate the stale-order clutter this
          same pass just cleaned out of the live database. */}
      <Button variant="outline" size="sm" render={<Link href="/staff/pos" />} nativeButton={false}>
        <Plus className="h-3.5 w-3.5" />
        {t("walkInOrder")}
      </Button>
      <Button variant="neubrutal" size="sm" onClick={onRecall}>
        {t("recall")}
      </Button>
    </footer>
  )
}
