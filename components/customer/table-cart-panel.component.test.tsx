import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TableCartPanel } from "./table-cart-panel"
import type { TableSessionRound } from "@/lib/supabase/table-session-data"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}(${JSON.stringify(values)})` : `${namespace}.${key}`,
}))

function round(overrides: Partial<TableSessionRound>): TableSessionRound {
  return {
    id: "round-1",
    createdAt: 0,
    status: "served",
    paymentStatus: "pending",
    paymentMethod: null,
    subtotal: 30_000,
    taxAmount: 0,
    total: 30_000,
    items: [{ nameVi: "Cà phê", nameEn: "Coffee", quantity: 1, unitPrice: 30_000, note: null }],
    ...overrides,
  }
}

const noop = () => {}

describe("TableCartPanel running tab payment status", () => {
  it("labels an unpaid round distinctly from a paid one", () => {
    render(
      <TableCartPanel
        cartItems={[]}
        rounds={[round({ id: "r1", paymentStatus: "pending" }), round({ id: "r2", paymentStatus: "paid" })]}
        unpaidTotal={30_000}
        paymentPending={false}
        isPlacingRound={false}
        placeOrderError={null}
        pendingCartItemIds={new Set()}
        onUpdateQuantity={noop}
        onRemoveItem={noop}
        onPlaceOrder={noop}
        onOpenCheckBill={noop}
      />
    )

    expect(screen.getByText("TableSession.roundPaymentUnpaid")).toBeVisible()
    expect(screen.getByText("TableSession.roundPaymentPaid")).toBeVisible()
  })
})
