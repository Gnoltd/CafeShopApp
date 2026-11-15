import type { ReactNode } from "react"
import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RoleBadge } from "./role-badge"
import {
  GUEST_ACTIVE_TABLE_STORAGE_KEY,
  clearGuestActiveTable,
  saveGuestActiveTable,
} from "@/lib/guest-active-table"

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe("RoleBadge", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders nothing for a plain guest (no link to /login on screen)", () => {
    const { container } = render(<RoleBadge role={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders Table badge linking to /table/{qrToken} when GuestActiveTable is stored", () => {
    saveGuestActiveTable({ number: "7", qrToken: "qr-7" })
    render(<RoleBadge role={null} />)

    const link = screen.getByRole("link", { name: 'RoleNav.badgeTable:{"number":"7"}' })
    expect(link).toHaveAttribute("href", "/table/qr-7")
  })

  it("reacts to same-tab active table writes, conditional clears, and cross-tab storage events", () => {
    render(<RoleBadge role={null} />)
    expect(screen.queryByRole("link")).toBeNull()

    act(() => {
      saveGuestActiveTable({ number: "3", qrToken: "qr-3" })
    })
    expect(screen.getByRole("link", { name: 'RoleNav.badgeTable:{"number":"3"}' })).toHaveAttribute("href", "/table/qr-3")

    // Clearing a different token preserves Table 3.
    act(() => {
      clearGuestActiveTable("qr-other")
    })
    expect(screen.getByRole("link", { name: 'RoleNav.badgeTable:{"number":"3"}' })).toBeVisible()

    // Cross-tab storage event updates the badge.
    act(() => {
      window.localStorage.setItem(
        GUEST_ACTIVE_TABLE_STORAGE_KEY,
        JSON.stringify({ number: "9", qrToken: "qr-9" })
      )
      window.dispatchEvent(new StorageEvent("storage", { key: GUEST_ACTIVE_TABLE_STORAGE_KEY }))
    })
    expect(screen.getByRole("link", { name: 'RoleNav.badgeTable:{"number":"9"}' })).toHaveAttribute("href", "/table/qr-9")

    // Clearing matching token falls back to no badge.
    act(() => {
      clearGuestActiveTable("qr-9")
    })
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("ignores legacy unquoted localStorage strings without throwing", () => {
    window.localStorage.setItem(GUEST_ACTIVE_TABLE_STORAGE_KEY, "raw-legacy-token")
    render(<RoleBadge role={null} />)

    expect(screen.queryByRole("link")).toBeNull()
  })

  it("renders Staff and Admin badges linking to ROLE_HOME even when guest active table exists", () => {
    saveGuestActiveTable({ number: "4", qrToken: "qr-4" })

    const { rerender } = render(<RoleBadge role="staff" />)
    expect(screen.getByRole("link", { name: "RoleNav.badgeStaff" })).toHaveAttribute("href", "/staff/orders")

    rerender(<RoleBadge role="manager" />)
    expect(screen.getByRole("link", { name: "RoleNav.badgeAdmin" })).toHaveAttribute("href", "/staff/orders")

    rerender(<RoleBadge role="admin" />)
    expect(screen.getByRole("link", { name: "RoleNav.badgeAdmin" })).toHaveAttribute("href", "/staff/orders")
  })
})
