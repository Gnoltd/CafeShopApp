import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  MENU_ITEM_IMAGE_MAX_BYTES,
  MENU_ITEM_IMAGES_BUCKET,
  createCategory,
  createMenuItem,
  createModifierGroup,
  createSupabaseMenuAdapter,
  deleteCategory,
  deleteMenuItem,
  getCategories,
  getMenuItemById,
  getMenuItems,
  getModifierGroups,
  saveMenuItem,
  saveMenuItemWithPort,
  setItemCategories,
  setItemModifierGroups,
  setItemSizes,
  updateCategory,
  updateMenuItem,
  updateModifierGroup,
  uploadMenuItemImage,
  validateMenuItemImageFile,
  type MenuItem,
  type MenuPort,
} from "./menu-data"

function fakeSupabase(rows: unknown[]) {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as SupabaseClient
}

const BASE_ITEM_INPUT = {
  categoryIds: ["cat-1"],
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

const BASE_SAVED_ITEM: MenuItem = {
  id: "item-1",
  categoryIds: ["cat-1"],
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getCategories", () => {
  it("maps snake_case DB rows to camelCase MenuCategory", async () => {
    const supabase = fakeSupabase([
      { id: "cat-1", name_vi: "Cà Phê", name_en: "Coffee", sort_order: 0 },
    ])
    const result = await getCategories(supabase)
    expect(result).toEqual([
      { id: "cat-1", nameVi: "Cà Phê", nameEn: "Coffee", sortOrder: 0 },
    ])
  })
})

describe("getMenuItems", () => {
  it("flattens nested sizes and modifier groups into camelCase", async () => {
    const row = {
      id: "item-1",
      menu_item_categories: [{ category_id: "cat-1" }],
      name_vi: "Phin Sữa Đá",
      name_en: "Iced Milk Coffee",
      description_vi: "mô tả",
      description_en: "description",
      base_price: 29000,
      icon: "coffee",
      is_available: true,
      is_popular: true,
      image_url: null,
      has_size_options: true,
      menu_item_sizes: [{ id: "size-1", name: "M", price_delta: 0, sort_order: 0 }],
      menu_item_modifier_groups: [
        {
          modifier_groups: {
            id: "grp-1",
            name_vi: "Lựa Chọn Sữa",
            name_en: "Milk Options",
            is_required: true,
            modifiers: [
              { id: "mod-1", name_vi: "Sữa Đặc", name_en: "Condensed Milk", price_delta: 0 },
            ],
          },
        },
      ],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: [row], error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getMenuItems(supabase)

    expect(result).toEqual([
      {
        id: "item-1",
        categoryIds: ["cat-1"],
        nameVi: "Phin Sữa Đá",
        nameEn: "Iced Milk Coffee",
        descriptionVi: "mô tả",
        descriptionEn: "description",
        basePrice: 29000,
        icon: "coffee",
        isAvailable: true,
        isPopular: true,
        imageUrl: null,
        hasSizeOptions: true,
        sizes: [{ id: "size-1", name: "M", priceDelta: 0, sortOrder: 0 }],
        modifierGroups: [
          {
            id: "grp-1",
            nameVi: "Lựa Chọn Sữa",
            nameEn: "Milk Options",
            required: true,
            options: [{ id: "mod-1", nameVi: "Sữa Đặc", nameEn: "Condensed Milk", priceDelta: 0 }],
          },
        ],
      },
    ])
  })
})

describe("getMenuItemById", () => {
  it("returns the mapped item when found and null when missing", async () => {
    const row = {
      id: "item-1",
      menu_item_categories: [{ category_id: "cat-1" }],
      name_vi: "Cà Phê",
      name_en: "Coffee",
      description_vi: "",
      description_en: "",
      base_price: 29000,
      icon: "coffee",
      is_available: true,
      is_popular: false,
      image_url: "https://cdn.example.com/coffee.jpg",
      has_size_options: false,
      menu_item_sizes: [],
      menu_item_modifier_groups: [],
    }
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: row, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ maybeSingle }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    await expect(getMenuItemById(supabase, "item-1")).resolves.toEqual({
      ...BASE_SAVED_ITEM,
      imageUrl: "https://cdn.example.com/coffee.jpg",
    })
    await expect(getMenuItemById(supabase, "missing")).resolves.toBeNull()
  })
})

