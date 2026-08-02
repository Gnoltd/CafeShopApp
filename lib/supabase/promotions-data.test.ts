import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getPromotions, createPromotion, updatePromotion, deletePromotion, validatePromoCode } from "./promotions-data"

const ROW = {
  id: "promo-1",
  code: "SAVE10",
  discount_type: "percent",
  discount_value: 10,
  active: true,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  times_used: 3,
  min_subtotal_vnd: null,
}

describe("getPromotions", () => {
  it("maps snake_case rows to camelCase, converting timestamps to epoch ms", async () => {
    const row = { ...ROW, starts_at: "2026-08-01T00:00:00.000Z" }
    const supabase = {
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }) }),
    } as unknown as SupabaseClient

    const result = await getPromotions(supabase)

    expect(result[0]).toEqual({
      id: "promo-1",
      code: "SAVE10",
      discountType: "percent",
      discountValue: 10,
      active: true,
      startsAt: new Date("2026-08-01T00:00:00.000Z").getTime(),
      endsAt: null,
      maxRedemptions: null,
      timesUsed: 3,
      minSubtotalVnd: null,
    })
  })
})

describe("createPromotion", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: ROW, error: null }) }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createPromotion(supabase, {
      code: "save10",
      discountType: "percent",
      discountValue: 10,
      active: true,
    })

    expect(insertSpy).toHaveBeenCalledWith({
      code: "SAVE10",
      discount_type: "percent",
      discount_value: 10,
      active: true,
      starts_at: null,
      ends_at: null,
      max_redemptions: null,
      min_subtotal_vnd: null,
    })
    expect(result.code).toBe("SAVE10")
    expect(result.timesUsed).toBe(3)
  })
})

describe("updatePromotion", () => {
  it("updates the row by id and returns the mapped result", async () => {
    const eqSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { ...ROW, active: false }, error: null }) }),
    }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    const result = await updatePromotion(supabase, "promo-1", {
      code: "SAVE10",
      discountType: "percent",
      discountValue: 10,
      active: false,
    })

    expect(eqSpy).toHaveBeenCalledWith("id", "promo-1")
    expect(result.active).toBe(false)
  })
})

describe("deletePromotion", () => {
  it("deletes by id", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = { from: () => ({ delete: () => ({ eq: eqSpy }) }) } as unknown as SupabaseClient

    await deletePromotion(supabase, "promo-1")

    expect(eqSpy).toHaveBeenCalledWith("id", "promo-1")
  })
})

describe("validatePromoCode", () => {
  it("calls the RPC with the code and subtotal, returning the result as-is", async () => {
    const rpcSpy = vi.fn(() =>
      Promise.resolve({ data: { valid: true, discountType: "percent", discountValue: 10, discountAmount: 5000 }, error: null })
    )
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await validatePromoCode(supabase, "SAVE10", 50000)

    expect(rpcSpy).toHaveBeenCalledWith("validate_promo_code", { p_code: "SAVE10", p_subtotal: 50000 })
    expect(result).toEqual({ valid: true, discountType: "percent", discountValue: 10, discountAmount: 5000 })
  })

  it("throws on RPC error", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(validatePromoCode(supabase, "SAVE10", 50000)).rejects.toThrow("boom")
  })
})
