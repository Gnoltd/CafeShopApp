import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getShopSettings, updateShopSettings } from "./settings-data"

describe("getShopSettings", () => {
  it("maps the row to camelCase", async () => {
    const row = { shop_name: "PhaDinCafe", address: "123 Le Loi", phone: "0900000000", opening_hours: "07:00 - 22:00" }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getShopSettings(supabase)

    expect(selectSpy).toHaveBeenCalledWith("shop_name, address, phone, opening_hours")
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
    expect(result).toEqual({
      shopName: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      openingHours: "07:00 - 22:00",
    })
  })

  it("falls back to empty strings for null optional fields", async () => {
    const row = { shop_name: "My Coffee Shop", address: null, phone: null, opening_hours: null }
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) }),
    } as unknown as SupabaseClient

    const result = await getShopSettings(supabase)

    expect(result.address).toBe("")
    expect(result.phone).toBe("")
    expect(result.openingHours).toBe("")
  })
})

describe("updateShopSettings", () => {
  it("writes shop name/address/phone/hours", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateShopSettings(supabase, {
      shopName: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      openingHours: "07:00 - 22:00",
    })

    expect(updateSpy).toHaveBeenCalledWith({
      shop_name: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      opening_hours: "07:00 - 22:00",
    })
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
  })

  it("throws when the update errors", async () => {
    const supabase = {
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: new Error("boom") }) }) }),
    } as unknown as SupabaseClient

    await expect(updateShopSettings(supabase, {
      shopName: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      openingHours: "07:00 - 22:00",
    })).rejects.toThrow("boom")
  })
})