describe("createCategory", () => {
  it("inserts a category row and returns the mapped category", async () => {
    const single = vi.fn(() =>
      Promise.resolve({ data: { id: "c1", name_vi: "Trà", name_en: "Tea", sort_order: 3 }, error: null })
    )
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    const from = vi.fn(() => ({ insert }))
    const supabase = { from } as unknown as SupabaseClient

    const result = await createCategory(supabase, { nameVi: "Trà", nameEn: "Tea", sortOrder: 3 })

    expect(from).toHaveBeenCalledWith("categories")
    expect(insert).toHaveBeenCalledWith({ name_vi: "Trà", name_en: "Tea", sort_order: 3 })
    expect(result).toEqual({ id: "c1", nameVi: "Trà", nameEn: "Tea", sortOrder: 3 })
  })

  it("throws on error", async () => {
    const single = vi.fn(() => Promise.resolve({ data: null, error: new Error("not_authorized") }))
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    const from = vi.fn(() => ({ insert }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(createCategory(supabase, { nameVi: "Trà", nameEn: "Tea", sortOrder: 3 })).rejects.toThrow(
      "not_authorized"
    )
  })
})

describe("updateCategory", () => {
  it("updates the category's bilingual names by id", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await updateCategory(supabase, "c1", { nameVi: "Cà Phê", nameEn: "Coffee" })

    expect(from).toHaveBeenCalledWith("categories")
    expect(update).toHaveBeenCalledWith({ name_vi: "Cà Phê", name_en: "Coffee" })
    expect(eq).toHaveBeenCalledWith("id", "c1")
  })

  it("throws on error", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(updateCategory(supabase, "c1", { nameVi: "Cà Phê", nameEn: "Coffee" })).rejects.toThrow(
      "not_authorized"
    )
  })
})

describe("deleteCategory", () => {
  it("deletes the category by id", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const del = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ delete: del }))
    const supabase = { from } as unknown as SupabaseClient

    await deleteCategory(supabase, "c1")

    expect(from).toHaveBeenCalledWith("categories")
    expect(eq).toHaveBeenCalledWith("id", "c1")
  })

  it("throws the FK-violation error when items still reference the category", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error("violates foreign key constraint") }))
    const del = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ delete: del }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(deleteCategory(supabase, "c1")).rejects.toThrow("violates foreign key constraint")
  })
})

describe("createMenuItem", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertedRow = {
      id: "item-new",
      menu_item_categories: [{ category_id: "cat-1" }],
      name_vi: "Trà Đào",
      name_en: "Peach Tea",
      description_vi: "mô tả",
      description_en: "description",
      base_price: 35000,
      icon: "cup-soda",
      is_available: true,
      is_popular: false,
      image_url: null,
      has_size_options: true,
      menu_item_sizes: [],
      menu_item_modifier_groups: [],
    }
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: insertedRow, error: null }),
      }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createMenuItem(supabase, {
      categoryIds: ["cat-1"],
      nameVi: "Trà Đào",
      nameEn: "Peach Tea",
      descriptionVi: "mô tả",
      descriptionEn: "description",
      basePrice: 35000,
      icon: "cup-soda",
      isAvailable: true,
      isPopular: false,
      hasSizeOptions: true,
    })

    expect(insertSpy).toHaveBeenCalledWith({
      name_vi: "Trà Đào",
      name_en: "Peach Tea",
      description_vi: "mô tả",
      description_en: "description",
      base_price: 35000,
      icon: "cup-soda",
      is_available: true,
      is_popular: false,
      image_url: null,
      has_size_options: true,
    })
    expect(result.id).toBe("item-new")
    expect(result.nameEn).toBe("Peach Tea")
  })
})

