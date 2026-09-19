import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { KitchenTablesColumn } from "./kitchen-tables-column"

const mocks = vi.hoisted(() => ({
  serveTable: vi.fn(),
  confirmTablePayment: vi.fn(),
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
    // Binary open-session signal (rebuild Decision 12) replaces the old
    // 3-state `setStatus` cycle button this component used to render.
    openSessionTableIds: new Set(["table-1"]),
  }),
}))
vi.mock("@/hooks/useKitchenOrders", () => ({
  useKitchenOrders: () => ({
    orders: [
      { id: "order-1", tableId: "table-1", status: "ready", paymentStatus: "paid", paymentMethod: "cash", total: 30_000 },
      { id: "order-2", tableId: "table-1", status: "served", paymentStatus: "pending", paymentMethod: null, total: 20_000 },
    ],
    serveTable: mocks.serveTable,
    confirmTablePayment: mocks.confirmTablePayment,
  }),
}))

describe("KitchenTablesColumn mutation guard", () => {
  beforeEach(() => {
    mocks.serveTable.mockReset()
    mocks.confirmTablePayment.mockReset()
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

describe("KitchenTablesColumn cash confirmation", () => {
  beforeEach(() => {
    mocks.serveTable.mockReset()
    mocks.confirmTablePayment.mockReset()
  })

  it("confirms cash for the table and disables the button while pending", async () => {
    let resolveRequest!: () => void
    mocks.confirmTablePayment.mockImplementation(() => new Promise<void>((resolve) => { resolveRequest = resolve }))
    render(<KitchenTablesColumn active />)

    const confirmButton = screen.getByRole("button", { name: "KitchenDisplay.confirmCashReceived" })
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(mocks.confirmTablePayment).toHaveBeenCalledTimes(1)
    expect(mocks.confirmTablePayment).toHaveBeenCalledWith("table-1", "cash")
    expect(confirmButton).toBeDisabled()

    await act(async () => resolveRequest())
    expect(confirmButton).toBeEnabled()
  })
})
