import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminSidebar } from "./admin-sidebar"
import { AdminMobileHeader } from "./admin-mobile-header"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"
import StaffLayout from "@/app/[locale]/staff/layout"
import AdminLayout from "@/app/[locale]/admin/layout"
import StaffAccountsPage from "@/app/[locale]/admin/staff/page"
import SettingsPage from "@/app/[locale]/admin/settings/page"

const mocks = vi.hoisted(() => ({
  pathname: "/admin/menu",
  role: null as string | null,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => mocks.pathname,
}))

vi.mock("@/hooks/useHeaderActionsClearance", () => ({
  useHeaderActionsClearance: () => 280,
}))

vi.mock("@/components/motion/side-drawer", () => ({
  SideDrawer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/dialog", () => ({
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/get-current-role", () => ({
  getCurrentRole: vi.fn(async () => mocks.role),
}))

vi.mock("@/components/admin/staff-accounts", () => ({
  StaffAccounts: () => <div data-testid="staff-accounts-view" />,
}))

vi.mock("@/components/admin/settings-view", () => ({
  SettingsView: () => <div data-testid="settings-view" />,
}))

describe("AdminSidebar & AdminMobileHeader role-filtered navigation", () => {
  beforeEach(() => {
    mocks.pathname = "/admin/menu"
  })

  it("hides admin-only /admin/staff and /admin/settings links for manager", () => {
    render(<AdminSidebar open={false} onClose={vi.fn()} role="manager" />)

    const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    expect(hrefs).toContain("/admin/menu")
    expect(hrefs).toContain("/staff/orders")
    expect(hrefs).not.toContain("/admin/staff")
    expect(hrefs).not.toContain("/admin/settings")
  })

  it("renders all admin links for admin", () => {
    render(<AdminSidebar open={false} onClose={vi.fn()} role="admin" />)

    const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    expect(hrefs).toEqual(["/", "/admin/menu", "/admin/staff", "/admin/settings", "/staff/orders"])
  })

  it("resolves mobile header title only for routes permitted to the current role", () => {
    mocks.pathname = "/admin/staff"
    const { rerender } = render(<AdminMobileHeader onOpenMenu={vi.fn()} role="manager" />)
    expect(screen.queryByText("Nav.staff")).not.toBeInTheDocument()

    rerender(<AdminMobileHeader onOpenMenu={vi.fn()} role="admin" />)
    expect(screen.getByText("Nav.staff")).toBeInTheDocument()
  })
})

describe("StaffOrdersLayoutClient operations tab switcher", () => {
  beforeEach(() => {
    mocks.pathname = "/staff/orders"
  })

  it("renders only KDS and Tables for plain staff and never renders deleted POS/Dashboard links", () => {
    render(
      <StaffOrdersLayoutClient role="staff">
        <div>KDS</div>
      </StaffOrdersLayoutClient>
    )

    const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    expect(hrefs).toEqual(["/staff/orders", "/staff/tables"])
    expect(hrefs).not.toContain("/staff/pos")
    expect(hrefs).not.toContain("/admin/dashboard")
  })

  it("adds /admin/menu for manager and all admin links for admin", () => {
    const { rerender } = render(
      <StaffOrdersLayoutClient role="manager">
        <div>KDS</div>
      </StaffOrdersLayoutClient>
    )
    expect(screen.getAllByRole("link").map((el) => el.getAttribute("href"))).toEqual([
      "/staff/orders",
      "/staff/tables",
      "/admin/menu",
    ])

    rerender(
      <StaffOrdersLayoutClient role="admin">
        <div>KDS</div>
      </StaffOrdersLayoutClient>
    )
    expect(screen.getAllByRole("link").map((el) => el.getAttribute("href"))).toEqual([
      "/staff/orders",
      "/staff/tables",
      "/admin/menu",
      "/admin/staff",
      "/admin/settings",
    ])
  })
})

describe("Defense-in-depth server route gates", () => {
  beforeEach(() => {
    mocks.redirect.mockClear()
  })

  it("redirects manager away from /admin/staff and /admin/settings server pages", async () => {
    mocks.role = "manager"
    await expect(StaffAccountsPage({ params: Promise.resolve({ locale: "vi" }) })).rejects.toThrow(
      "REDIRECT:/vi/staff/orders"
    )
    await expect(SettingsPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow(
      "REDIRECT:/en/staff/orders"
    )
  })

  it("allows admin to render /admin/staff and /admin/settings server pages", async () => {
    mocks.role = "admin"
    const staffEl = await StaffAccountsPage({ params: Promise.resolve({ locale: "vi" }) })
    const settingsEl = await SettingsPage({ params: Promise.resolve({ locale: "vi" }) })
    expect(staffEl).toBeTruthy()
    expect(settingsEl).toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("enforces StaffLayout and AdminLayout server gates via resolveRedirect", async () => {
    mocks.role = null
    await expect(
      StaffLayout({ children: <div />, params: Promise.resolve({ locale: "vi" }) })
    ).rejects.toThrow("REDIRECT:/vi/login")

    mocks.role = "staff"
    await expect(
      AdminLayout({ children: <div />, params: Promise.resolve({ locale: "en" }) })
    ).rejects.toThrow("REDIRECT:/en/staff/orders")
  })
})
