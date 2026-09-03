import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getIngredients,
  createIngredient,
  adjustStock,
  getInventoryLogsPage,
  getLatestInventoryLogTimestamp,
  INVENTORY_LOGS_PAGE_SIZE,
  setMenuItemIngredients,
  setModifierIngredients,
} from "./inventory-data"

describe("getIngredients", () => {
  it("maps snake_case DB rows to camelCase Ingredient", async () => {
    const row = {
      id: "ing-1",
      name_vi: "Hạt Robusta Đặc Sản",
      name_en: "Coffee Beans (Roasted)",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      stock_quantity: 5.2,
      low_stock_threshold: 10,
      icon: "coffee",
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getIngredients(supabase)

    expect(result).toEqual([
      {
        id: "ing-1",
        nameVi: "Hạt Robusta Đặc Sản",
        nameEn: "Coffee Beans (Roasted)",
        subtitleVi: "Nguyên liệu",
        subtitleEn: "Raw material",
        unit: "kg",
        stock: 5.2,
        threshold: 10,
        icon: "coffee",
      },
    ])
  })
})

describe("createIngredient", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertedRow = {
      id: "ing-new",
      name_vi: "Đường Cát Trắng",
      name_en: "White Sugar",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      stock_quantity: 0,
      low_stock_threshold: 15,
      icon: "candy",
    }
    const insertSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createIngredient(supabase, {
      nameVi: "Đường Cát Trắng",
      nameEn: "White Sugar",
      subtitleVi: "Nguyên liệu",
      subtitleEn: "Raw material",
      unit: "kg",
      threshold: 15,
      icon: "candy",
    })

    expect(insertSpy).toHaveBeenCalledWith({
      name_vi: "Đường Cát Trắng",
      name_en: "White Sugar",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      low_stock_threshold: 15,
      icon: "candy",
    })
    expect(result.stock).toBe(0)
  })
})

describe("adjustStock", () => {
  it("calls the adjust_ingredient_stock RPC with the right argument names", async () => {
    const row = {
      id: "ing-1",
      name_vi: "a",
      name_en: "a",
      subtitle_vi: "a",
      subtitle_en: "a",
      unit: "kg",
      stock_quantity: 10.2,
      low_stock_threshold: 10,
      icon: "coffee",
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await adjustStock(supabase, "ing-1", 5, "restock")

    expect(rpcSpy).toHaveBeenCalledWith("adjust_ingredient_stock", {
      p_ingredient_id: "ing-1",
      p_change: 5,
      p_reason: "restock",
    })
    expect(result.stock).toBe(10.2)
  })
})

// Mimics the real supabase-js query builder just enough for
// getInventoryLogsPage: every chain method (select/order/limit/or) returns
// the same thenable builder, so both `await query` (no cursor) and
// `await query.or(...)` (with a cursor) resolve to `result`.
function makeLogsQueryBuilder(result: { data: unknown[] | null; error: unknown }) {
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: (...args: unknown[]) => {
      limitSpy(...args)
      return builder
    },
    or: (...args: unknown[]) => {
      orSpy(...args)
      return builder
    },
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  }
  return builder
}
let limitSpy: (...args: unknown[]) => void = () => {}
let orSpy: (...args: unknown[]) => void = () => {}

function logRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "log-1",
    ingredient_id: "ing-1",
    change_quantity: -2,
    reason: "waste",
    created_at: "2026-07-06T10:00:00.000Z",
    ingredients: { name_vi: "Đường", name_en: "Sugar" },
    ...overrides,
  }
}

