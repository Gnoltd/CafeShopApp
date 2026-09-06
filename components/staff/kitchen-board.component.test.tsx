import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { KitchenBoard } from "./kitchen-board"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

function makeOrder(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: "order-1",
    orderType: "pickup",
    status: "paid",
    paymentStatus: "paid",
    paymentMethod: "cash",
    createdAt: 0,
    total: 50_000,
    items: [
      { id: "item-a", nameVi: "A", nameEn: "Coffee A", quantity: 1, note: null, status: "preparing", sizeName: null, modifierNames: [] },
      { id: "item-b", nameVi: "B", nameEn: "Coffee B", quantity: 1, note: null, status: "preparing", sizeName: null, modifierNames: [] },
    ],
    ...overrides,
  }
}

const noop = () => {}

describe("KitchenBoard ticket -- per-item advance only", () => {
  it("has no ticket-level advance button while items are mid-preparing -- tapping one item advances only that item", () => {
    const onAdvanceItem = vi.fn()
    render(
      <KitchenBoard
        orders={[makeOrder()]}
        now={0}
        onAdvanceItem={onAdvanceItem}
        onRegressItem={noop}
        onHandOver={noop}
        isItemPending={() => false}
        onConfirmPayment={async () => {}}
      />
    )

    // Only the two per-item rows are tappable -- no separate "Start
    // Preparing" / "Mark Ready" button exists anywhere on the ticket.
    expect(screen.queryByText(/KitchenDisplay\.startPreparing/)).not.toBeInTheDocument()
    expect(screen.queryByText(/KitchenDisplay\.markReady/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("1× Coffee A"))

    expect(onAdvanceItem).toHaveBeenCalledTimes(1)
    expect(onAdvanceItem).toHaveBeenCalledWith("order-1", "item-a")
  })

  it("offers only Undo (no forward action) once one item is ready and another is still preparing", () => {
    const onAdvanceItem = vi.fn()
    const onRegressItem = vi.fn()
    render(
      <KitchenBoard
        orders={[
          makeOrder({
            status: "preparing",
            items: [
              { id: "item-a", nameVi: "A", nameEn: "Coffee A", quantity: 1, note: null, status: "ready", sizeName: null, modifierNames: [] },
              { id: "item-b", nameVi: "B", nameEn: "Coffee B", quantity: 1, note: null, status: "preparing", sizeName: null, modifierNames: [] },
            ],
          }),
        ]}
        now={0}
        onAdvanceItem={onAdvanceItem}
        onRegressItem={onRegressItem}
        onHandOver={noop}
        isItemPending={() => false}
        onConfirmPayment={async () => {}}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "KitchenDisplay.undoItem" }))
    expect(onRegressItem).toHaveBeenCalledWith("order-1", "item-a")
    expect(onAdvanceItem).not.toHaveBeenCalled()
  })
})
