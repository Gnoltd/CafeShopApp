"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CreditCard, QrCode, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/dialog"
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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [attemptId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!method) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await checkoutTableSession(supabase, qrToken, method, locale, null, attemptId)
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

  return (
    <DialogRoot
      open
      onOpenChange={(nextOpen) => {
        // Payment is in flight (and about to redirect to a gateway) — don't
        // let Escape or a backdrop press tear the sheet down mid-request.
        if (isSubmitting && !nextOpen) return
        if (!nextOpen) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport align="sheet">
          <DialogPopup variant="sheet" size="sm" className="nb-shadow p-6">
            {unpaidTotal === 0 ? (
              <>
                <DialogTitle className="sr-only">{t("checkBillTitle")}</DialogTitle>
                <DialogDescription className="mb-4 text-sm text-muted-foreground">
                  {t("checkBillNothingToPay")}
                </DialogDescription>
                <Button variant="neubrutal" className="h-11 w-full" onClick={onClose}>
                  {t("checkBillClose")}
                </Button>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <DialogTitle>{t("checkBillTitle")}</DialogTitle>
                  <DialogClose
                    aria-label={t("checkBillClose")}
                    className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-5 w-5" />
                  </DialogClose>
                </div>

                <div className="mb-4 flex items-center justify-between border-t pt-3">
                  <span className="text-sm text-muted-foreground">{t("checkBillTotal")}</span>
                  <span className="text-xl font-extrabold text-price">{formatVND(unpaidTotal)}</span>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2">
                  {METHODS.map(({ id, icon: Icon, labelKey }) => (
                    <button
                      key={id}
                      type="button"
                      disabled={isSubmitting}
                      aria-pressed={method === id}
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

                <Button
                  variant="neubrutal"
                  className="h-11 w-full"
                  disabled={!method || isSubmitting}
                  onClick={handleConfirm}
                >
                  {isSubmitting ? t("checkBillLoading") : t("checkBillConfirm")}
                </Button>
              </>
            )}
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  )
}
