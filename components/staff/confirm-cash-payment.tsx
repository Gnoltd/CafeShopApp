"use client"

import { useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RealPaymentMethod } from "@/lib/supabase/order-mapping"

// Cash is the only payment method left system-wide -- there's nothing to
// "pick" anymore. A single tap confirms payment immediately (no picker UI,
// no confirm dialog). `onSelect` is always called with "cash"; kept as the
// same `(method: RealPaymentMethod) => void` shape the old 3-button
// PaymentMethodPicker used so every call site's handler kept working
// unchanged after this rename.
export function ConfirmCashPayment({
  onSelect,
  disabled,
  className,
}: {
  onSelect: (method: RealPaymentMethod) => void
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations("KitchenDisplay")
  return (
    <button
      type="button"
      onClick={() => onSelect("cash")}
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
