"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
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
import { requestTableBill } from "@/lib/supabase/table-session-data"

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
  const t = useTranslations("TableSession")
  const [supabase] = useState(() => createClient())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setError(null)
    setIsSubmitting(true)
    try {
      await requestTableBill(supabase, qrToken)
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

                <p className="mb-4 text-sm text-muted-foreground">{t("checkBillCashNotice")}</p>

                {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

                <Button
                  variant="neubrutal"
                  className="h-11 w-full"
                  disabled={isSubmitting}
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
