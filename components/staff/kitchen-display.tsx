"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { KitchenStatsFooter } from "@/components/staff/kitchen-stats-footer"
import { KitchenBoard } from "@/components/staff/kitchen-board"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export function KitchenDisplay() {
  const { orders, pendingPaymentOrders, advanceItem, isItemPending, confirmCashPayment } = useKitchenOrders()
  const t = useTranslations("KitchenDisplay")
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const immediate = setTimeout(() => setNow(Date.now()), 0)
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearTimeout(immediate)
      clearInterval(interval)
    }
  }, [])

  // Stable references so KitchenPendingPayment/KitchenTablesColumn (memoized
  // below and in their own files) can actually skip re-rendering on the
  // once-a-second `now` tick, instead of getting a fresh closure every time.
  const handleAdvanceItem = useCallback(
    (orderId: string, itemId: string) => {
      setError(null)
      advanceItem(orderId, itemId).catch(() => setError(t("updateError")))
    },
    [advanceItem, t]
  )

  const handleConfirmCashPayment = useCallback(
    (orderId: string) => {
      setError(null)
      return confirmCashPayment(orderId).catch((err) => {
        setError(t("updateError"))
        // Rethrow so the ConfirmDialog in KitchenPendingPayment catches it
        // too and keeps itself open instead of closing as if it worked.
        throw err
      })
    },
    [confirmCashPayment, t]
  )

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      {error && (
        <p className="shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {pendingPaymentOrders.length > 0 && (
        <KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={handleConfirmCashPayment} />
      )}
      <div className="flex-1 overflow-hidden">
        <KitchenBoard orders={orders} now={now} onAdvanceItem={handleAdvanceItem} isItemPending={isItemPending} />
      </div>
      <KitchenStatsFooter orders={orders} now={now} />
    </div>
  )
}
