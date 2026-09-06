"use client"

import { useTranslations } from "next-intl"
import { Banknote, CreditCard, QrCode } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RealPaymentMethod } from "@/lib/supabase/orders-data"

const METHODS: { value: RealPaymentMethod; labelKey: "methodCash" | "methodStripe" | "methodVnpay"; icon: typeof Banknote }[] = [
  { value: "cash", labelKey: "methodCash", icon: Banknote },
  { value: "stripe", labelKey: "methodStripe", icon: CreditCard },
  { value: "vnpay", labelKey: "methodVnpay", icon: QrCode },
]

// A single tap confirms payment as that method immediately -- no separate
// confirm dialog. Lets staff record whatever the customer actually paid
// with, correcting it on the spot if it differs from what was pre-picked.
export function PaymentMethodPicker({
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
    <div className={cn("flex gap-1.5", className)}>
      {METHODS.map(({ value, labelKey, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelect(value)}
          disabled={disabled}
          className="nb-border nb-shadow nb-press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-extrabold uppercase tracking-wide text-secondary-foreground disabled:opacity-60"
        >
          <Icon className="h-3.5 w-3.5" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}
