"use client"

import { memo, useState } from "react"
import { useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatOrderId } from "@/lib/format"
import type { KdsOrder } from "@/hooks/useKitchenOrders"
import type { RealPaymentMethod } from "@/lib/supabase/orders-data"
import { PaymentMethodPicker } from "@/components/staff/payment-method-picker"

// Memoized: doesn't depend on the KDS board's once-a-second `now` tick, so
// this should skip re-rendering on every tick as long as its parent passes
// stable `orders`/`onConfirm` references (see kitchen-display.tsx).
function KitchenPendingPaymentComponent({
  orders,
  onConfirm,
}: {
  orders: KdsOrder[]
  onConfirm: (orderId: string, method: RealPaymentMethod) => Promise<void>
}) {
  const t = useTranslations("KitchenDisplay")
  // A single tap confirms payment immediately (no confirm dialog) --
  // tracked per order so a double-tap can't fire two concurrent
  // confirmations for the same order.
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<string>>(new Set())

  async function handleConfirm(orderId: string, method: RealPaymentMethod) {
    setPendingOrderIds((prev) => new Set(prev).add(orderId))
    try {
      await onConfirm(orderId, method)
    } finally {
      setPendingOrderIds((prev) => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  return (
    <aside className="nb-border-sm shrink-0 rounded-xl border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/20">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
        <Banknote className="h-4 w-4" />
        {t("awaitingPaymentTitle", { count: orders.length })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {orders.map((order) => {
          const busy = pendingOrderIds.has(order.id)
          return (
            <div key={order.id} className="nb-border-sm nb-shadow-sm flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm">
              <span className="font-bold">#{formatOrderId(order.id)}</span>
              <span className="text-muted-foreground">
                {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
              </span>
              {order.status === "served" ? (
                <PaymentMethodPicker onSelect={(method) => void handleConfirm(order.id, method)} disabled={busy} />
              ) : (
                <Button variant="neubrutal" disabled={busy} onClick={() => void handleConfirm(order.id, "cash")}>
                  {t("confirmCashReceived")}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export const KitchenPendingPayment = memo(KitchenPendingPaymentComponent)
