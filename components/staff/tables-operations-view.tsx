"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import QRCode from "qrcode"
import {
  QrCode,
  Download,
  RefreshCw,
  Plus,
  Pencil,
  Check,
  X,
  Grid2x2,
  CircleCheck,
  User,
  ScanLine,
  Utensils,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useTables } from "@/hooks/useTables"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { ConfirmCashPayment } from "@/components/staff/confirm-cash-payment"
import { TableForm } from "@/components/staff/table-form"

// Staff "Operations" area, Tables tab (Task 16 merge): table list + binary
// open-session badge + "Xác nhận đã thu tiền"/"Served" actions (moved
// wholesale from the old KDS board's 4th column, kitchen-tables-column.tsx)
// combined with table CRUD (add/rename/QR view/regenerate token, moved from
// components/admin/tables-management.tsx + table-form.tsx). Reachable by
// staff|manager|admin alike (previously CRUD was manager/admin-only under
// /admin/tables) -- see app/[locale]/staff/tables/page.tsx.
export function TablesOperationsView() {
  const locale = useLocale()
  const t = useTranslations("AdminTables")
  const tKds = useTranslations("KitchenDisplay")
  const { tables, openSessionTableIds, addTable, renameTable, updateLocation, regenerateToken, getQrTokens } =
    useTables()
  const { orders, serveTable, confirmTablePayment } = useKitchenOrders()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftNumber, setDraftNumber] = useState("")
  const [draftLocationVi, setDraftLocationVi] = useState("")
  const [draftLocationEn, setDraftLocationEn] = useState("")
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  // tables.qr_code_token isn't in the shared TablesProvider list at all (see
  // hooks/useTables.tsx) -- this view fetches it separately via the
  // role-gated get_tables_admin RPC. get_tables_admin/regenerate_table_qr_token
  // already allow plain `staff` (not just manager/admin) as of migration
  // 0046 -- this route's staff|manager|admin gate matches what the DB
  // already permitted, no backend change needed for this merge.
  const [tokensById, setTokensById] = useState<Record<string, string>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Regenerating a token silently kills every already-printed QR code sitting
  // on a physical table, so the button only stages the table id here and the
  // confirmation dialog below does the actual regeneration.
  const [tableIdPendingRegen, setTableIdPendingRegen] = useState<string | null>(null)
  // Keyed "<tableId>:serve" / "<tableId>:pay" -- disables only the tapped
  // table's own action button while its mutation is in flight, so a
  // double-tap can't fire two concurrent RPCs for the same table.
  const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(new Set())

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
  const inServiceCount = tables.filter((table) => openSessionTableIds.has(table.id)).length
  const availableCount = tables.length - inServiceCount

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

  async function runTableAction(key: string, action: () => Promise<void>) {
    setError(null)
    setPendingActionKeys((prev) => new Set(prev).add(key))
    try {
      await action()
    } catch {
      setError(tKds("updateError"))
    } finally {
      setPendingActionKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <User className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tKds("tableInService")}</p>
            <p className="text-xl font-bold text-card-foreground">{inServiceCount}</p>
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
          const hasOpenSession = openSessionTableIds.has(table.id)
          const tableOrders = orders.filter((o) => o.tableId === table.id)
          const readyOrderIds = tableOrders.filter((o) => o.status === "ready").map((o) => o.id)
          // A running tab can have several unpaid rounds sharing one payment
          // method once Check Bill has been tapped -- "awaiting payment"
          // isn't scoped to status === "served" here, and also includes
          // rounds with no payment_method chosen yet (paymentMethod ===
          // null): a table round starts with no method and only gets one
          // once Check Bill is tapped, so this is the only signal staff have
          // that money is owed on this table at all if a guest never taps it.
          const awaitingPaymentOrders = tableOrders.filter((o) => o.paymentStatus === "pending")

          return (
            <div
              key={table.id}
              className={cn(
                "nb-border-sm nb-shadow-sm flex flex-col items-center gap-3 rounded-xl bg-card p-5",
                isEditing && "border-primary"
              )}
            >
              <span
                className={cn(
                  "nb-border-sm inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                  hasOpenSession ? "bg-primary/10 text-primary" : "bg-green-100 text-green-700"
                )}
              >
                {hasOpenSession ? <User className="h-3 w-3" /> : <CircleCheck className="h-3 w-3" />}
                {hasOpenSession ? tKds("tableInService") : tKds("tableAvailable")}
              </span>

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
                  onClick={() => setTableIdPendingRegen(table.id)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("regenerateCode")}
                </Button>
              </div>

              {awaitingPaymentOrders.length > 0 && (
                <span className="flex items-center gap-1 self-start text-[10px] font-bold text-amber-700">
                  <Wallet className="h-3 w-3" />
                  {tKds("tableAwaitingPaymentCount", { count: awaitingPaymentOrders.length })}
                </span>
              )}
              {readyOrderIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void runTableAction(`${table.id}:serve`, () => serveTable(readyOrderIds))}
                  disabled={pendingActionKeys.has(`${table.id}:serve`)}
                  className="nb-border-sm nb-shadow-sm nb-press-sm flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground disabled:opacity-60"
                >
                  <Utensils className="h-3 w-3" />
                  {tKds("markServed")}
                </button>
              )}
              {awaitingPaymentOrders.length > 0 && (
                <ConfirmCashPayment
                  className="w-full"
                  disabled={pendingActionKeys.has(`${table.id}:pay`)}
                  onSelect={(method) =>
                    void runTableAction(`${table.id}:pay`, () => confirmTablePayment(table.id, method))
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={tableIdPendingRegen !== null}
        onOpenChange={(open) => {
          if (!open) setTableIdPendingRegen(null)
        }}
        destructive
        title={t("regenerateConfirmTitle")}
        description={t("regenerateConfirmBody", {
          table: tables.find((table) => table.id === tableIdPendingRegen)?.number ?? "",
        })}
        confirmLabel={t("regenerateCode")}
        onConfirm={async () => {
          const id = tableIdPendingRegen
          if (!id) return
          try {
            const updated = await regenerateToken(id)
            if (updated.qrToken) {
              setTokensById((prev) => ({ ...prev, [id]: updated.qrToken! }))
            }
          } catch (err) {
            setError(t("updateError"))
            // Rethrow so ConfirmDialog's own catch keeps the dialog open
            // and shows the failure, instead of closing as if it worked.
            throw err
          }
        }}
      />

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
