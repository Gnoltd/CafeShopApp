"use client"

import { memo, useState } from "react"
import { useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { formatOrderId } from "@/lib/format"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

// Memoized: doesn't depend on the KDS board's once-a-second `now` tick, so
// this should skip re-rendering on every tick as long as its parent passes
// stable `orders`/`onConfirm` references (see kitchen-display.tsx).
function KitchenPendingPaymentComponent({
  orders,
  onConfirm,
}: {
  orders: KdsOrder[]
  onConfirm: (orderId: string) => Promise<void>
}) {
  const t = useTranslations("KitchenDisplay")
  // Confirming cash marks the order paid with no staff-facing undo on this
  // surface, so the tap only stages the order and the dialog commits it.
  const [orderPendingConfirm, setOrderPendingConfirm] = useState<KdsOrder | null>(null)

  return (
    <aside className="nb-border-sm shrink-0 rounded-xl border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/20">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
        <Banknote className="h-4 w-4" />
        {t("awaitingPaymentTitle", { count: orders.length })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {orders.map((order) => (
          <div key={order.id} className="nb-border-sm nb-shadow-sm flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm">
            <span className="font-bold">#{formatOrderId(order.id)}</span>
            <span className="text-muted-foreground">
              {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
            </span>
            <Button variant="neubrutal" onClick={() => setOrderPendingConfirm(order)}>
              {t("confirmCashReceived")}
            </Button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={orderPendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setOrderPendingConfirm(null)
        }}
        title={t("confirmCashTitle")}
        description={t("confirmCashBody", {
          order: orderPendingConfirm ? formatOrderId(orderPendingConfirm.id) : "",
        })}
        confirmLabel={t("confirmCashReceived")}
        onConfirm={async () => {
          if (orderPendingConfirm) await onConfirm(orderPendingConfirm.id)
        }}
      />
    </aside>
  )
}

export const KitchenPendingPayment = memo(KitchenPendingPaymentComponent)
