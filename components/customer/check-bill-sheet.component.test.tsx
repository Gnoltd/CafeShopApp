import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CheckBillSheet } from "./check-bill-sheet"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

describe("CheckBillSheet", () => {
  it("shows nothing-to-pay message and close button when unpaidTotal is 0", () => {
    const onClose = vi.fn()
    render(
      <CheckBillSheet unpaidTotal={0} onConfirm={vi.fn()} onClose={onClose} onSuccess={vi.fn()} />
    )

    expect(screen.getByText("TableSession.checkBillNothingToPay")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillClose" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("calls onConfirm and onSuccess when confirm button is clicked", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    render(
      <CheckBillSheet
        unpaidTotal={50_000}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )

    expect(screen.getByText("50.000đ")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillConfirm" }))

    await act(async () => {})
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it("shows error message and re-enables button when onConfirm throws", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("network error"))
    render(
      <CheckBillSheet
        unpaidTotal={50_000}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    const confirmButton = screen.getByRole("button", { name: "TableSession.checkBillConfirm" })
    fireEvent.click(confirmButton)

    await act(async () => {})
    expect(await screen.findByText("TableSession.checkBillError")).toBeVisible()
    expect(confirmButton).not.toBeDisabled()
  })
})
