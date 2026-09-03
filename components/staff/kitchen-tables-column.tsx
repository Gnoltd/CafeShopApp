"use client"

import { memo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Bell, CircleCheck, Sparkles, User, Utensils, Wallet } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useTables } from "@/hooks/useTables"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

// Memoized: its only prop (`active`) rarely changes, so this skips
// re-rendering when the sibling order columns re-render on the KDS board's
// once-a-second `now` tick -- this component doesn't show elapsed time and
// has no dependency on `now` at all. Its own data (tables/orders) still
// comes from hooks inside it, so a real Realtime update still re-renders it
// normally; memo only blocks re-renders caused by an unrelated parent prop.
function KitchenTablesColumnComponent({ active }: { active: boolean }) {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const { tables, setStatus } = useTables()
  const {
    orders,
    serveTable,
    confirmTableCashPayment,
    markTableCashPayment,
  } = useKitchenOrders()
  const [error, setError] = useState<string | null>(null)
  // Same reasoning as the pending-payment strip: confirming cash settles the
  // table's whole tab with no undo here, so it goes through a confirmation.
  const [tablePendingCashConfirm, setTablePendingCashConfirm] = useState<{ id: string; number: string } | null>(
    null
  )
  // Keyed "<tableId>:serve" / "<tableId>:cash" -- disables only the tapped
  // table's own action button while its mutation is in flight, so a
  // double-tap can't fire two concurrent RPCs for the same table.
  const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(new Set())

  async function runTableAction(key: string, action: () => Promise<void>) {
    setError(null)
    setPendingActionKeys((prev) => new Set(prev).add(key))
    try {
      await action()
    } catch {
      setError(t("updateError"))
    } finally {
      setPendingActionKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <section
      className={cn(
        "nb-border-sm min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-muted",
        active ? "flex" : "hidden",
        "md:h-full md:flex"
      )}
    >
      <header className="flex shrink-0 items-center justify-between bg-zinc-600 p-4 text-white">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {t("columnTables")}
          <span className="rounded bg-white/20 px-2 py-0.5 text-sm">{tables.length}</span>
        </h2>
      </header>
      {error && (
        <p className="mx-3 mt-2 shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 overflow-y-auto p-3">
        {tables.map((table) => {
          const location = locale === "vi" ? table.locationVi : table.locationEn
          const tableOrders = orders.filter((o) => o.tableId === table.id)
          const readyOrderIds = tableOrders.filter((o) => o.status === "ready").map((o) => o.id)
          // A running tab can have several unpaid rounds sharing one
          // payment method once Check Bill has been tapped -- unlike the
          // single-order deferred-payment flow this widens, "awaiting
          // payment" isn't scoped to status === "served" here (design
          // doc Goal 4 / Q15: Check Bill can be tapped before every
          // round is served).
          // I-3: also include rounds with no payment_method chosen yet
          // (paymentMethod === null) -- a table round starts with no
          // method and only gets one once Check Bill is tapped. If a
          // guest never taps it, this badge is the only signal staff
          // have that money is owed on this table at all.
          const awaitingPaymentOrders = tableOrders.filter((o) => o.paymentStatus === "pending")
          const awaitingPaymentMethod = awaitingPaymentOrders[0]?.paymentMethod ?? null

          return (
            <div
              key={table.id}
              className={cn(
                "nb-border-sm flex flex-wrap items-start justify-between gap-2 rounded-lg p-3",
                table.status === "available" && "bg-green-50 dark:bg-green-950/20",
                table.status === "occupied" && "bg-red-50 dark:bg-red-950/20",
                table.status === "cleaning" && "bg-amber-50 dark:bg-amber-950/20"
              )}
            >
              <div className="min-w-0">
                <p className="break-words font-bold text-card-foreground">{table.number}</p>
                {location && <p className="break-words text-xs text-muted-foreground">{location}</p>}
              </div>
              <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    const next = table.status === "available" ? "occupied" : table.status === "occupied" ? "cleaning" : "available"
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
                    "nb-border-sm nb-shadow-sm nb-press-sm inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-extrabold",
                    table.status === "available" && "bg-green-100 text-green-700 hover:bg-green-200",
                    table.status === "occupied" && "bg-red-100 text-red-700 hover:bg-red-200",
                    table.status === "cleaning" && "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  )}
                >
                  {table.status === "available" && <CircleCheck className="h-4 w-4" />}
                  {table.status === "occupied" && <User className="h-4 w-4" />}
                  {table.status === "cleaning" && <Sparkles className="h-4 w-4" />}
                  {table.status === "available"
                    ? t("tableAvailable")
                    : table.status === "occupied"
                      ? t("tableOccupied")
                      : t("tableCleaning")}
                </button>
                {table.status === "cleaning" && table.cleaningNotifiedAt && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-destructive">
                    <Bell className="h-3 w-3 animate-pulse" />
                    {t("guestNotified")}
                  </span>
                )}
                {awaitingPaymentOrders.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700">
                    <Wallet className="h-3 w-3" />
                    {t("tableAwaitingPaymentCount", { count: awaitingPaymentOrders.length })}
                  </span>
                )}
                {readyOrderIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void runTableAction(`${table.id}:serve`, () => serveTable(readyOrderIds))}
                    disabled={pendingActionKeys.has(`${table.id}:serve`)}
                    className="nb-border-sm nb-shadow-sm nb-press-sm flex min-h-10 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground disabled:opacity-60"
                  >
                    <Utensils className="h-3 w-3" />
                    {t("markServed")}
                  </button>
                )}
                {awaitingPaymentOrders.length > 0 && awaitingPaymentMethod === null && (
                  <button
                    type="button"
                    onClick={() => void runTableAction(`${table.id}:cash`, () => markTableCashPayment(table.id))}
                    disabled={pendingActionKeys.has(`${table.id}:cash`)}
                    className="nb-border-sm nb-shadow-sm nb-press-sm min-h-10 rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground disabled:opacity-60"
                  >
                    {t("markCash")}
                  </button>
                )}
                {awaitingPaymentMethod === "cash" && (
                  <button
                    type="button"
                    onClick={() =>
                      setTablePendingCashConfirm({ id: table.id, number: table.number })
                    }
                    className="nb-border-sm nb-shadow-sm nb-press-sm min-h-10 rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground"
                  >
                    {t("confirmCashReceived")}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={tablePendingCashConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setTablePendingCashConfirm(null)
        }}
        title={t("confirmCashTitle")}
        description={t("confirmTableCashBody", { table: tablePendingCashConfirm?.number ?? "" })}
        confirmLabel={t("confirmCashReceived")}
        onConfirm={async () => {
          if (!tablePendingCashConfirm) return
          setError(null)
          try {
            await confirmTableCashPayment(tablePendingCashConfirm.id)
          } catch (err) {
            setError(t("updateError"))
            // Rethrow so ConfirmDialog's own catch keeps the dialog open
            // and shows the failure, instead of closing as if it worked.
            throw err
          }
        }}
      />
    </section>
  )
}

export const KitchenTablesColumn = memo(KitchenTablesColumnComponent)
