"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"
import { Coffee, Bell, Settings, Wallet, LogIn, LogOut } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { useShift } from "@/hooks/useShift"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"
import { ShiftControlsDialog } from "@/components/staff/shift-controls-dialog"

export function KitchenTopBar() {
  const tBrand = useTranslations("Brand")
  const t = useTranslations("KitchenDisplay")
  const { isRealtimeConnected } = useKitchenOrders()
  const { isShiftOpen, isCurrentUserWorking, joinShift, leaveShift } = useShift()
  const clearance = useHeaderActionsClearance()
  const [dialogMode, setDialogMode] = useState<"open" | "close" | null>(null)
  const [isTogglingMembership, setIsTogglingMembership] = useState(false)

  async function handleToggleMembership() {
    setIsTogglingMembership(true)
    try {
      if (isCurrentUserWorking) {
        await leaveShift()
      } else {
        await joinShift()
      }
    } catch {
      // Realtime/refetch will reconcile the button state either way.
    } finally {
      setIsTogglingMembership(false)
    }
  }

  return (
    <header
      className="flex shrink-0 flex-col gap-2 border-b bg-card px-4 pt-14 pb-2 md:h-16 md:flex-row md:items-center md:justify-between md:gap-0 md:pt-0 md:pb-0 md:pr-[var(--header-clearance)]"
      style={{ "--header-clearance": `${clearance}px` } as React.CSSProperties}
    >
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <Coffee className="h-5 w-5" />
          {tBrand("name")}
        </Link>
        <div className="hidden h-6 w-px bg-border md:block" />
        <span className="hidden text-sm font-semibold text-muted-foreground md:inline">{t("stationLabel")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="nb-border-sm flex items-center gap-2 rounded-lg bg-chip px-2 py-1.5 md:px-3">
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
        {isShiftOpen ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTogglingMembership}
              onClick={handleToggleMembership}
              className={cn(
                "nb-border-sm flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold md:px-3",
                isCurrentUserWorking ? "bg-secondary/20 text-secondary" : "bg-chip text-muted-foreground"
              )}
            >
              {isCurrentUserWorking ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
              <span>{isCurrentUserWorking ? t("leaveShiftButton") : t("joinShiftButton")}</span>
            </button>
            <button
              type="button"
              onClick={() => setDialogMode("close")}
              className="nb-border-sm flex items-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground md:px-3"
            >
              <Wallet className="h-3.5 w-3.5" />
              <span>{t("closeShiftButton")}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDialogMode("open")}
            className="nb-border-sm flex items-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground md:px-3"
          >
            <Wallet className="h-3.5 w-3.5" />
            <span>{t("openShiftButton")}</span>
          </button>
        )}
        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            disabled
            title="Not implemented yet — no notification system"
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            title="Not implemented yet — no staff settings page"
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {dialogMode && (
          <ShiftControlsDialog key="shift-controls-dialog" mode={dialogMode} onClose={() => setDialogMode(null)} />
        )}
      </AnimatePresence>
    </header>
  )
}
