"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useOptionalKitchenOrdersRefetch } from "@/hooks/useKitchenOrders"
import {
  createSupabaseTableSettlementAdapter,
  type KdsOrderRow,
  type SettleableOrder,
  type TableSettlementPort,
} from "@/lib/supabase/order-kds"
import type { RealPaymentMethod } from "@/lib/supabase/order-mapping"

/**
 * Returns IDs of `"ready"` orders, optionally scoped to a specific `tableId`.
 */
export function selectReadyOrderIds(
  orders: readonly Pick<KdsOrderRow, "id" | "status" | "tableId">[],
  tableId?: string
): string[] {
  return orders
    .filter((order) => order.status === "ready" && (tableId === undefined || order.tableId === tableId))
    .map((order) => order.id)
}

/**
 * Returns orders belonging to `tableId` whose payment status is still `"pending"`.
 */
export function selectAwaitingPaymentOrders<T extends Pick<KdsOrderRow, "tableId" | "paymentStatus">>(
  orders: readonly T[],
  tableId: string
): T[] {
  return orders.filter((order) => order.tableId === tableId && order.paymentStatus === "pending")
}

export type TableSettlementActions = {
  serveTableReadyOrders: (
    orders: readonly Pick<KdsOrderRow, "id" | "status" | "tableId">[],
    tableId?: string
  ) => Promise<void>
  settleTableCash: (tableId: string) => Promise<void>
  settleOrder: (order: SettleableOrder, method?: RealPaymentMethod) => Promise<void>
}

/**
 * Builds table-serving and payment-settlement actions over a `TableSettlementPort`.
 */
export function createTableSettlementActions(
  port: TableSettlementPort,
  onSettled?: () => Promise<void> | void
): TableSettlementActions {
  return {
    async serveTableReadyOrders(orders, tableId) {
      const readyOrderIds = selectReadyOrderIds(orders, tableId)
      if (readyOrderIds.length === 0) return
      await port.serveOrders(readyOrderIds)
      await onSettled?.()
    },
    async settleTableCash(tableId) {
      await port.settleTable(tableId, "cash")
      await onSettled?.()
    },
    async settleOrder(order, method = "cash") {
      await port.settleOrder(order, method)
      await onSettled?.()
    },
  }
}

const TableSettlementContext = createContext<TableSettlementActions | null>(null)

/**
 * Provides staff table serving and cash/legacy order settlement actions.
 */
export function TableSettlementProvider({
  children,
  port,
}: {
  children: ReactNode
  port?: TableSettlementPort
}) {
  const [defaultPort] = useState<TableSettlementPort>(
    () => port ?? createSupabaseTableSettlementAdapter(createClient())
  )
  const activePort = port ?? defaultPort
  const refetchKitchenOrders = useOptionalKitchenOrdersRefetch()
  const value = useMemo(
    () => createTableSettlementActions(activePort, refetchKitchenOrders),
    [activePort, refetchKitchenOrders]
  )

  return <TableSettlementContext.Provider value={value}>{children}</TableSettlementContext.Provider>
}

export function useTableSettlement(): TableSettlementActions {
  const ctx = useContext(TableSettlementContext)
  if (!ctx) throw new Error("useTableSettlement must be used within a TableSettlementProvider")
  return ctx
}
