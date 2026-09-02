"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { KitchenStatsFooter } from "@/components/staff/kitchen-stats-footer"
import { KitchenBoard } from "@/components/staff/kitchen-board"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export function KitchenDisplay() {
  const { orders, pendingPaymentOrders, advanceItem, confirmCashPayment } = useKitchenOrders()
  const t = useTranslations("KitchenDisplay")
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  function handleAdvanceItem(orderId: string, itemId: string) {
    setError(null)
    advanceItem(orderId, itemId).catch(() => setError(t("updateError")))
  }

  function handleConfirmCashPayment(orderId: string) {
    setError(null)
    return confirmCashPayment(orderId).catch(() => setError(t("updateError")))
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      {error && (
        <p className="shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {pendingPaymentOrders.length > 0 && (
        <KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={handleConfirmCashPayment} />
      )}
      <div className="flex-1 overflow-hidden">
        <KitchenBoard orders={orders} now={now} onAdvanceItem={handleAdvanceItem} />
      </div>
      <KitchenStatsFooter orders={orders} now={now} />
    </div>
  )
}
