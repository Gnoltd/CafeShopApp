import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckBillSheet } from "./check-bill-sheet"

const mocks = vi.hoisted(() => ({
  requestTableBill: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/supabase/table-session-data", () => ({ requestTableBill: mocks.requestTableBill }))

describe("CheckBillSheet", () => {
  beforeEach(() => {
    mocks.requestTableBill.mockReset()
  })

  it("shows nothing-to-pay message and close button when unpaidTotal is 0", () => {
    const onClose = vi.fn()
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={0} onClose={onClose} onSuccess={vi.fn()} />)

    expect(screen.getByText("TableSession.checkBillNothingToPay")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillClose" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("calls requestTableBill and onSuccess when confirm button is clicked", async () => {
    mocks.requestTableBill.mockResolvedValue({})
    const onSuccess = vi.fn()
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={50_000} onClose={vi.fn()} onSuccess={onSuccess} />)

    expect(screen.getByText("50.000đ")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillConfirm" }))

    await act(async () => {})
    expect(mocks.requestTableBill).toHaveBeenCalledWith({}, "qr-1")
    expect(onSuccess).toHaveBeenCalled()
  })

  it("shows error message and re-enables button when requestTableBill throws", async () => {
    mocks.requestTableBill.mockRejectedValue(new Error("network error"))
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={50_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const confirmButton = screen.getByRole("button", { name: "TableSession.checkBillConfirm" })
    fireEvent.click(confirmButton)

    await act(async () => {})
    expect(await screen.findByText("TableSession.checkBillError")).toBeVisible()
    expect(confirmButton).not.toBeDisabled()
  })
})
