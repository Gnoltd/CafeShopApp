import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { KitchenTablesColumn } from "./kitchen-tables-column"

const mocks = vi.hoisted(() => ({
  serveTable: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/hooks/useTables", () => ({
  useTables: () => ({
    tables: [{
      id: "table-1", number: "T1", locationVi: "", locationEn: "Patio", status: "occupied",
      scanCount: 0, cleaningNotifiedAt: null,
    }],
    setStatus: mocks.setStatus,
  }),
}))
vi.mock("@/hooks/useKitchenOrders", () => ({
  useKitchenOrders: () => ({
    orders: [{ id: "order-1", tableId: "table-1", status: "ready", paymentStatus: "paid", paymentMethod: "cash", total: 30_000 }],
    serveTable: mocks.serveTable,
    confirmTableCashPayment: vi.fn(),
    markTableCashPayment: vi.fn(),
  }),
}))

describe("KitchenTablesColumn mutation guard", () => {
  beforeEach(() => {
    mocks.serveTable.mockReset()
    mocks.setStatus.mockReset()
  })

  it("allows only one Mark Served request while the table mutation is pending", async () => {
    let resolveRequest!: () => void
    mocks.serveTable.mockImplementation(() => new Promise<void>((resolve) => { resolveRequest = resolve }))
    render(<KitchenTablesColumn active />)

    const button = screen.getByRole("button", { name: "KitchenDisplay.markServed" })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(mocks.serveTable).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()

    await act(async () => resolveRequest())
    expect(button).toBeEnabled()
  })
})
