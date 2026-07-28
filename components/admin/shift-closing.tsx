"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Wallet, History, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatVND } from "@/lib/format"
import { useShift } from "@/hooks/useShift"
import { getShiftReport, getShiftHistory, type ShiftReport, type ShiftHistoryEntry } from "@/lib/supabase/shift-data"
import { ShiftReportDetail, formatDateTime } from "@/components/admin/shift-report-detail"

type Tab = "current" | "history"

export function ShiftClosing() {
  const t = useTranslations("AdminShift")
  const locale = useLocale()
  const { supabase, report, isLoading, openShift, closeShift } = useShift()
  const [tab, setTab] = useState<Tab>("current")
  const [startingCashInput, setStartingCashInput] = useState("")
  const [plannedStartInput, setPlannedStartInput] = useState("")
  const [plannedEndInput, setPlannedEndInput] = useState("")
  const [countedCashInput, setCountedCashInput] = useState("")
  const [notesInput, setNotesInput] = useState("")
  const [closedSummary, setClosedSummary] = useState<ShiftReport | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<ShiftHistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedShift, setSelectedShift] = useState<ShiftReport | null>(null)
  const [isLoadingSelected, setIsLoadingSelected] = useState(false)

  useEffect(() => {
    if (tab !== "history" || history !== null) return
    getShiftHistory(supabase)
      .then(setHistory)
      .catch(() => setHistoryError(t("historyLoadError")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleOpen() {
    const amount = Number(startingCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await openShift(
        Math.round(amount),
        plannedStartInput ? new Date(plannedStartInput).getTime() : null,
        plannedEndInput ? new Date(plannedEndInput).getTime() : null
      )
      setStartingCashInput("")
      setPlannedStartInput("")
      setPlannedEndInput("")
      setClosedSummary(null)
    } catch {
      setError(t("openError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleClose() {
    const amount = Number(countedCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      const summary = await closeShift(Math.round(amount), notesInput.trim() || undefined)
      setClosedSummary(summary)
      setCountedCashInput("")
      setNotesInput("")
      setHistory(null)
    } catch {
      setError(t("closeError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSelectShift(id: string) {
    setIsLoadingSelected(true)
    setHistoryError(null)
    try {
      const detail = await getShiftReport(supabase, id)
      setSelectedShift(detail)
    } catch {
      setHistoryError(t("historyLoadError"))
    } finally {
      setIsLoadingSelected(false)
    }
  }

  const active = report

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
        <div className="nb-border-sm nb-shadow-sm flex gap-1 rounded-xl bg-card p-1">
          <button
            type="button"
            onClick={() => setTab("current")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold ${
              tab === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" />
            {t("currentTab")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("history")
              setSelectedShift(null)
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold ${
              tab === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <History className="h-4 w-4" />
            {t("historyTab")}
          </button>
        </div>
      </div>

      {tab === "current" ? (
        <>
          {isLoading ? (
            <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
          ) : (
            <>
              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

              {closedSummary && !active && (
                <section>
                  <h3 className="mb-3 text-lg font-bold text-card-foreground">{t("closedSummaryTitle")}</h3>
                  <ShiftReportDetail report={closedSummary} locale={locale} />
                </section>
              )}

              {!active ? (
                <section className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
                  <h3 className="mb-1 flex items-center gap-2 font-extrabold text-card-foreground">
                    <Wallet className="h-5 w-5 text-primary" />
                    {t("noShiftTitle")}
                  </h3>
                  <label className="mb-1 mt-3 block text-xs font-medium text-muted-foreground">
                    {t("startingCashLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      min="0"
                      value={startingCashInput}
                      onChange={(e) => setStartingCashInput(e.target.value)}
                      className="nb-border-sm h-11 w-full max-w-xs rounded-xl bg-card px-4 text-card-foreground"
                    />
                    <Button variant="neubrutal" className="h-11" disabled={isSubmitting || startingCashInput === ""} onClick={handleOpen}>
                      {t("openShiftButton")}
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t("plannedStartLabel")}
                      </label>
                      <input
                        type="datetime-local"
                        value={plannedStartInput}
                        onChange={(e) => setPlannedStartInput(e.target.value)}
                        className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t("plannedEndLabel")}
                      </label>
                      <input
                        type="datetime-local"
                        value={plannedEndInput}
                        onChange={(e) => setPlannedEndInput(e.target.value)}
                        className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
                      />
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <ShiftReportDetail report={active} locale={locale} />

                  <section className="nb-border-sm nb-shadow-sm rounded-xl bg-card p-5">
                    <h3 className="mb-3 font-extrabold text-card-foreground">{t("closeShiftTitle")}</h3>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {t("countedCashLabel")}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={countedCashInput}
                          onChange={(e) => setCountedCashInput(e.target.value)}
                          className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {t("notesLabel")}
                        </label>
                        <input
                          value={notesInput}
                          onChange={(e) => setNotesInput(e.target.value)}
                          className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground"
                        />
                      </div>
                      <Button variant="neubrutal" className="h-11" disabled={isSubmitting || countedCashInput === ""} onClick={handleClose}>
                        {t("closeShiftButton")}
                      </Button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {historyError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{historyError}</p>
          )}

          {selectedShift ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedShift(null)}
                className="flex w-fit items-center gap-1 text-sm font-bold text-primary hover:underline"
              >
                <ChevronLeft className="h-4 w-4" />
                {t("backToHistory")}
              </button>
              <ShiftReportDetail report={selectedShift} locale={locale} />
            </>
          ) : isLoadingSelected ? (
            <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
          ) : history === null ? (
            <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
          ) : history.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <section className="nb-border-sm nb-shadow-sm overflow-hidden rounded-xl bg-card">
              {history.map((shift) => (
                <button
                  key={shift.id}
                  type="button"
                  onClick={() => handleSelectShift(shift.id)}
                  className="flex w-full items-center justify-between border-b-2 border-ink/15 p-4 text-left last:border-0"
                >
                  <div>
                    <p className="font-bold text-card-foreground">
                      {formatDateTime(shift.openedAt, locale)} — {formatDateTime(shift.closedAt, locale)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("totalRevenueStat")}: {formatVND(shift.totalRevenue)}
                    </p>
                    {(shift.openedByName || shift.closedByName) && (
                      <p className="text-xs text-muted-foreground">
                        {shift.openedByName && <>{t("openedByLabel")}: {shift.openedByName}</>}
                        {shift.openedByName && shift.closedByName && " · "}
                        {shift.closedByName && <>{t("closedByLabel")}: {shift.closedByName}</>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <p
                      className={
                        shift.difference === 0
                          ? "text-sm font-bold text-green-600"
                          : shift.difference > 0
                            ? "text-sm font-bold text-amber-600"
                            : "text-sm font-bold text-destructive"
                      }
                    >
                      {shift.difference === 0
                        ? t("differenceExact")
                        : `${shift.difference > 0 ? t("differenceOver") : t("differenceShort")} ${formatVND(Math.abs(shift.difference))}`}
                    </p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
