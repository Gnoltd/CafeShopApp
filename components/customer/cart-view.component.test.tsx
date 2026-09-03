import type { HTMLAttributes, ReactNode } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CartView } from "./cart-view"

const mocks = vi.hoisted(() => ({ applyPromoCode: vi.fn() }))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
}))
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }:
      HTMLAttributes<HTMLDivElement> & { children?: ReactNode; dragConstraints?: unknown; dragElastic?: unknown; onDragEnd?: unknown }) => {
      const domProps = { ...props }
      delete domProps.dragConstraints
      delete domProps.dragElastic
      delete domProps.onDragEnd
      return <div {...domProps}>{children}</div>
    },
  },
  useMotionValue: () => 0,
}))
vi.mock("@/components/motion/stagger-list", () => ({
  StaggerList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/motion/animated-counter", () => ({
  AnimatedCounter: ({ value }: { value: number }) => <span>{value}</span>,
}))
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    items: [{
      cartItemId: "line-1", menuItemId: "coffee-1", nameVi: "Cà phê", nameEn: "Coffee",
      modifiers: [], unitPrice: 30_000, quantity: 1,
    }],
    updateQuantity: vi.fn(), removeItem: vi.fn(), subtotal: 30_000,
    promoCode: null, promoDiscount: 0, applyPromoCode: mocks.applyPromoCode, clearPromoCode: vi.fn(),
  }),
}))

describe("CartView promo submission", () => {
  beforeEach(() => {
    mocks.applyPromoCode.mockReset()
  })

  it("blocks duplicate Apply taps and unlocks with an error after a transient failure", async () => {
    let rejectRequest!: (error: Error) => void
    mocks.applyPromoCode.mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject }))
    render(<CartView />)

    fireEvent.change(screen.getByPlaceholderText("Cart.promoPlaceholder"), { target: { value: "SAVE10" } })
    const applyButton = screen.getByRole("button", { name: "Cart.apply" })
    fireEvent.click(applyButton)
    fireEvent.click(applyButton)

    expect(mocks.applyPromoCode).toHaveBeenCalledTimes(1)
    expect(applyButton).toBeDisabled()

    await act(async () => rejectRequest(new Error("temporary network failure")))
    expect(await screen.findByText("Cart.promoCheckError")).toBeVisible()
    expect(applyButton).toBeEnabled()
  })
})
