import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getOrderHistory, getOrderHistoryDetail } from "./order-history"

describe("getOrderHistory", () => {
  it("calls the RPC with snake_case params built from camelCase filters", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(
      supabase,
      { dateFrom: "2026-07-01", dateTo: "2026-07-07", statuses: ["completed"], orderType: "dine-in", search: "A1B2" },
      { limit: 20, offset: 0 }
    )

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: "2026-07-01",
      p_date_to: "2026-07-07",
      p_statuses: ["completed"],
      p_order_type: "dine_in",
      p_search: "A1B2",
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("omits order type and passes null search when not provided", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: null,
      p_date_to: null,
      p_statuses: null,
      p_order_type: null,
      p_search: null,
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("maps snake_case rows to camelCase, translating order_type and defaulting a null customer name to undefined", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "dine_in",
      table_number: "5",
      customer_name: null,
      payment_method: "cash",
      status: "completed",
      total: 60000,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [row], totalCount: 1 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(result.totalCount).toBe(1)
    expect(result.rows[0]).toEqual({
      id: "ord-1",
      createdAt: new Date("2026-07-06T10:00:00.000Z").getTime(),
      orderType: "dine-in",
      table: "5",
      customerName: undefined,
      paymentMethod: "cash",
      status: "completed",
      total: 60000,
    })
  })
})

describe("getOrderHistoryDetail", () => {
  it("selects a single order by id with the staff detail shape and maps a guest's null profile to an undefined customerName", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "pickup",
      status: "completed",
      subtotal: 60000,
      discount_amount: 0,
      total: 60000,
      table_id: null,
      payment_method: "cash",
      payment_status: "paid",
      tables: null,
      profiles: null,
      order_items: [{ quantity: 1, unit_price: 60000, note: null, menu_items: { name_vi: "a", name_en: "b" } }],
    }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "ord-1")

    expect(eqSpy).toHaveBeenCalledWith("id", "ord-1")
    expect(result?.customerName).toBeUndefined()
    expect(result?.paymentMethod).toBe("cash")
    expect(result?.paymentStatus).toBe("paid")
  })

  it("returns null when no matching row is found", async () => {
    const singleSpy = vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } }))
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: singleSpy }) }) }),
    } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "unknown-id")
    expect(result).toBeNull()
  })
})
