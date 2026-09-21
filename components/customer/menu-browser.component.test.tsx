import type { ReactNode } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MenuBrowser } from "./menu-browser"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

vi.mock("next-intl", () => ({
  useLocale: () => "vi",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}(${JSON.stringify(values)})` : `${namespace}.${key}`,
}))
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({
    push: vi.fn(),
  }),
}))
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))
vi.mock("@/components/motion/stagger-list", () => ({
  StaggerList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/motion/segmented-control", () => ({
  SegmentedControl: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))
vi.mock("@/components/customer/item-image", () => ({
  ItemImage: (props: Record<string, unknown>) => <img alt="item" {...props} />,
}))
vi.mock("@/components/customer/quick-add-popup", () => ({
  QuickAddPopup: () => <div role="dialog">Item options</div>,
}))
vi.mock("@/components/customer/scan-qr-button", () => ({
  ScanQrButton: () => <button>Scan QR</button>,
}))
vi.mock("lucide-react", () => ({
  Search: () => <span>Search</span>,
  Plus: () => <span>Plus</span>,
  Ban: () => <span>Ban</span>,
}))

const categories: MenuCategory[] = []
const items: MenuItem[] = [
  {
    id: "item-1",
    nameVi: "Cà phê sữa",
    nameEn: "Milk coffee",
    descriptionVi: "",
    descriptionEn: "",
    basePrice: 25000,
    categoryIds: [],
    isAvailable: true,
    isPopular: false,
    hasSizeOptions: false,
    sizes: [],
    modifierGroups: [],
    imageUrl: null,
  } as unknown as MenuItem,
]

describe("MenuBrowser — canOrder=false", () => {
  it("offers QR entry instead of a disabled ordering action", async () => {
    const onAddItem = vi.fn()
    render(
      <MenuBrowser categories={categories} items={items} canOrder={false} onAddItem={onAddItem} />
    )
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Scan QR" })).toBeEnabled()
    expect(onAddItem).not.toHaveBeenCalled()
  })
})

describe("MenuBrowser — canOrder=true", () => {
  it("opens item choices inside the table session when the card is tapped", async () => {
    render(<MenuBrowser categories={categories} items={items} canOrder onAddItem={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Cà phê sữa" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Item options")
  })
  it("calls onAddItem with no size/extras needed", async () => {
    const onAddItem = vi.fn()
    render(
      <MenuBrowser categories={categories} items={items} canOrder onAddItem={onAddItem} cartItemCount={0} cartSubtotal={0} />
    )
    await userEvent.click(screen.getByRole("button", { name: /add/i }))
    expect(onAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ menuItemId: "item-1", unitPrice: 25000 })
    )
  })
})
