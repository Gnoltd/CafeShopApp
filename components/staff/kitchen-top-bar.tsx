"use client"

import { useTranslations } from "next-intl"
import { Coffee, Bell, Settings } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"
import { LanguageSwitcher } from "@/components/shared/language-switcher"
import { ThemeToggle } from "@/components/shared/theme-toggle"

export function KitchenTopBar() {
  const tBrand = useTranslations("Brand")
  const t = useTranslations("KitchenDisplay")
  const { isRealtimeConnected } = useKitchenOrders()
  const clearance = useHeaderActionsClearance()
  const pathname = usePathname()
  const isKitchenDisplay = pathname === "/staff/orders"

  return (
    <header
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b-2 border-ink bg-card px-4 pb-2 md:h-[72px] md:flex-row md:items-center md:justify-between md:gap-0 md:pt-0 md:pb-0 md:pr-[var(--header-clearance)]",
        isKitchenDisplay ? "pt-3" : "pt-14"
      )}
      style={{ "--header-clearance": `${isKitchenDisplay ? 0 : clearance}px` } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <span className="nb-border-sm flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Coffee className="h-4 w-4" />
          </span>
          <span>{tBrand("name")}</span>
        </Link>
        <div className="hidden h-6 w-px bg-border md:block" />
        <span className="hidden text-sm font-semibold text-muted-foreground md:inline">{t("stationLabel")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="nb-border-sm flex items-center gap-2 rounded-full bg-chip px-2 py-1.5 md:px-3">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isRealtimeConnected ? "animate-pulse bg-green-500" : "bg-destructive"
            )}
          />
          <span className="text-xs text-muted-foreground">
            {isRealtimeConnected ? t("systemOnline") : t("systemOffline")}
          </span>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            disabled
            title={t("notificationsTooltip")}
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            title={t("settingsTooltip")}
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        {isKitchenDisplay && (
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        )}
      </div>
    </header>
  )
}
