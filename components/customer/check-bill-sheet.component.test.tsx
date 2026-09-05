import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckBillSheet } from "./check-bill-sheet"

const mocks = vi.hoisted(() => ({
  validatePromoCode: vi.fn(),
  checkoutTableSession: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/supabase/promotions-data", () => ({ validatePromoCode: mocks.validatePromoCode }))
vi.mock("@/lib/supabase/table-session-data", () => ({ checkoutTableSession: mocks.checkoutTableSession }))

describe("CheckBillSheet promo code", () => {
  beforeEach(() => {
    mocks.validatePromoCode.mockReset()
    mocks.checkoutTableSession.mockReset()
  })

  it("applies a valid code, reduces the total to pay, and forwards it on confirm", async () => {
    mocks.validatePromoCode.mockResolvedValue({ valid: true, discountType: "fixed", discountValue: 10_000, discountAmount: 10_000 })
    mocks.checkoutTableSession.mockResolvedValue({})
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={50_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText("TableSession.checkBillPromoPlaceholder"), { target: { value: "save10" } })
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillApplyPromo" }))

    expect(await screen.findByText("SAVE10")).toBeVisible()
    expect(screen.getByText("-10.000đ")).toBeVisible()
    expect(screen.getByText("40.000đ")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillPayCash" }))
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillConfirm" }))

    await act(async () => {})
    expect(mocks.checkoutTableSession).toHaveBeenCalledWith({}, "qr-1", "cash", "en", "SAVE10", expect.any(String))
  })

  it("blocks duplicate Apply taps and unlocks with an error after a transient failure", async () => {
    let rejectRequest!: (error: Error) => void
    mocks.validatePromoCode.mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject }))
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={50_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText("TableSession.checkBillPromoPlaceholder"), { target: { value: "SAVE10" } })
    const applyButton = screen.getByRole("button", { name: "TableSession.checkBillApplyPromo" })
    fireEvent.click(applyButton)
    fireEvent.click(applyButton)

    expect(mocks.validatePromoCode).toHaveBeenCalledTimes(1)
    expect(applyButton).toBeDisabled()

    await act(async () => rejectRequest(new Error("temporary network failure")))
    expect(await screen.findByText("TableSession.checkBillPromoCheckError")).toBeVisible()
    expect(applyButton).toBeEnabled()
  })

  it("shows the invalid-code reason and never forwards a rejected code", async () => {
    mocks.validatePromoCode.mockResolvedValue({ valid: false, reason: "expired" })
    render(<CheckBillSheet qrToken="qr-1" unpaidTotal={50_000} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText("TableSession.checkBillPromoPlaceholder"), { target: { value: "OLD10" } })
    fireEvent.click(screen.getByRole("button", { name: "TableSession.checkBillApplyPromo" }))

    expect(await screen.findByText("TableSession.checkBillPromoExpired")).toBeVisible()
    expect(screen.queryByText("OLD10")).toBeNull()
  })
})
