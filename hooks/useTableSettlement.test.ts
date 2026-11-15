import { describe, expect, it, vi } from "vitest"
import {
  createTableSettlementActions,
  selectAwaitingPaymentOrders,
  selectReadyOrderIds,
} from "./useTableSettlement"
import type { TableSettlementPort } from "@/lib/supabase/order-kds"

function makePort() {
  const serveOrders = vi.fn(async () => {})
  const settleTable = vi.fn(async () => 2)
  const settleOrder = vi.fn(async () => {})
  const port: TableSettlementPort = {
    serveOrders,
    settleTable,
    settleOrder,
  }
  return { port, serveOrders, settleTable, settleOrder }
}

describe("selectReadyOrderIds", () => {
  const orders = [
    { id: "ord-1", tableId: "table-1", status: "ready" as const },
    { id: "ord-2", tableId: "table-1", status: "preparing" as const },
    { id: "ord-3", tableId: "table-2", status: "ready" as const },
  ]

  it("filters to ready orders for a specific table when tableId is provided", () => {
    expect(selectReadyOrderIds(orders, "table-1")).toEqual(["ord-1"])
  })

  it("returns all ready orders when tableId is omitted", () => {
    expect(selectReadyOrderIds(orders)).toEqual(["ord-1", "ord-3"])
  })
})

describe("selectAwaitingPaymentOrders", () => {
  it("returns pending-payment orders scoped to the target table", () => {
    const orders = [
      { id: "ord-1", tableId: "table-1", paymentStatus: "pending" },
      { id: "ord-2", tableId: "table-1", paymentStatus: "paid" },
      { id: "ord-3", tableId: "table-2", paymentStatus: "pending" },
    ]
    expect(selectAwaitingPaymentOrders(orders, "table-1")).toEqual([
      { id: "ord-1", tableId: "table-1", paymentStatus: "pending" },
    ])
  })
})

describe("createTableSettlementActions", () => {
  it("serves ready orders for a given table and no-ops when none are ready", async () => {
    const { port, serveOrders } = makePort()
    const actions = createTableSettlementActions(port)
    const orders = [
      { id: "ord-1", tableId: "table-1", status: "ready" as const },
      { id: "ord-2", tableId: "table-1", status: "served" as const },
      { id: "ord-3", tableId: "table-2", status: "ready" as const },
    ]

    await actions.serveTableReadyOrders(orders, "table-1")
    expect(serveOrders).toHaveBeenCalledTimes(1)
    expect(serveOrders).toHaveBeenCalledWith(["ord-1"])

    serveOrders.mockClear()
    await actions.serveTableReadyOrders(orders, "table-empty")
    expect(serveOrders).not.toHaveBeenCalled()
  })

  it("settleTableCash settles the table with cash", async () => {
    const { port, settleTable } = makePort()
    const actions = createTableSettlementActions(port)

    await actions.settleTableCash("table-1")

    expect(settleTable).toHaveBeenCalledWith("table-1", "cash")
  })

  it("settleOrder delegates to the settlement port with cash default or explicit method", async () => {
    const { port, settleOrder } = makePort()
    const actions = createTableSettlementActions(port)
    const order = { id: "ord-1", orderType: "pickup" as const, status: "served" as const }

    await actions.settleOrder(order)
    expect(settleOrder).toHaveBeenCalledWith(order, "cash")

    await actions.settleOrder(order, "stripe")
    expect(settleOrder).toHaveBeenCalledWith(order, "stripe")
  })
})
