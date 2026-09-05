"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CreditCard, QrCode, Ticket, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { validatePromoCode } from "@/lib/supabase/promotions-data"

type PromoErrorReason =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "limit_reached"
  | "below_minimum"
  | "check_failed"

const PROMO_ERROR_KEY: Record<
  PromoErrorReason,
  "checkBillPromoNotFound" | "checkBillPromoInactive" | "checkBillPromoNotStarted" | "checkBillPromoExpired" | "checkBillPromoLimitReached" | "checkBillPromoBelowMinimum" | "checkBillPromoCheckError"
> = {
  not_found: "checkBillPromoNotFound",
  inactive: "checkBillPromoInactive",
  not_started: "checkBillPromoNotStarted",
  expired: "checkBillPromoExpired",
  limit_reached: "checkBillPromoLimitReached",
  below_minimum: "checkBillPromoBelowMinimum",
  check_failed: "checkBillPromoCheckError",
}

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
  const [promoInput, setPromoInput] = useState("")
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [promoDiscount, setPromoDiscount] = useState(0)
  const [promoErrorReason, setPromoErrorReason] = useState<PromoErrorReason | null>(null)
  const [isApplyingPromo, setIsApplyingPromo] = useState(false)
  const promoRequestPending = useRef(false)

  async function handleApplyPromo() {
    if (promoRequestPending.current || !promoInput.trim()) return
    promoRequestPending.current = true
    setIsApplyingPromo(true)
    try {
      const normalized = promoInput.trim().toUpperCase()
      const result = await validatePromoCode(supabase, normalized, unpaidTotal)
      if (result.valid) {
        setPromoCode(normalized)
        setPromoDiscount(result.discountAmount)
        setPromoErrorReason(null)
        setPromoInput("")
      } else {
        setPromoErrorReason(result.reason)
      }
    } catch {
      setPromoErrorReason("check_failed")
    } finally {
      promoRequestPending.current = false
      setIsApplyingPromo(false)
    }
  }

  function clearPromo() {
    setPromoCode(null)
    setPromoDiscount(0)
    setPromoErrorReason(null)
  }

  const totalToPay = Math.max(unpaidTotal - promoDiscount, 0)

  async function handleConfirm() {
    if (!method) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await checkoutTableSession(supabase, qrToken, method, locale, promoCode, attemptId)
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

                <div className="mb-3 flex items-center justify-between border-t pt-3">
                  <span className="text-sm text-muted-foreground">{t("checkBillSubtotal")}</span>
                  <span className="text-sm font-bold">{formatVND(unpaidTotal)}</span>
                </div>

                {promoCode ? (
                  <div className="nb-border-sm mb-3 flex items-center justify-between gap-3 rounded-xl bg-chip px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Ticket className="h-4 w-4" />
                      <strong>{promoCode}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={clearPromo}
                      disabled={isSubmitting}
                      aria-label={t("checkBillClose")}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="mb-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Input
                        value={promoInput}
                        onChange={(e) => {
                          setPromoInput(e.target.value)
                          setPromoErrorReason(null)
                        }}
                        disabled={isSubmitting}
                        placeholder={t("checkBillPromoPlaceholder")}
                        className="nb-border-sm h-10 flex-1 rounded-lg"
                      />
                      <Button
                        variant="secondary"
                        className="h-10"
                        onClick={handleApplyPromo}
                        disabled={!promoInput.trim() || isApplyingPromo || isSubmitting}
                      >
                        {t("checkBillApplyPromo")}
                      </Button>
                    </div>
                    {promoErrorReason && (
                      <p className="text-xs text-destructive">{t(PROMO_ERROR_KEY[promoErrorReason])}</p>
                    )}
                  </div>
                )}

                {promoDiscount > 0 && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("checkBillDiscount")}</span>
                    <span className="text-sm font-bold text-success">-{formatVND(promoDiscount)}</span>
                  </div>
                )}

                <div className="mb-4 flex items-center justify-between border-t pt-3">
                  <span className="text-sm text-muted-foreground">{t("checkBillTotal")}</span>
                  <span className="text-xl font-extrabold text-price">{formatVND(totalToPay)}</span>
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