describe("updateMenuItem and deleteMenuItem", () => {
  it("updates snake_case columns by id and returns the mapped row", async () => {
    const updatedRow = {
      id: "item-1",
      menu_item_categories: [{ category_id: "cat-1" }],
      name_vi: "Cà Phê",
      name_en: "Coffee",
      description_vi: "",
      description_en: "",
      base_price: 32000,
      icon: "coffee",
      is_available: false,
      is_popular: true,
      image_url: "https://cdn.example.com/coffee.jpg",
      has_size_options: false,
      menu_item_sizes: [],
      menu_item_modifier_groups: [],
    }
    const single = vi.fn(() => Promise.resolve({ data: updatedRow, error: null }))
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    const supabase = { from: () => ({ update }) } as unknown as SupabaseClient

    const result = await updateMenuItem(supabase, "item-1", {
      ...BASE_ITEM_INPUT,
      basePrice: 32000,
      isAvailable: false,
      isPopular: true,
      imageUrl: "https://cdn.example.com/coffee.jpg",
    })

    expect(eq).toHaveBeenCalledWith("id", "item-1")
    expect(update).toHaveBeenCalledWith({
      name_vi: "Cà Phê",
      name_en: "Coffee",
      description_vi: "",
      description_en: "",
      base_price: 32000,
      icon: "coffee",
      is_available: false,
      is_popular: true,
      image_url: "https://cdn.example.com/coffee.jpg",
      has_size_options: false,
    })
    expect(result.imageUrl).toBe("https://cdn.example.com/coffee.jpg")
    expect(result.isAvailable).toBe(false)
  })

  it("deletes a menu item by id", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const del = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ delete: del }))
    const supabase = { from } as unknown as SupabaseClient

    await deleteMenuItem(supabase, "item-1")

    expect(from).toHaveBeenCalledWith("menu_items")
    expect(eq).toHaveBeenCalledWith("id", "item-1")
  })
})

describe("getModifierGroups", () => {
  it("maps snake_case DB rows (with nested modifiers) to camelCase MenuModifierGroup", async () => {
    const row = {
      id: "grp-extra-shot",
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      is_required: false,
      modifiers: [{ id: "mod-extra-shot", name_vi: "Thêm Shot", name_en: "Extra Shot", price_delta: 10000 }],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getModifierGroups(supabase)

    expect(result).toEqual([
      {
        id: "grp-extra-shot",
        nameVi: "Thêm Shot",
        nameEn: "Extra Shot",
        required: false,
        options: [{ id: "mod-extra-shot", nameVi: "Thêm Shot", nameEn: "Extra Shot", priceDelta: 10000 }],
      },
    ])
  })
})

describe("createModifierGroup", () => {
  it("inserts a non-required, single-option modifier_group and its one modifier", async () => {
    const groupInsertSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "grp-new", name_vi: "Thêm Shot", name_en: "Extra Shot", is_required: false },
            error: null,
          }),
      }),
    }))
    const modifierInsertSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "mod-new", name_vi: "Thêm Shot", name_en: "Extra Shot", price_delta: 10000 },
            error: null,
          }),
      }),
    }))
    const supabase = {
      from: (table: string) => {
        if (table === "modifier_groups") return { insert: groupInsertSpy }
        if (table === "modifiers") return { insert: modifierInsertSpy }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    const result = await createModifierGroup(supabase, {
      nameVi: "Thêm Shot",
      nameEn: "Extra Shot",
      priceDelta: 10000,
    })

    expect(groupInsertSpy).toHaveBeenCalledWith({
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      is_required: false,
      max_selections: 1,
    })
    expect(modifierInsertSpy).toHaveBeenCalledWith({
      modifier_group_id: "grp-new",
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      price_delta: 10000,
    })
    expect(result).toEqual({
      id: "grp-new",
      nameVi: "Thêm Shot",
      nameEn: "Extra Shot",
      required: false,
      options: [{ id: "mod-new", nameVi: "Thêm Shot", nameEn: "Extra Shot", priceDelta: 10000 }],
    })
  })
})

