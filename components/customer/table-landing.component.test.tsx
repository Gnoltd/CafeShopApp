import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TableLanding } from "./table-landing"
import { RoleBadge } from "@/components/shared/role-badge"
import {
  saveGuestActiveTable,
  type GuestTableLookupPort,
} from "@/lib/guest-active-table"
import type { TableRecord } from "@/lib/supabase/tables-data"
import type { TableSession, TableSessionPort } from "@/lib/supabase/table-session-data"

const mocks = vi.hoisted(() => ({
  search: "",
  pathname: "/table/qr-5",
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}(${JSON.stringify(values)})` : `${namespace}.${key}`,
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    rpc: vi.fn(),
  }),
}))

const TABLE_5: TableRecord = {
  id: "tbl-5",
  number: "5",
  qrToken: "qr-5",
  locationVi: "Cửa sổ",
  locationEn: "Window",
  status: "available",
  cleaningNotifiedAt: null,
  scanCount: 2,
}

function createSessionPort(overrides: Partial<TableSession> = {}): TableSessionPort {
  let state: TableSession = {
    sessionId: "sess-5",
    hasSession: true,
    paymentPending: false,
    checkoutPromoCode: null,
    checkoutDiscountAmount: 0,
    cartItems: [],
    rounds: [
      {
        id: "r-1",
        createdAt: 1,
        status: "served",
        paymentStatus: "pending",
        paymentMethod: null,
        subtotal: 30_000,
        taxAmount: 0,
        total: 30_000,
        items: [{ nameVi: "Cà phê", nameEn: "Coffee", quantity: 1, unitPrice: 30_000, note: null }],
      },
    ],
    unpaidTotal: 30_000,
    ...overrides,
  }
  return {
    getSession: vi.fn(async () => structuredClone(state)),
    addCartItem: vi.fn(async () => undefined),
    updateCartItemQuantity: vi.fn(async () => undefined),
    removeCartItem: vi.fn(async () => undefined),
    placeRound: vi.fn(async () => ({ orderId: "r-2", total: 30_000 })),
    abandonSession: vi.fn(async () => {
      state = { ...state, sessionId: null, hasSession: false, cartItems: [] }
      return true
    }),
    requestBill: vi.fn(async () => {
      state = { ...state, paymentPending: true }
    }),
  }
}

describe("TableLanding + RoleBadge (Seam 3: Guest Active Table lifecycle via ports)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.search = "view=order"
    mocks.pathname = "/table/qr-5"
  })

  it("remembers the Guest Active Table in RoleBadge on QR scan and keeps it visible after a Bill Request", async () => {
    const user = userEvent.setup()
    const lookupPort: GuestTableLookupPort = {
      findByQrToken: vi.fn().mockResolvedValue(TABLE_5),
      recordScan: vi.fn().mockResolvedValue({ ...TABLE_5, scanCount: 3 }),
    }
    const sessionPort = createSessionPort()

    render(
      <>
        <RoleBadge role={null} />
        <TableLanding
          qrToken="qr-5"
          categories={[]}
          items={[]}
          lookupPort={lookupPort}
          sessionPort={sessionPort}
        />
      </>
    )

    const badgeLink = await screen.findByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"5"\}\)/ })
    expect(badgeLink).toHaveAttribute("href", "/table/qr-5")

    // Guest submits a Bill Request; Guest Active Table remains remembered on RoleBadge.
    await user.click(await screen.findByRole("button", { name: "TableSession.checkBillButton" }))
    await user.click(await screen.findByRole("button", { name: "TableSession.checkBillConfirm" }))

    expect(await screen.findByText("TableSession.paymentInProgressNote")).toBeVisible()
    expect(screen.getByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"5"\}\)/ })).toBeInTheDocument()
  })

  it("still resolves and remembers the Guest Active Table when recordScan fails", async () => {
    const lookupPort: GuestTableLookupPort = {
      findByQrToken: vi.fn().mockResolvedValue(TABLE_5),
      recordScan: vi.fn().mockRejectedValue(new Error("scan rpc down")),
    }
    const sessionPort = createSessionPort()

    render(
      <>
        <RoleBadge role={null} />
        <TableLanding
          qrToken="qr-5"
          categories={[]}
          items={[]}
          lookupPort={lookupPort}
          sessionPort={sessionPort}
        />
      </>
    )

    expect(await screen.findByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"5"\}\)/ })).toBeVisible()
  })

  it("clears the Guest Active Table from RoleBadge when an invalid/rotated token matches the remembered Table, while preserving another Table", async () => {
    saveGuestActiveTable({ number: "1", qrToken: "qr-valid" })
    const lookupPort: GuestTableLookupPort = {
      findByQrToken: vi.fn().mockResolvedValue(null),
      recordScan: vi.fn(),
    }

    const { unmount } = render(
      <>
        <RoleBadge role={null} />
        <TableLanding qrToken="qr-unknown" categories={[]} items={[]} lookupPort={lookupPort} />
      </>
    )

    expect(await screen.findByText("TableLanding.invalidTitle")).toBeVisible()
    expect(screen.getByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"1"\}\)/ })).toBeInTheDocument()

    unmount()

    render(
      <>
        <RoleBadge role={null} />
        <TableLanding qrToken="qr-valid" categories={[]} items={[]} lookupPort={lookupPort} />
      </>
    )

    expect(await screen.findByText("TableLanding.invalidTitle")).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /RoleNav\.badgeTable/ })).not.toBeInTheDocument()
    })
  })

  it("preserves the remembered Guest Active Table on transient lookup failure and updates RoleBadge on retry", async () => {
    saveGuestActiveTable({ number: "1", qrToken: "qr-1" })
    const lookupPort: GuestTableLookupPort = {
      findByQrToken: vi
        .fn()
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockResolvedValue(TABLE_5),
      recordScan: vi.fn().mockResolvedValue(TABLE_5),
    }
    const sessionPort = createSessionPort()

    render(
      <>
        <RoleBadge role={null} />
        <TableLanding
          qrToken="qr-5"
          categories={[]}
          items={[]}
          lookupPort={lookupPort}
          sessionPort={sessionPort}
        />
      </>
    )

    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"1"\}\)/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "AsyncState.retryButton" }))

    expect(await screen.findByRole("link", { name: /RoleNav\.badgeTable\(\{"number":"5"\}\)/ })).toBeVisible()
  })
})
