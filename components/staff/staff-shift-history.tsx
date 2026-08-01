"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { formatVND } from "@/lib/format"
import { useShift } from "@/hooks/useShift"
import type { ShiftReport, ShiftHistoryEntry } from "@/lib/supabase/shift-data"
import { ShiftReportDetail, formatDateTime } from "@/components/admin/shift-report-detail"

export function StaffShiftHistory() {
  const t = useTranslations("AdminShift")
  const locale = useLocale()
  const { getHistory, getReportDetail } = useShift()

  const [history, setHistory] = useState<ShiftHistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedShift, setSelectedShift] = useState<ShiftReport | null>(null)
  const [isLoadingSelected, setIsLoadingSelected] = useState(false)

  useEffect(() => {
    getHistory()
      .then(setHistory)
      .catch(() => setHistoryError(t("historyLoadError")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSelectShift(id: string) {
    setIsLoadingSelected(true)
    setHistoryError(null)
    try {
      const detail = await getReportDetail(id)
      setSelectedShift(detail)
    } catch {
      setHistoryError(t("historyLoadError"))
    } finally {
      setIsLoadingSelected(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <h2 className="text-2xl font-bold text-card-foreground">{t("historyTab")}</h2>

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
    </div>
  )
}