describe("setItemModifierGroups", () => {
  it("deletes existing links then inserts one row per group id", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemModifierGroups(supabase, "item-1", ["grp-a", "grp-b"])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", modifier_group_id: "grp-a" },
      { menu_item_id: "item-1", modifier_group_id: "grp-b" },
    ])
  })

  it("skips the insert call when groupIds is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemModifierGroups(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("setItemSizes", () => {
  it("deletes existing sizes then inserts the new set with sort_order matching array index", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemSizes(supabase, "item-1", [
      { name: "M", priceDelta: 0 },
      { name: "L", priceDelta: 8000 },
    ])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", name: "M", price_delta: 0, sort_order: 0 },
      { menu_item_id: "item-1", name: "L", price_delta: 8000, sort_order: 1 },
    ])
  })

  it("skips the insert call when sizes is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemSizes(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("setItemCategories", () => {
  it("deletes existing links then inserts one row per category id", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemCategories(supabase, "item-1", ["cat-a", "cat-b"])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", category_id: "cat-a" },
      { menu_item_id: "item-1", category_id: "cat-b" },
    ])
  })

  it("skips the insert call when categoryIds is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemCategories(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("updateModifierGroup", () => {
  it("updates the group's names then its one modifier's names/price", async () => {
    const groupUpdateEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const modifierUpdateEqSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "mod-1", name_vi: "Thêm Shot Đậm", name_en: "Extra Strong Shot", price_delta: 12000 },
            error: null,
          }),
      }),
    }))
    const supabase = {
      from: (table: string) => {
        if (table === "modifier_groups") return { update: () => ({ eq: groupUpdateEqSpy }) }
        if (table === "modifiers") return { update: () => ({ eq: modifierUpdateEqSpy }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    const result = await updateModifierGroup(supabase, "grp-1", {
      nameVi: "Thêm Shot Đậm",
      nameEn: "Extra Strong Shot",
      priceDelta: 12000,
    })

    expect(groupUpdateEqSpy).toHaveBeenCalledWith("id", "grp-1")
    expect(modifierUpdateEqSpy).toHaveBeenCalledWith("modifier_group_id", "grp-1")
    expect(result).toEqual({
      id: "grp-1",
      nameVi: "Thêm Shot Đậm",
      nameEn: "Extra Strong Shot",
      required: false,
      options: [{ id: "mod-1", nameVi: "Thêm Shot Đậm", nameEn: "Extra Strong Shot", priceDelta: 12000 }],
    })
  })
})

describe("validateMenuItemImageFile", () => {
  it("accepts image files within the 5MB limit", () => {
    expect(validateMenuItemImageFile({ type: "image/png", size: 1024 })).toBeNull()
    expect(validateMenuItemImageFile({ type: "image/webp", size: MENU_ITEM_IMAGE_MAX_BYTES })).toBeNull()
  })

  it("rejects non-image types and files larger than 5MB", () => {
    expect(validateMenuItemImageFile({ type: "application/pdf", size: 1024 })).toBe("invalid_type")
    expect(validateMenuItemImageFile({ type: "image/jpeg", size: MENU_ITEM_IMAGE_MAX_BYTES + 1 })).toBe("too_large")
  })
})

describe("uploadMenuItemImage", () => {
  it("uploads to the menu-item-images bucket with a UUID-prefixed filename and returns the public URL", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000001")
    const upload = vi.fn().mockResolvedValue({ error: null })
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/menu-item-images/00000000-0000-0000-0000-000000000001-latte.png" },
    })
    const from = vi.fn(() => ({ upload, getPublicUrl }))
    const supabase = { storage: { from } } as unknown as SupabaseClient
    const file = new File(["img"], "latte.png", { type: "image/png" })

    const url = await uploadMenuItemImage(supabase, file)

    expect(from).toHaveBeenCalledWith(MENU_ITEM_IMAGES_BUCKET)
    expect(upload).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001-latte.png", file)
    expect(getPublicUrl).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001-latte.png")
    expect(url).toBe("https://cdn.example.com/menu-item-images/00000000-0000-0000-0000-000000000001-latte.png")
  })

  it("throws when storage upload fails without reading getPublicUrl", async () => {
    const upload = vi.fn().mockResolvedValue({ error: new Error("upload failed") })
    const getPublicUrl = vi.fn()
    const supabase = { storage: { from: () => ({ upload, getPublicUrl }) } } as unknown as SupabaseClient
    const file = new File(["img"], "latte.png", { type: "image/png" })

    await expect(uploadMenuItemImage(supabase, file)).rejects.toThrow("upload failed")
    expect(getPublicUrl).not.toHaveBeenCalled()
  })
})

