import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  saveMenuItemWithPort,
  type MenuCategory,
  type MenuItem,
  type MenuPort,
} from "@/lib/supabase/menu-data"
import { MenuManagement } from "./menu-management"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}(${JSON.stringify(values)})` : `${namespace}.${key}`,
}))

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <span data-testid="next-image" data-src={src} aria-label={alt} />
  ),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.createClient(),
}))

const CATEGORIES: MenuCategory[] = [
  { id: "cat-1", nameVi: "Cà Phê", nameEn: "Coffee", sortOrder: 0 },
]

const ITEMS: MenuItem[] = [
  {
    id: "item-1",
    categoryIds: ["cat-1"],
    nameVi: "Phin Sữa Đá",
    nameEn: "Iced Milk Coffee",
    descriptionVi: "",
    descriptionEn: "",
    basePrice: 29000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: null,
    hasSizeOptions: false,
    sizes: [],
    modifierGroups: [],
  },
]

function createInMemoryMenuPort(
  initialCategories: MenuCategory[] = CATEGORIES,
  initialItems: MenuItem[] = ITEMS
) {
  let categories = structuredClone(initialCategories)
  let items = structuredClone(initialItems)
  let seq = 1

  const port: MenuPort = {
    getCategories: vi.fn(async () => structuredClone(categories)),
    getMenuItems: vi.fn(async () => structuredClone(items)),
    getMenuItemById: vi.fn(async (id) => {
      const found = items.find((i) => i.id === id)
      return found ? structuredClone(found) : null
    }),
    createCategory: vi.fn(async (input) => {
      const created: MenuCategory = {
        id: `cat-${++seq}`,
        nameVi: input.nameVi,
        nameEn: input.nameEn,
        sortOrder: input.sortOrder ?? categories.length,
      }
      categories.push(created)
      return structuredClone(created)
    }),
    updateCategory: vi.fn(async (id, input) => {
      categories = categories.map((c) => (c.id === id ? { ...c, ...input } : c))
    }),
    deleteCategory: vi.fn(async (id) => {
      categories = categories.filter((c) => c.id !== id)
    }),
    createMenuItem: vi.fn(async (input) => {
      const created: MenuItem = {
        id: `item-${++seq}`,
        categoryIds: [...input.categoryIds],
        nameVi: input.nameVi,
        nameEn: input.nameEn,
        descriptionVi: input.descriptionVi,
        descriptionEn: input.descriptionEn,
        basePrice: input.basePrice,
        icon: input.icon,
        isAvailable: input.isAvailable,
        isPopular: input.isPopular,
        imageUrl: input.imageUrl ?? null,
        hasSizeOptions: input.hasSizeOptions ?? false,
        sizes: [],
        modifierGroups: [],
      }
      items.unshift(created)
      return structuredClone(created)
    }),
    updateMenuItem: vi.fn(async (id, input) => {
      let updatedItem!: MenuItem
      items = items.map((item) => {
        if (item.id !== id) return item
        updatedItem = {
          ...item,
          categoryIds: [...input.categoryIds],
          nameVi: input.nameVi,
          nameEn: input.nameEn,
          descriptionVi: input.descriptionVi,
          descriptionEn: input.descriptionEn,
          basePrice: input.basePrice,
          icon: input.icon,
          isAvailable: input.isAvailable,
          isPopular: input.isPopular,
          imageUrl: input.imageUrl ?? null,
          hasSizeOptions: input.hasSizeOptions ?? false,
        }
        return updatedItem
      })
      return structuredClone(updatedItem)
    }),
    deleteMenuItem: vi.fn(async (id) => {
      items = items.filter((item) => item.id !== id)
    }),
    getModifierGroups: vi.fn(async () => []),
    createModifierGroup: vi.fn(async (input) => ({
      id: `mod-${++seq}`,
      nameVi: input.nameVi,
      nameEn: input.nameEn,
      required: false,
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: `opt-${seq}`, nameVi: input.nameVi, nameEn: input.nameEn, priceDelta: input.priceDelta }],
    })),
    updateModifierGroup: vi.fn(async (id, input) => ({
      id,
      nameVi: input.nameVi,
      nameEn: input.nameEn,
      required: false,
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: `opt-${id}`, nameVi: input.nameVi, nameEn: input.nameEn, priceDelta: input.priceDelta }],
    })),
    setItemModifierGroups: vi.fn(async () => undefined),
    setItemCategories: vi.fn(async (itemId, categoryIds) => {
      items = items.map((item) => (item.id === itemId ? { ...item, categoryIds: [...categoryIds] } : item))
    }),
    setItemSizes: vi.fn(async (itemId, sizes) => {
      items = items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              sizes: sizes.map((s: { name: string; priceDelta: number }, idx: number) => ({
                id: `sz-${idx}`,
                name: s.name,
                priceDelta: s.priceDelta,
              })),
            }
          : item
      )
    }),
    uploadMenuItemImage: vi.fn(async () => "https://cdn.example.com/uploaded.png"),
    saveMenuItem: vi.fn(async (input) => saveMenuItemWithPort(port, input)),
  }

  return {
    port,
    getCategories: () => categories,
    getItems: () => items,
  }
}

describe("MenuManagement and MenuCategoriesCard (Seam 4: real menu-data orchestration + MenuPort)", () => {
  beforeEach(() => {
    mocks.createClient.mockReset()
    mocks.createClient.mockImplementation(() => ({ id: "supabase-client" }))
  })

  it("never calls createClient when a MenuPort is injected and keeps default client stable across rerenders", () => {
    const { port } = createInMemoryMenuPort()
    const { unmount } = render(<MenuManagement categories={CATEGORIES} initialItems={ITEMS} port={port} />)
    expect(mocks.createClient).not.toHaveBeenCalled()
    unmount()

    const { rerender } = render(<MenuManagement categories={CATEGORIES} initialItems={ITEMS} />)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    rerender(<MenuManagement categories={CATEGORIES} initialItems={ITEMS} />)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
  })

  it("creates a new Menu Item through real saveMenuItemWithPort orchestration and renders it in the catalog list", async () => {
    const store = createInMemoryMenuPort()

    render(<MenuManagement categories={CATEGORIES} initialItems={ITEMS} port={store.port} />)

    fireEvent.click(screen.getByRole("button", { name: "AdminMenu.addItem" }))
    await waitFor(() => expect(store.port.getModifierGroups).toHaveBeenCalledTimes(1))

    const dialog = screen.getByRole("dialog")
    const textboxes = within(dialog).getAllByRole("textbox")
    fireEvent.change(textboxes[0], { target: { value: "Trà Đào" } })
    fireEvent.change(textboxes[1], { target: { value: "Peach Tea" } })
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "35000" } })

    fireEvent.click(within(dialog).getByRole("button", { name: "AdminMenu.save" }))

    expect(await screen.findAllByText("Peach Tea")).not.toHaveLength(0)
    expect(store.getItems().some((i) => i.nameEn === "Peach Tea" && i.basePrice === 35000)).toBe(true)
  })

  it("creates and deletes categories through MenuPort and updates the visible category filters", async () => {
    const store = createInMemoryMenuPort()

    render(<MenuManagement categories={CATEGORIES} initialItems={ITEMS} port={store.port} />)

    fireEvent.click(screen.getByRole("button", { name: "AdminMenu.manageCategories" }))
    fireEvent.click(screen.getByRole("button", { name: "AdminMenu.addCategory" }))

    await waitFor(() => {
      expect(store.getCategories()).toHaveLength(2)
    })

    const removeButtons = await screen.findAllByRole("button", { name: "AdminMenu.removeCategory" })
    fireEvent.click(removeButtons[1])

    await waitFor(() => {
      expect(store.getCategories()).toHaveLength(1)
    })
  })
})
