"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { BottomSheet } from "@/components/motion/bottom-sheet"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogTitle } from "@/components/ui/dialog"
import { useShift } from "@/hooks/useShift"

type Props = {
  mode: "open" | "close"
  onClose: () => void
}

export function ShiftControlsDialog({ mode, onClose }: Props) {
  const t = useTranslations("KitchenDisplay")
  const tDialog = useTranslations("Dialog")
  const { openShift, closeShift } = useShift()
  const [startingCash, setStartingCash] = useState("")
  const [plannedStart, setPlannedStart] = useState("")
  const [plannedEnd, setPlannedEnd] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOpenSubmit() {
    const amount = Number(startingCash)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await openShift(
        amount,
        plannedStart ? new Date(plannedStart).getTime() : null,
        plannedEnd ? new Date(plannedEnd).getTime() : null
      )
      onClose()
    } catch {
      setError(t("openShiftError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCloseSubmit() {
    const amount = Number(countedCash)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await closeShift(amount, notes.trim() || undefined)
      onClose()
    } catch {
      setError(t("closeShiftError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between border-b p-4">
        <DialogTitle className="text-base font-extrabold text-card-foreground">
          {mode === "open" ? t("openShiftButton") : t("closeShiftButton")}
        </DialogTitle>
        <DialogClose
          aria-label={tDialog("close")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground"
        >
          <X className="h-5 w-5" />
        </DialogClose>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {mode === "open" ? (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("startingCashLabel")}</label>
              <input
                type="number"
                min="0"
                autoFocus
                value={startingCash}
                onChange={(e) => setStartingCash(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("plannedStartLabel")}</label>
              <input
                type="datetime-local"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("plannedEndLabel")}</label>
              <input
                type="datetime-local"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
              />
            </div>
            <Button
              variant="neubrutal"
              className="mt-2 h-11"
              disabled={isSubmitting || startingCash === ""}
              onClick={handleOpenSubmit}
            >
              {t("openShiftButton")}
            </Button>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("countedCashLabel")}</label>
              <input
                type="number"
                min="0"
                autoFocus
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("notesLabel")}</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
              />
            </div>
            <Button
              variant="neubrutal"
              className="mt-2 h-11"
              disabled={isSubmitting || countedCash === ""}
              onClick={handleCloseSubmit}
            >
              {t("closeShiftButton")}
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