describe("saveMenuItemWithPort", () => {
  const refetchedItem: MenuItem = { ...BASE_SAVED_ITEM, isPopular: true }
  let port: {
    uploadMenuItemImage: ReturnType<typeof vi.fn<MenuPort["uploadMenuItemImage"]>>
    createMenuItem: ReturnType<typeof vi.fn<MenuPort["createMenuItem"]>>
    updateMenuItem: ReturnType<typeof vi.fn<MenuPort["updateMenuItem"]>>
    setItemModifierGroups: ReturnType<typeof vi.fn<MenuPort["setItemModifierGroups"]>>
    setItemCategories: ReturnType<typeof vi.fn<MenuPort["setItemCategories"]>>
    setItemSizes: ReturnType<typeof vi.fn<MenuPort["setItemSizes"]>>
    getMenuItemById: ReturnType<typeof vi.fn<MenuPort["getMenuItemById"]>>
  }

  beforeEach(() => {
    port = {
      uploadMenuItemImage: vi.fn(),
      createMenuItem: vi.fn().mockResolvedValue(BASE_SAVED_ITEM),
      updateMenuItem: vi.fn().mockResolvedValue(BASE_SAVED_ITEM),
      setItemModifierGroups: vi.fn().mockResolvedValue(undefined),
      setItemCategories: vi.fn().mockResolvedValue(undefined),
      setItemSizes: vi.fn().mockResolvedValue(undefined),
      getMenuItemById: vi.fn().mockResolvedValue(refetchedItem),
    }
  })

  it("creates a new item when editingId is null, then wires modifier groups, categories, and sizes", async () => {
    const result = await saveMenuItemWithPort(port, {
      editingId: null,
      item: BASE_ITEM_INPUT,
      extraGroupIds: ["grp-1"],
      sizes: [{ name: "M", priceDelta: 0 }],
    })

    expect(port.uploadMenuItemImage).not.toHaveBeenCalled()
    expect(port.createMenuItem).toHaveBeenCalledWith(BASE_ITEM_INPUT)
    expect(port.updateMenuItem).not.toHaveBeenCalled()
    expect(port.setItemModifierGroups).toHaveBeenCalledWith("item-1", ["grp-1"])
    expect(port.setItemCategories).toHaveBeenCalledWith("item-1", ["cat-1"])
    expect(port.setItemSizes).toHaveBeenCalledWith("item-1", [{ name: "M", priceDelta: 0 }])
    expect(result).toEqual(refetchedItem)
  })

  it("updates the existing item when editingId is given, instead of creating", async () => {
    await saveMenuItemWithPort(port, {
      editingId: "item-1",
      item: BASE_ITEM_INPUT,
      extraGroupIds: [],
      sizes: [],
    })

    expect(port.updateMenuItem).toHaveBeenCalledWith("item-1", BASE_ITEM_INPUT)
    expect(port.createMenuItem).not.toHaveBeenCalled()
  })

  it("falls back to the just-saved item when the refetch returns null", async () => {
    port.getMenuItemById.mockResolvedValue(null)

    const result = await saveMenuItemWithPort(port, {
      editingId: null,
      item: BASE_ITEM_INPUT,
      extraGroupIds: [],
      sizes: [],
    })

    expect(result).toEqual(BASE_SAVED_ITEM)
  })

  it("uploads imageFile first and persists the returned public URL on save", async () => {
    const file = new File(["img"], "coffee.png", { type: "image/png" })
    port.uploadMenuItemImage.mockResolvedValue("https://cdn.example.com/uploaded.png")

    await saveMenuItemWithPort(port, {
      editingId: "item-1",
      item: BASE_ITEM_INPUT,
      extraGroupIds: ["grp-1"],
      sizes: [],
      imageFile: file,
    })

    expect(port.uploadMenuItemImage).toHaveBeenCalledWith(file)
    expect(port.updateMenuItem).toHaveBeenCalledWith("item-1", {
      ...BASE_ITEM_INPUT,
      imageUrl: "https://cdn.example.com/uploaded.png",
    })
  })

  it("aborts item creation when imageFile upload fails", async () => {
    const file = new File(["img"], "coffee.png", { type: "image/png" })
    port.uploadMenuItemImage.mockRejectedValue(new Error("upload_error"))

    await expect(
      saveMenuItemWithPort(port, {
        editingId: null,
        item: BASE_ITEM_INPUT,
        extraGroupIds: [],
        sizes: [],
        imageFile: file,
      })
    ).rejects.toThrow("upload_error")

    expect(port.createMenuItem).not.toHaveBeenCalled()
    expect(port.setItemModifierGroups).not.toHaveBeenCalled()
  })
})

