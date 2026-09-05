"use client"

import { useLocale, useTranslations } from "next-intl"
import { Minus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatVND } from "@/lib/format"
import type { TableSessionCartItem, TableSessionRound } from "@/lib/supabase/table-session-data"

const STATUS_LABEL_KEY: Record<string, string> = {
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
}

export function TableCartPanel({
  cartItems,
  rounds,
  unpaidTotal,
  paymentPending,
  isPlacingRound,
  placeOrderError,
  pendingCartItemIds,
  onUpdateQuantity,
  onRemoveItem,
  onPlaceOrder,
  onOpenCheckBill,
}: {
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isPlacingRound: boolean
  placeOrderError: string | null
  pendingCartItemIds: Set<string>
  onUpdateQuantity: (cartItemId: string, quantity: number) => void
  onRemoveItem: (cartItemId: string) => void
  onPlaceOrder: () => void
  onOpenCheckBill: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("TableSession")

  const draftSubtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

  return (
    <div className="flex flex-col gap-6 px-4 pb-32 pt-4 sm:px-6">
      {paymentPending && (
        <p className="nb-border-sm rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">
          {t("paymentInProgressNote")}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-bold text-card-foreground">{t("draftCartTitle")}</h2>
        {cartItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyDraftCart")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cartItems.map((item) => {
              const isPending = pendingCartItemIds.has(item.id)
              return (
                <div
                  key={item.id}
                  className="nb-border-sm flex items-center justify-between gap-3 rounded-xl bg-card p-3 aria-busy:opacity-60"
                  aria-busy={isPending}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-card-foreground">
                      {locale === "vi" ? item.nameVi : item.nameEn}
                    </p>
                    {item.note && <p className="truncate text-xs italic text-muted-foreground">{item.note}</p>}
                    <span className="text-xs font-bold text-price">{formatVND(item.unitPrice * item.quantity)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                      disabled={isPending}
                      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-background disabled:pointer-events-none"
                      aria-label={t("decreaseQuantityLabel")}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      disabled={isPending}
                      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-background disabled:pointer-events-none"
                      aria-label={t("increaseQuantityLabel")}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={isPending}
                    className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
                    aria-label={t("removeItemLabel")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {placeOrderError && <p className="text-xs text-destructive">{placeOrderError}</p>}
        <Button
          variant="neubrutal"
          className="h-11 w-full"
          disabled={cartItems.length === 0 || paymentPending || isPlacingRound}
          onClick={onPlaceOrder}
        >
          {isPlacingRound ? t("placingOrder") : `${t("placeOrderButton")} · ${formatVND(draftSubtotal)}`}
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold text-card-foreground">{t("runningTabTitle")}</h2>
        {rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRoundsYet")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rounds.map((round, index) => (
              <div key={round.id} className="nb-border-sm rounded-xl bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-card-foreground">{t("roundLabel", { number: index + 1 })}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-secondary">
                    {t(STATUS_LABEL_KEY[round.status] ?? "statusPaid")}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {round.items.map((item, itemIndex) => (
                    <p key={itemIndex} className="text-xs text-muted-foreground">
                      {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                    </p>
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={round.paymentStatus === "paid" ? "text-xs text-muted-foreground" : "text-xs font-bold text-amber-700"}>
                    {round.paymentStatus === "paid" ? t("roundPaymentPaid") : t("roundPaymentUnpaid")}
                  </span>
                  <span className="text-sm font-extrabold text-price">{formatVND(round.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card px-6 py-4 shadow-[0_-4px_12px_-1px_rgba(0,0,0,0.1)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("unpaidTotalLabel")}</span>
            <span className="text-xl font-bold text-primary">{formatVND(unpaidTotal)}</span>
          </div>
          <Button
            variant="neubrutal"
            className="h-12 px-8 text-base"
            disabled={unpaidTotal === 0 || paymentPending}
            onClick={onOpenCheckBill}
          >
            {t("checkBillButton")}
          </Button>
        </div>
      </div>
    </div>
  )
}
