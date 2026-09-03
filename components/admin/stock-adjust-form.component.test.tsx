import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { StockAdjustForm } from "./stock-adjust-form"

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

describe("StockAdjustForm mutation failure", () => {
  it("keeps the form open, preserves the amount, and unlocks retry after Add fails", async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <StockAdjustForm
        ingredient={{
          id: "beans", nameVi: "Hạt", nameEn: "Beans", subtitleVi: "", subtitleEn: "",
          unit: "kg", stock: 2, threshold: 1, icon: "coffee",
        }}
        locale="en"
        onAdd={vi.fn().mockRejectedValue(new Error("write failed"))}
        onRemove={vi.fn()}
        onMarkOutOfStock={vi.fn()}
        onClose={onClose}
      />
    )

    const amount = await screen.findByLabelText("AdminInventory.amountLabel (kg)")
    await user.type(amount, "3")
    await user.click(screen.getByRole("button", { name: "AdminInventory.addStock" }))

    expect(await screen.findByText("AdminInventory.adjustStockError")).toBeVisible()
    expect(amount).toHaveValue(3)
    expect(screen.getByRole("button", { name: "AdminInventory.addStock" })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
