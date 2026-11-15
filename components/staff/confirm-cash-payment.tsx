"use client"

import { useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { cn } from "@/lib/utils"

// Cash is the only payment method left system-wide -- there's nothing to
// "pick" anymore. A single tap confirms cash settlement immediately (no
// picker UI, no confirm dialog).
export function ConfirmCashPayment({
  onConfirm,
  disabled,
  className,
}: {
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations("KitchenDisplay")
  return (
    <button
      type="button"
      onClick={onConfirm}
      disabled={disabled}
      className={cn(
        "nb-border nb-shadow nb-press flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-extrabold uppercase tracking-wide text-secondary-foreground disabled:opacity-60",
        className
      )}
    >
      <Banknote className="h-3.5 w-3.5" />
      {t("confirmCashReceived")}
    </button>
  )
}
