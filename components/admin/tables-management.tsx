"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import QRCode from "qrcode"
import { QrCode, Download, RefreshCw, Plus, Pencil, Check, X, Grid2x2, CircleCheck, User, ScanLine, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTables } from "@/hooks/useTables"
import { TableForm } from "@/components/admin/table-form"

export function TablesManagement() {
  const locale = useLocale()
  const t = useTranslations("AdminTables")
  const { tables, addTable, renameTable, updateLocation, setStatus, regenerateToken, getQrTokens } = useTables()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftNumber, setDraftNumber] = useState("")
  const [draftLocationVi, setDraftLocationVi] = useState("")
  const [draftLocationEn, setDraftLocationEn] = useState("")
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  // tables.qr_code_token isn't in the shared TablesProvider list at all (see
  // hooks/useTables.tsx) -- this admin-only page fetches it separately via
  // the role-gated get_tables_admin RPC.
  const [tokensById, setTokensById] = useState<Record<string, string>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getQrTokens().then((tokens) => {
      if (!cancelled) setTokensById(tokens)
    })
    return () => {
      cancelled = true
    }
    // Runs once on mount; getQrTokens is stable within a TablesProvider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalScans = tables.reduce((sum, table) => sum + table.scanCount, 0)
  const availableCount = tables.filter((table) => table.status === "available").length
  const occupiedCount = tables.filter((table) => table.status === "occupied").length
  const cleaningCount = tables.filter((table) => table.status === "cleaning").length

  useEffect(() => {
    let cancelled = false
    const origin = window.location.origin

    Promise.all(
      tables
        .filter((table) => tokensById[table.id])
        .map(async (table) => {
          const url = `${origin}/table/${tokensById[table.id]}`
          const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 })
          return [table.id, dataUrl] as const
        })
    ).then((entries) => {
      if (!cancelled) setQrCodes(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [tables, tokensById])

  function downloadQr(tableNumber: string, dataUrl: string) {
    const link = document.createElement("a")
    link.href = dataUrl
    link.download = `table-${tableNumber}-qr.png`
    link.click()
  }

  function startEditing(id: string, currentNumber: string, locationVi: string, locationEn: string) {
    setEditingId(id)
    setDraftNumber(currentNumber)
    setDraftLocationVi(locationVi)
    setDraftLocationEn(locationEn)
  }

  async function saveEditing(id: string) {
    setError(null)
    const trimmed = draftNumber.trim()
    try {
      if (trimmed) await renameTable(id, trimmed)
      await updateLocation(id, draftLocationVi.trim(), draftLocationEn.trim())
      setEditingId(null)
    } catch {
      setError(t("tableNumberTakenError"))
    }
  }

  function cancelEditing() {
    setEditingId(null)
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
        <Button variant="neubrutal" className="h-10 gap-2" onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4" />
          {t("addTable")}
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Grid2x2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("totalTables")}</p>
            <p className="text-xl font-bold text-card-foreground">{tables.length}</p>
          </div>
        </div>
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <CircleCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("available")}</p>
            <p className="text-xl font-bold text-card-foreground">{availableCount}</p>
          </div>
        </div>
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("cleaning")}</p>
            <p className="text-xl font-bold text-card-foreground">{cleaningCount}</p>
          </div>
        </div>
        <div className="nb-border-sm nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("totalScans")}</p>
            <p className="text-xl font-bold text-card-foreground">{totalScans}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((table) => {
          const isEditing = editingId === table.id
          const location = locale === "vi" ? table.locationVi : table.locationEn
          return (
            <div
              key={table.id}
              className={cn(
                "nb-border-sm nb-shadow-sm flex flex-col items-center gap-3 rounded-xl bg-card p-5",
                isEditing && "border-primary"
              )}
            >
              <button
                type="button"
                onClick={() => {
                  const next =
                    table.status === "available" ? "occupied" : table.status === "occupied" ? "cleaning" : "available"
                  setStatus(table.id, next).catch(() => setError(t("updateError")))
                }}
                title={
                  table.status === "available"
                    ? t("markOccupied")
                    : table.status === "occupied"
                      ? t("markCleaning")
                      : t("cleaningDone")
                }
                className={cn(
                  "nb-border-sm nb-press-sm inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                  table.status === "available" && "bg-green-100 text-green-700",
                  table.status === "occupied" && "bg-red-100 text-red-700",
                  table.status === "cleaning" && "bg-amber-100 text-amber-700"
                )}
              >
                {table.status === "available" && <CircleCheck className="h-3 w-3" />}
                {table.status === "occupied" && <User className="h-3 w-3" />}
                {table.status === "cleaning" && <Sparkles className="h-3 w-3" />}
                {table.status === "available" ? t("available") : table.status === "occupied" ? t("occupied") : t("cleaning")}
              </button>

              <div className="nb-border-sm flex h-32 w-32 items-center justify-center rounded-xl bg-chip">
                {qrCodes[table.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrCodes[table.id]}
                    alt={`${t("table")} ${table.number} QR`}
                    className="h-full w-full rounded-xl object-contain p-2"
                  />
                ) : (
                  <QrCode className="h-16 w-16 text-muted-foreground" />
                )}
              </div>

              {isEditing ? (
                <div className="flex w-full flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={draftNumber}
                      onChange={(e) => setDraftNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditing(table.id)
                        if (e.key === "Escape") cancelEditing()
                      }}
                      className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-center font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => saveEditing(table.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                      aria-label={t("save")}
                      title={t("save")}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground"
                      aria-label={t("cancel")}
                      title={t("cancel")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    value={draftLocationVi}
                    onChange={(e) => setDraftLocationVi(e.target.value)}
                    placeholder={t("locationViLabel")}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-center text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    value={draftLocationEn}
                    onChange={(e) => setDraftLocationEn(e.target.value)}
                    placeholder={t("locationEnLabel")}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-center text-xs italic focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-primary">
                      {t("table")} {table.number}
                    </h3>
                    <button
                      type="button"
                      onClick={() => startEditing(table.id, table.number, table.locationVi, table.locationEn)}
                      className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:text-primary"
                      aria-label={t("rename")}
                      title={t("rename")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {location && <p className="text-xs italic text-muted-foreground">{location}</p>}
                </div>
              )}

              <p className="font-mono text-[10px] text-muted-foreground">{tokensById[table.id]}</p>
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                <Button
                  variant="neubrutal"
                  size="sm"
                  className="h-9 w-full gap-1.5 sm:flex-1"
                  disabled={!qrCodes[table.id]}
                  onClick={() => downloadQr(table.number, qrCodes[table.id])}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("downloadQr")}
                </Button>
                <Button
                  variant="neubrutal"
                  size="sm"
                  className="h-9 w-full gap-1.5 bg-secondary sm:flex-1"
                  onClick={() =>
                    regenerateToken(table.id)
                      .then((updated) => {
                        if (updated.qrToken) {
                          setTokensById((prev) => ({ ...prev, [table.id]: updated.qrToken! }))
                        }
                      })
                      .catch(() => setError(t("updateError")))
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("regenerateCode")}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {showAddForm && (
        <TableForm
          onCancel={() => setShowAddForm(false)}
          onSave={async (input) => {
            await addTable(input)
            setShowAddForm(false)
          }}
        />
      )}
    </div>
  )
}
