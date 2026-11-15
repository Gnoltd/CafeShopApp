import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { TableSettlementProvider, useTableSettlement } from "./useTableSettlement"
import type { TableSettlementPort } from "@/lib/supabase/order-kds"

describe("TableSettlementProvider / useTableSettlement", () => {
  it("throws when used outside TableSettlementProvider", () => {
    expect(() => renderHook(() => useTableSettlement())).toThrow(
      "useTableSettlement must be used within a TableSettlementProvider"
    )
  })

  it("provides table serving and cash/order settlement through the injected port", async () => {
    const serveOrders = vi.fn(async () => {})
    const settleTable = vi.fn(async () => 3)
    const settleOrder = vi.fn(async () => {})
    const port: TableSettlementPort = { serveOrders, settleTable, settleOrder }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <TableSettlementProvider port={port}>{children}</TableSettlementProvider>
    )
    const { result } = renderHook(() => useTableSettlement(), { wrapper })

    await act(async () => {
      await result.current.serveTableReadyOrders(
        [
          { id: "o-1", tableId: "table-1", status: "ready" },
          { id: "o-2", tableId: "table-1", status: "preparing" },
        ],
        "table-1"
      )
      await result.current.settleTableCash("table-1")
      await result.current.settleOrder({ id: "o-3", orderType: "dine-in", status: "served", tableId: "table-1" })
    })

    expect(serveOrders).toHaveBeenCalledWith(["o-1"])
    expect(settleTable).toHaveBeenCalledWith("table-1", "cash")
    expect(settleOrder).toHaveBeenCalledWith(
      { id: "o-3", orderType: "dine-in", status: "served", tableId: "table-1" },
      "cash"
    )
  })
})
