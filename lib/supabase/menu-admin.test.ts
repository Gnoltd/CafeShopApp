import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createCategory, updateCategory, deleteCategory } from "./menu-admin"

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