describe("getInventoryLogsPage", () => {
  it("maps joined rows, falling back to empty names when the ingredient join is null", async () => {
    limitSpy = vi.fn()
    orSpy = vi.fn()
    const rows = [
      logRow(),
      logRow({
        id: "log-2",
        ingredient_id: "ing-deleted",
        change_quantity: 3,
        reason: "restock",
        created_at: "2026-07-06T09:00:00.000Z",
        ingredients: null,
      }),
    ]
    const supabase = { from: () => makeLogsQueryBuilder({ data: rows, error: null }) } as unknown as SupabaseClient

    const result = await getInventoryLogsPage(supabase)

    expect(result.logs[0]).toEqual({
      id: "log-1",
      ingredientId: "ing-1",
      ingredientNameVi: "Đường",
      ingredientNameEn: "Sugar",
      change: -2,
      reason: "waste",
      timestamp: new Date("2026-07-06T10:00:00.000Z").getTime(),
    })
    expect(result.logs[1].ingredientNameVi).toBe("")
    expect(result.logs[1].ingredientNameEn).toBe("")
    expect(orSpy).not.toHaveBeenCalled()
  })

  it("requests one extra row, strips it, and returns a cursor when more rows remain", async () => {
    limitSpy = vi.fn()
    orSpy = vi.fn()
    const rows = Array.from({ length: INVENTORY_LOGS_PAGE_SIZE + 1 }, (_, i) =>
      logRow({ id: `log-${i}`, created_at: `2026-07-0${(i % 6) + 1}T10:00:00.000Z` })
    )
    const supabase = { from: () => makeLogsQueryBuilder({ data: rows, error: null }) } as unknown as SupabaseClient

    const result = await getInventoryLogsPage(supabase)

    expect(limitSpy).toHaveBeenCalledWith(INVENTORY_LOGS_PAGE_SIZE + 1)
    expect(result.logs).toHaveLength(INVENTORY_LOGS_PAGE_SIZE)
    expect(result.nextCursor).toBe(`${rows[INVENTORY_LOGS_PAGE_SIZE - 1].created_at}|${rows[INVENTORY_LOGS_PAGE_SIZE - 1].id}`)
  })

  it("returns a null cursor once the last page is reached", async () => {
    limitSpy = vi.fn()
    orSpy = vi.fn()
    const rows = [logRow()]
    const supabase = { from: () => makeLogsQueryBuilder({ data: rows, error: null }) } as unknown as SupabaseClient

    const result = await getInventoryLogsPage(supabase)

    expect(result.nextCursor).toBeNull()
  })

  it("applies a keyset filter derived from the cursor instead of an OFFSET", async () => {
    limitSpy = vi.fn()
    orSpy = vi.fn()
    const supabase = { from: () => makeLogsQueryBuilder({ data: [], error: null }) } as unknown as SupabaseClient

    await getInventoryLogsPage(supabase, "2026-07-06T10:00:00.000Z|log-1")

    expect(orSpy).toHaveBeenCalledWith(
      "created_at.lt.2026-07-06T10:00:00.000Z,and(created_at.eq.2026-07-06T10:00:00.000Z,id.lt.log-1)"
    )
  })
})

describe("getLatestInventoryLogTimestamp", () => {
  it("returns the mapped timestamp of the most recent log row", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: { created_at: "2026-07-06T10:00:00.000Z" }, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getLatestInventoryLogTimestamp(supabase)

    expect(result).toBe(new Date("2026-07-06T10:00:00.000Z").getTime())
  })

  it("returns null when there are no logs yet", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getLatestInventoryLogTimestamp(supabase)

    expect(result).toBeNull()
  })
})

describe("setMenuItemIngredients", () => {
  it("deletes existing rows then inserts one row per entry", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setMenuItemIngredients(supabase, "item-1", [{ ingredientId: "ing-1", quantityUsed: 0.02 }])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([{ menu_item_id: "item-1", ingredient_id: "ing-1", quantity_used: 0.02 }])
  })

  it("skips the insert call when entries is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setMenuItemIngredients(supabase, "item-1", [])

    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("setModifierIngredients", () => {
  it("deletes existing rows keyed by modifier_id then inserts", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setModifierIngredients(supabase, "mod-1", [{ ingredientId: "ing-1", quantityUsed: 0.01 }])

    expect(deleteEqSpy).toHaveBeenCalledWith("modifier_id", "mod-1")
    expect(insertSpy).toHaveBeenCalledWith([{ modifier_id: "mod-1", ingredient_id: "ing-1", quantity_used: 0.01 }])
  })
})
