import type { ButtonHTMLAttributes, ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckoutView } from "./checkout-view"

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), push: vi.fn() }))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}))
vi.mock("@/components/motion/segmented-control", () => ({
  SegmentedControl: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (value: string) => void }) => (
    <div>{options.map((option) => <button key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
  ),
}))
vi.mock("@/components/motion/press-feedback", () => ({
  PressFeedback: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))
vi.mock("@/components/customer/qr-scanner-overlay", () => ({ QrScannerOverlay: () => null }))
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    items: [{ cartItemId: "line-1", menuItemId: "coffee-1", nameVi: "Cà phê", nameEn: "Coffee", modifiers: [], unitPrice: 30_000, quantity: 1 }],
    subtotal: 30_000, promoCode: null, promoDiscount: 0, clear: vi.fn(),
  }),
}))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    functions: { invoke: mocks.invoke },
  }),
}))
vi.mock("@/lib/supabase/settings-data", () => ({
  getLoyaltySettings: vi.fn().mockResolvedValue({ enabled: false, redeemValueVndPerPoint: 0 }),
  getShopSettings: vi.fn().mockResolvedValue({ taxRatePercent: 0 }),
}))
vi.mock("@/lib/supabase/rewards-data", () => ({ getMyRedemptions: vi.fn() }))
vi.mock("@/lib/supabase/shift-data", () => ({ isShiftOpen: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/supabase/orders-data", () => ({ cancelPendingOrder: vi.fn() }))

describe("CheckoutView payment submission", () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.push.mockReset()
  })

  it("unlocks Place Order and shows a retryable error when payment setup fails", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("gateway unavailable") })
    const user = userEvent.setup()
    render(<CheckoutView />)

    await user.click(screen.getByRole("button", { name: "Checkout.payStripe" }))
    const placeButtons = screen.getAllByRole("button", { name: "Checkout.placeOrder" })
    await user.click(placeButtons[0])

    expect(await screen.findByText("Checkout.cardPaymentUnavailable")).toBeVisible()
    expect(placeButtons[0]).toBeEnabled()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
})