describe("saveMenuItem and createSupabaseMenuAdapter", () => {
  it("runs upload, item insert, relation writes, and refetch through SupabaseClient", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000002")
    const uploadedUrl = "https://cdn.example.com/menu-item-images/00000000-0000-0000-0000-000000000002-tea.jpg"
    const savedRow = {
      id: "item-tea",
      menu_item_categories: [],
      name_vi: "Trà Sen",
      name_en: "Lotus Tea",
      description_vi: "",
      description_en: "",
      base_price: 40000,
      icon: "cup-soda",
      is_available: true,
      is_popular: true,
      image_url: uploadedUrl,
      has_size_options: true,
      menu_item_sizes: [],
      menu_item_modifier_groups: [],
    }
    const refetchedRow = {
      ...savedRow,
      menu_item_categories: [{ category_id: "cat-tea" }],
      menu_item_sizes: [{ id: "sz-1", name: "L", price_delta: 5000, sort_order: 0 }],
      menu_item_modifier_groups: [
        {
          modifier_groups: {
            id: "grp-1",
            name_vi: "Ít đá",
            name_en: "Less ice",
            is_required: false,
            modifiers: [{ id: "m-1", name_vi: "Ít đá", name_en: "Less ice", price_delta: 0 }],
          },
        },
      ],
    }

    const storageUpload = vi.fn().mockResolvedValue({ error: null })
    const storageGetPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: uploadedUrl } })
    const menuItemInsert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: savedRow, error: null }) }),
    }))
    const menuItemSelect = vi.fn(() => ({
      eq: () => ({
        order: () => ({
          maybeSingle: () => Promise.resolve({ data: refetchedRow, error: null }),
        }),
      }),
    }))
    const childOps: Record<string, { deleteEq: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> }> = {
      menu_item_modifier_groups: {
        deleteEq: vi.fn().mockResolvedValue({ error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      },
      menu_item_categories: {
        deleteEq: vi.fn().mockResolvedValue({ error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      },
      menu_item_sizes: {
        deleteEq: vi.fn().mockResolvedValue({ error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      },
    }

    const supabase = {
      storage: {
        from: () => ({ upload: storageUpload, getPublicUrl: storageGetPublicUrl }),
      },
      from: (table: string) => {
        if (table === "menu_items") {
          return { insert: menuItemInsert, select: menuItemSelect }
        }
        const ops = childOps[table]
        if (!ops) throw new Error(`unexpected table ${table}`)
        return {
          delete: () => ({ eq: ops.deleteEq }),
          insert: ops.insert,
        }
      },
    } as unknown as SupabaseClient

    const file = new File(["img"], "tea.jpg", { type: "image/jpeg" })
    const result = await saveMenuItem(supabase, {
      editingId: null,
      item: {
        categoryIds: ["cat-tea"],
        nameVi: "Trà Sen",
        nameEn: "Lotus Tea",
        descriptionVi: "",
        descriptionEn: "",
        basePrice: 40000,
        icon: "cup-soda",
        isAvailable: true,
        isPopular: true,
        hasSizeOptions: true,
      },
      extraGroupIds: ["grp-1"],
      sizes: [{ name: "L", priceDelta: 5000 }],
      imageFile: file,
    })

    expect(storageUpload).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000002-tea.jpg", file)
    expect(menuItemInsert).toHaveBeenCalledWith(expect.objectContaining({ image_url: uploadedUrl }))
    expect(childOps.menu_item_modifier_groups.insert).toHaveBeenCalledWith([
      { menu_item_id: "item-tea", modifier_group_id: "grp-1" },
    ])
    expect(childOps.menu_item_categories.insert).toHaveBeenCalledWith([
      { menu_item_id: "item-tea", category_id: "cat-tea" },
    ])
    expect(childOps.menu_item_sizes.insert).toHaveBeenCalledWith([
      { menu_item_id: "item-tea", name: "L", price_delta: 5000, sort_order: 0 },
    ])
    expect(result.imageUrl).toBe(uploadedUrl)
    expect(result.categoryIds).toEqual(["cat-tea"])
    expect(result.sizes).toEqual([{ id: "sz-1", name: "L", priceDelta: 5000, sortOrder: 0 }])
    expect(result.modifierGroups).toHaveLength(1)

    const adapter = createSupabaseMenuAdapter(supabase)
    expect(typeof adapter.saveMenuItem).toBe("function")
    expect(typeof adapter.uploadMenuItemImage).toBe("function")
  })
})
