import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getCategories } from "./menu-data"
import { getMenuItems } from "./menu-data"
import { createMenuItem } from "./menu-data"
import { getModifierGroups } from "./menu-data"
import { createModifierGroup } from "./menu-data"
import { setItemModifierGroups } from "./menu-data"
import { updateModifierGroup } from "./menu-data"
import { setItemSizes } from "./menu-data"
import { setItemCategories } from "./menu-data"

function fakeSupabase(rows: unknown[]) {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as SupabaseClient
}

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
