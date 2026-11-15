import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TableOrderingSession } from "./table-ordering-session"
import type {
  AddCartItemInput,
  TableSession,
  TableSessionCartItem,
  TableSessionPort,
} from "@/lib/supabase/table-session-data"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const sampleCategories: MenuCategory[] = [
  { id: "cat-1", nameVi: "Cà phê", nameEn: "Coffee", sortOrder: 1 },
]

const sampleItems: MenuItem[] = [
  {
    id: "mi-1",
    categoryIds: ["cat-1"],
    nameVi: "Cà phê sữa",
    nameEn: "Milk Coffee",
    descriptionVi: "",
    descriptionEn: "",
    basePrice: 30_000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: null,
    hasSizeOptions: false,
    sizes: [],
    modifierGroups: [],
  },
]

function makeCartItem(overrides: Partial<TableSessionCartItem> = {}): TableSessionCartItem {
  return {
    id: "ci-1",
    menuItemId: "mi-1",
    nameVi: "Cà phê sữa",
    nameEn: "Milk Coffee",
    sizeId: null,
    modifierIds: [],
    note: null,
    unitPrice: 30_000,
    quantity: 1,
    version: 1,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<TableSession> = {}): TableSession {
  return {
    sessionId: "session-1",
    hasSession: true,
    paymentPending: false,
    checkoutPromoCode: null,
    checkoutDiscountAmount: 0,
    cartItems: [],
    rounds: [],
    unpaidTotal: 0,
    ...overrides,
  }
}

function createInMemoryTableSessionPort(initial: TableSession = makeSnapshot()) {
  let state: TableSession = structuredClone(initial)
  let seq = 1

  const port: TableSessionPort = {
    getSession: vi.fn(async () => structuredClone(state)),
    addCartItem: vi.fn(async (_qrToken: string, input: AddCartItemInput) => {
      state.hasSession = true
      state.sessionId ??= "session-1"
      const menuItem = sampleItems.find((m) => m.id === input.menuItemId)
      state.cartItems.push(
        makeCartItem({
          id: `ci-${++seq}`,
          menuItemId: input.menuItemId,
          nameVi: menuItem?.nameVi ?? "Món",
          nameEn: menuItem?.nameEn ?? "Item",
          sizeId: input.sizeId ?? null,
          modifierIds: [...input.modifierIds],
          note: input.note ?? null,
          unitPrice: menuItem?.basePrice ?? 30_000,
          quantity: input.quantity ?? 1,
          version: 1,
        })
      )
    }),
    updateCartItemQuantity: vi.fn(
      async (_qrToken: string, cartItemId: string, delta: number, expectedVersion?: number) => {
        const target = state.cartItems.find((item) => item.id === cartItemId)
        if (!target) throw new Error("cart_item_not_found")
        if (expectedVersion !== undefined && target.version !== expectedVersion) {
          throw { code: "P0001", message: "stale_cart_item" }
        }
        const nextQty = target.quantity + delta
        if (nextQty <= 0) {
          state.cartItems = state.cartItems.filter((item) => item.id !== cartItemId)
        } else {
          target.quantity = nextQty
          target.version += 1
        }
      }
    ),
    removeCartItem: vi.fn(async (_qrToken: string, cartItemId: string) => {
      state.cartItems = state.cartItems.filter((item) => item.id !== cartItemId)
    }),
    placeRound: vi.fn(async () => {
      const total = state.cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
      const roundId = `round-${++seq}`
      state.rounds.push({
        id: roundId,
        createdAt: Date.now(),
        status: "preparing",
        paymentStatus: "pending",
        paymentMethod: null,
        subtotal: total,
        taxAmount: 0,
        total,
        items: state.cartItems.map((i) => ({
          nameVi: i.nameVi,
          nameEn: i.nameEn,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          note: i.note,
        })),
      })
      state.cartItems = []
      state.unpaidTotal += total
      return { orderId: roundId, total }
    }),
    abandonSession: vi.fn(async () => {
      state = makeSnapshot({ sessionId: null, hasSession: false })
      return true
    }),
    requestBill: vi.fn(async () => {
      state.paymentPending = true
    }),
  }

  return {
    port,
    getState: () => state,
    setState: (next: TableSession) => {
      state = structuredClone(next)
    },
  }
}

describe("TableOrderingSession (Seam 1: real useTableSession + TableSessionPort)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders a retry action when the initial Table Session read fails and recovers on retry", async () => {
    const user = userEvent.setup()
    const { port } = createInMemoryTableSessionPort()
    vi.mocked(port.getSession).mockRejectedValueOnce(new Error("network down"))

    render(
      <TableOrderingSession
        qrToken="secret-token"
        categories={sampleCategories}
        items={sampleItems}
        port={port}
      />
    )

    const retryBtn = await screen.findByRole("button", { name: "AsyncState.retryButton" })
    await user.click(retryBtn)

    expect(await screen.findByText("Milk Coffee")).toBeVisible()
  })

  it("lets a guest add a Menu Item to the Draft Cart, place a Round, and submit a Bill Request", async () => {
    const user = userEvent.setup()
    const memory = createInMemoryTableSessionPort()

    render(
      <TableOrderingSession
        qrToken="secret-token"
        categories={sampleCategories}
        items={sampleItems}
        port={memory.port}
      />
    )

    await user.click(await screen.findByRole("button", { name: "Menu.add" }))

    await waitFor(() => {
      expect(memory.getState().cartItems).toHaveLength(1)
    })

    await user.click(screen.getByRole("button", { name: /TableSession\.orderTabLabel/ }))
    await user.click(await screen.findByRole("button", { name: /TableSession\.placeOrderButton/ }))

    await waitFor(() => {
      expect(memory.getState().rounds).toHaveLength(1)
      expect(memory.getState().unpaidTotal).toBe(30_000)
    })

    await user.click(await screen.findByRole("button", { name: "TableSession.checkBillButton" }))
    await user.click(await screen.findByRole("button", { name: "TableSession.checkBillConfirm" }))

    await waitFor(() => {
      expect(memory.getState().paymentPending).toBe(true)
    })
    expect(await screen.findByText("TableSession.paymentInProgressNote")).toBeVisible()
    expect(screen.getByRole("button", { name: "TableSession.checkBillButton" })).toBeDisabled()
  })

  it("surfaces a stale_cart_item conflict banner and refreshes the Draft Cart when another device modifies the item", async () => {
    const user = userEvent.setup()
    const memory = createInMemoryTableSessionPort(
      makeSnapshot({
        cartItems: [makeCartItem({ id: "ci-1", quantity: 1, version: 1 })],
      })
    )

    render(
      <TableOrderingSession
        qrToken="secret-token"
        categories={sampleCategories}
        items={sampleItems}
        initialTab="order"
        port={memory.port}
      />
    )

    await screen.findByText("Milk Coffee")

    // Another device updates the same Draft Cart row on the server before this guest taps +
    memory.setState(
      makeSnapshot({
        cartItems: [makeCartItem({ id: "ci-1", quantity: 4, version: 2 })],
      })
    )

    await user.click(screen.getByRole("button", { name: "TableSession.increaseQuantityLabel" }))

    expect(await screen.findByText("TableSession.cartChangedRetry")).toBeVisible()
    expect(screen.getByText("4")).toBeVisible()
  })
})
