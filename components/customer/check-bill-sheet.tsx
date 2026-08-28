"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CreditCard, QrCode, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { checkoutTableSession } from "@/lib/supabase/table-session-data"

type Method = "cash" | "stripe" | "vnpay"

const METHODS: { id: Method; icon: typeof Banknote; labelKey: "checkBillPayCash" | "checkBillPayCard" | "checkBillPayVNPay" }[] = [
  { id: "cash", icon: Banknote, labelKey: "checkBillPayCash" },
  { id: "stripe", icon: CreditCard, labelKey: "checkBillPayCard" },
  { id: "vnpay", icon: QrCode, labelKey: "checkBillPayVNPay" },
]

export function CheckBillSheet({
  qrToken,
  unpaidTotal,
  onClose,
  onSuccess,
}: {
  qrToken: string
  unpaidTotal: number
  onClose: () => void
  onSuccess: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("TableSession")
  const [supabase] = useState(() => createClient())
  const [method, setMethod] = useState<Method | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!method) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await checkoutTableSession(supabase, qrToken, method, locale, promoCode.trim() || null)
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
        return
      }
      onSuccess()
    } catch {
      setError(t("checkBillError"))
      setIsSubmitting(false)
    }
  }

  if (unpaidTotal === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
        <div className="nb-border nb-shadow w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl">
          <p className="mb-4 text-sm text-muted-foreground">{t("checkBillNothingToPay")}</p>
          <Button variant="neubrutal" className="h-11 w-full" onClick={onClose}>
            {t("checkBillClose")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="nb-border nb-shadow w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-card-foreground">{t("checkBillTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("checkBillClose")} className="text-muted-foreground hover:text-destructive">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{t("checkBillTotal")}</span>
          <span className="text-xl font-extrabold text-price">{formatVND(unpaidTotal)}</span>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder={t("checkBillPromoPlaceholder")}
            className="nb-border-sm h-10 flex-1 rounded-lg"
          />
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {METHODS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              disabled={isSubmitting}
              onClick={() => setMethod(id)}
              className={`nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl p-4 disabled:opacity-50 ${
                method === id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className="text-xs font-bold">{t(labelKey)}</span>
            </button>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <Button variant="neubrutal" className="h-11 w-full" disabled={!method || isSubmitting} onClick={handleConfirm}>
          {isSubmitting ? t("checkBillLoading") : t("checkBillConfirm")}
        </Button>
      </div>
    </div>
  )
}
