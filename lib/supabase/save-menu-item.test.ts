import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

vi.mock("./menu-data", () => ({
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  setItemModifierGroups: vi.fn(),
  setItemSizes: vi.fn(),
  getMenuItemById: vi.fn(),
}))

vi.mock("./inventory-data", () => ({
  setMenuItemIngredients: vi.fn(),
}))

import { createMenuItem, updateMenuItem, setItemModifierGroups, setItemSizes, getMenuItemById, type MenuItem } from "./menu-data"
import { setMenuItemIngredients } from "./inventory-data"
import { saveMenuItem } from "./save-menu-item"

const supabase = {} as SupabaseClient

const ITEM_INPUT = {
  categoryId: "cat-1",
  nameVi: "Cà Phê",
  nameEn: "Coffee",
  descriptionVi: "",
  descriptionEn: "",
  basePrice: 29000,
  icon: "coffee" as const,
  isAvailable: true,
  isPopular: false,
  hasSizeOptions: false,
}

const SAVED_ITEM: MenuItem = {
  id: "item-1",
  categoryId: "cat-1",
  nameVi: "Cà Phê",
  nameEn: "Coffee",
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
}

const REFETCHED_ITEM: MenuItem = { ...SAVED_ITEM, isPopular: true }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("saveMenuItem", () => {
  it("creates a new item when editingId is null, then wires modifier groups, ingredients, and sizes", async () => {
    vi.mocked(createMenuItem).mockResolvedValue(SAVED_ITEM)
    vi.mocked(getMenuItemById).mockResolvedValue(REFETCHED_ITEM)

    const result = await saveMenuItem(supabase, {
      editingId: null,
      item: ITEM_INPUT,
      extraGroupIds: ["grp-1"],
      recipeEntries: [{ ingredientId: "ing-1", quantityUsed: 2 }],
      sizes: [{ name: "M", priceDelta: 0 }],
    })

    expect(createMenuItem).toHaveBeenCalledWith(supabase, ITEM_INPUT)
    expect(updateMenuItem).not.toHaveBeenCalled()
    expect(setItemModifierGroups).toHaveBeenCalledWith(supabase, "item-1", ["grp-1"])
    expect(setMenuItemIngredients).toHaveBeenCalledWith(supabase, "item-1", [{ ingredientId: "ing-1", quantityUsed: 2 }])
    expect(setItemSizes).toHaveBeenCalledWith(supabase, "item-1", [{ name: "M", priceDelta: 0 }])
    expect(result).toEqual(REFETCHED_ITEM)
  })

  it("updates the existing item when editingId is given, instead of creating", async () => {
    vi.mocked(updateMenuItem).mockResolvedValue(SAVED_ITEM)
    vi.mocked(getMenuItemById).mockResolvedValue(REFETCHED_ITEM)

    await saveMenuItem(supabase, {
      editingId: "item-1",
      item: ITEM_INPUT,
      extraGroupIds: [],
      recipeEntries: [],
      sizes: [],
    })

    expect(updateMenuItem).toHaveBeenCalledWith(supabase, "item-1", ITEM_INPUT)
    expect(createMenuItem).not.toHaveBeenCalled()
  })

  it("falls back to the just-saved item when the refetch returns null", async () => {
    vi.mocked(createMenuItem).mockResolvedValue(SAVED_ITEM)
    vi.mocked(getMenuItemById).mockResolvedValue(null)

    const result = await saveMenuItem(supabase, {
      editingId: null,
      item: ITEM_INPUT,
      extraGroupIds: [],
      recipeEntries: [],
      sizes: [],
    })

    expect(result).toEqual(SAVED_ITEM)
  })
})
