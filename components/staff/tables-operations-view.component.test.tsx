import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TablesOperationsView } from "./tables-operations-view"
import { KitchenOrdersProvider, type KdsOrder } from "@/hooks/useKitchenOrders"
import { TableSettlementProvider } from "@/hooks/useTableSettlement"
import type { KdsPreparationPort, TableSettlementPort } from "@/lib/supabase/order-kds"

const mocks = vi.hoisted(() => ({
  getQrTokens: vi.fn(() => Promise.resolve({})),
  tables: [
    {
      id: "table-1",
      number: "T1",
      locationVi: "",
      locationEn: "Patio",
      status: "occupied" as const,
      scanCount: 0,
      cleaningNotifiedAt: null,
    },
  ],
  openSessionTableIds: new Set(["table-1"]),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}(${JSON.stringify(values)})` : `${namespace}.${key}`,
}))
vi.mock("@/hooks/useTables", () => ({
  useTables: () => ({
    tables: mocks.tables,
    openSessionTableIds: mocks.openSessionTableIds,
    addTable: vi.fn(),
    renameTable: vi.fn(),
    updateLocation: vi.fn(),
    regenerateToken: vi.fn(),
    getQrTokens: mocks.getQrTokens,
  }),
}))

function createInMemoryStaffOrdersStore(initialOrders: KdsOrder[]) {
  const orders = structuredClone(initialOrders)

  const kdsPort: KdsPreparationPort = {
    getKitchenOrders: vi.fn(async () =>
      structuredClone(orders.filter((o) => !(o.status === "served" && o.paymentStatus === "paid")))
    ),
    getPendingPaymentOrders: vi.fn(async () => []),
    updateItemStatus: vi.fn(async (itemId, status) => {
      for (const order of orders) {
        for (const item of order.items) {
          if (item.id === itemId) item.status = status
        }
      }
    }),
    markOrdersServed: vi.fn(async (orderIds) => {
      for (const order of orders) {
        if (orderIds.includes(order.id)) {
          order.status = "served"
          for (const item of order.items) item.status = "served"
        }
      }
    }),
    recallLastCompletedOrder: vi.fn(async () => undefined),
  }

  const settlementPort: TableSettlementPort = {
    serveOrders: vi.fn(async (orderIds) => {
      await kdsPort.markOrdersServed(orderIds)
    }),
    settleTable: vi.fn(async (tableId, method = "cash") => {
      let count = 0
      for (const order of orders) {
        if (order.tableId === tableId && order.paymentStatus === "pending") {
          order.paymentStatus = "paid"
          order.paymentMethod = method
          count += 1
        }
      }
      return count
    }),
    settleOrder: vi.fn(async (order, method = "cash") => {
      const target = orders.find((o) => o.id === order.id)
      if (target) {
        target.paymentStatus = "paid"
        target.paymentMethod = method
      }
    }),
  }

  return {
    kdsPort,
    settlementPort,
    getOrders: () => orders,
  }
}

const initialOrders: KdsOrder[] = [
  {
    id: "order-1",
    orderType: "dine-in",
    tableId: "table-1",
    status: "ready",
    paymentStatus: "paid",
    paymentMethod: "cash",
    createdAt: 1,
    total: 30_000,
    items: [
      {
        id: "item-1",
        nameVi: "Cà phê",
        nameEn: "Coffee",
        quantity: 1,
        note: null,
        status: "ready",
        sizeName: null,
        modifierNames: [],
      },
    ],
  },
  {
    id: "order-2",
    orderType: "dine-in",
    tableId: "table-1",
    status: "served",
    paymentStatus: "pending",
    paymentMethod: null,
    createdAt: 2,
    total: 20_000,
    items: [
      {
        id: "item-2",
        nameVi: "Trà đào",
        nameEn: "Peach Tea",
        quantity: 1,
        note: null,
        status: "served",
        sizeName: null,
        modifierNames: [],
      },
    ],
  },
]

describe("TablesOperationsView (Seam 2: real KitchenOrdersProvider & TableSettlementProvider + ports)", () => {
  beforeEach(() => {
    mocks.getQrTokens.mockClear()
  })

  it("marks ready KDS Tickets on a Table as served, blocks duplicate taps while pending, and removes the Mark Served action once served", async () => {
    const store = createInMemoryStaffOrdersStore(initialOrders)
    let resolveServe!: () => void
    vi.mocked(store.settlementPort.serveOrders).mockImplementationOnce(
      (orderIds) =>
        new Promise<void>((resolve) => {
          resolveServe = async () => {
            await store.kdsPort.markOrdersServed(orderIds)
            resolve()
          }
        })
    )

    render(
      <KitchenOrdersProvider port={store.kdsPort}>
        <TableSettlementProvider port={store.settlementPort}>
          <TablesOperationsView />
        </TableSettlementProvider>
      </KitchenOrdersProvider>
    )

    const serveButton = await screen.findByRole("button", { name: "KitchenDisplay.markServed" })
    fireEvent.click(serveButton)
    fireEvent.click(serveButton)

    expect(store.settlementPort.serveOrders).toHaveBeenCalledTimes(1)
    expect(store.settlementPort.serveOrders).toHaveBeenCalledWith(["order-1"])
    expect(serveButton).toBeDisabled()

    await act(async () => {
      resolveServe()
    })

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "KitchenDisplay.markServed" })).not.toBeInTheDocument()
    })
  })

  it("completes Table Settlement in cash, blocks duplicate taps while pending, and clears the Table's awaiting-payment state", async () => {
    const store = createInMemoryStaffOrdersStore(initialOrders)
    let resolveSettle!: () => void
    vi.mocked(store.settlementPort.settleTable).mockImplementationOnce(
      (tableId, method = "cash") =>
        new Promise<number>((resolve) => {
          resolveSettle = () => {
            let count = 0
            for (const order of store.getOrders()) {
              if (order.tableId === tableId && order.paymentStatus === "pending") {
                order.paymentStatus = "paid"
                order.paymentMethod = method
                count += 1
              }
            }
            resolve(count)
          }
        })
    )

    render(
      <KitchenOrdersProvider port={store.kdsPort}>
        <TableSettlementProvider port={store.settlementPort}>
          <TablesOperationsView />
        </TableSettlementProvider>
      </KitchenOrdersProvider>
    )

    const confirmButton = await screen.findByRole("button", { name: "KitchenDisplay.confirmCashReceived" })
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(store.settlementPort.settleTable).toHaveBeenCalledTimes(1)
    expect(store.settlementPort.settleTable).toHaveBeenCalledWith("table-1", "cash")
    expect(confirmButton).toBeDisabled()

    await act(async () => {
      resolveSettle()
    })

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "KitchenDisplay.confirmCashReceived" })).not.toBeInTheDocument()
    })
  })
})
