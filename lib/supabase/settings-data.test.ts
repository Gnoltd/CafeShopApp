import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getShopSettings,
  updateShopSettings,
  getLoyaltySettings,
  updateLoyaltySettings,
  getLandingHeroSettings,
  updateLandingHeroSettings,
} from "./settings-data"

describe("getShopSettings", () => {
  it("maps the row to camelCase and converts tax_rate to a whole percent", async () => {
    const row = { shop_name: "PhaDinCafe", address: "123 Le Loi", phone: "0900000000", opening_hours: "07:00 - 22:00", tax_rate: "0.0800" }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getShopSettings(supabase)

    expect(selectSpy).toHaveBeenCalledWith("shop_name, address, phone, opening_hours, tax_rate")
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
    expect(result).toEqual({
      shopName: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      openingHours: "07:00 - 22:00",
      taxRatePercent: 8,
    })
  })

  it("falls back to empty strings for null optional fields", async () => {
    const row = { shop_name: "My Coffee Shop", address: null, phone: null, opening_hours: null, tax_rate: 0 }
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) }),
    } as unknown as SupabaseClient

    const result = await getShopSettings(supabase)

    expect(result.address).toBe("")
    expect(result.phone).toBe("")
    expect(result.openingHours).toBe("")
    expect(result.taxRatePercent).toBe(0)
  })
})

describe("updateShopSettings", () => {
  it("converts the whole-percent tax rate back to a decimal fraction on write", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateShopSettings(supabase, {
      shopName: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      openingHours: "07:00 - 22:00",
      taxRatePercent: 8.5,
    })

    expect(updateSpy).toHaveBeenCalledWith({
      shop_name: "PhaDinCafe",
      address: "123 Le Loi",
      phone: "0900000000",
      opening_hours: "07:00 - 22:00",
      tax_rate: 0.085,
    })
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
  })

  it.each([
    [0, 0],
    [100, 1],
  ])("accepts the inclusive tax boundary %s%%", async (taxRatePercent, storedTaxRate) => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateShopSettings(supabase, {
      shopName: "PhaDinCafe",
      address: "",
      phone: "",
      openingHours: "",
      taxRatePercent,
    })

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ tax_rate: storedTaxRate }))
  })

  it.each([-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid tax percentage (%s) before writing",
    async (taxRatePercent) => {
      const updateSpy = vi.fn()
      const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

      await expect(updateShopSettings(supabase, {
        shopName: "PhaDinCafe",
        address: "123 Le Loi",
        phone: "0900000000",
        openingHours: "07:00 - 22:00",
        taxRatePercent,
      })).rejects.toMatchObject({ field: "taxRatePercent" })

      expect(updateSpy).not.toHaveBeenCalled()
    }
  )

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid earning rate (%s) before writing any settings",
    async (earnRateVndPerPoint) => {
      const updateSpy = vi.fn()
      const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

      await expect(updateLoyaltySettings(supabase, {
        enabled: true,
        earnRateVndPerPoint,
        redeemValueVndPerPoint: 100,
      })).rejects.toMatchObject({ field: "earnRateVndPerPoint" })

      expect(updateSpy).not.toHaveBeenCalled()
    }
  )

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid redemption value (%s) before writing any settings",
    async (redeemValueVndPerPoint) => {
      const updateSpy = vi.fn()
      const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

      await expect(updateLoyaltySettings(supabase, {
        enabled: true,
        earnRateVndPerPoint: 10000,
        redeemValueVndPerPoint,
      })).rejects.toMatchObject({ field: "redeemValueVndPerPoint" })

      expect(updateSpy).not.toHaveBeenCalled()
    }
  )
})

describe("getLoyaltySettings", () => {
  it("maps the row to camelCase", async () => {
    const row = { enabled: true, earn_rate_vnd_per_point: 10000, redeem_value_vnd_per_point: 100 }
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) }),
    } as unknown as SupabaseClient

    expect(await getLoyaltySettings(supabase)).toEqual({
      enabled: true,
      earnRateVndPerPoint: 10000,
      redeemValueVndPerPoint: 100,
    })
  })
})

describe("updateLoyaltySettings", () => {
  it("writes enabled + both rates", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateLoyaltySettings(supabase, { enabled: false, earnRateVndPerPoint: 5000, redeemValueVndPerPoint: 200 })

    expect(updateSpy).toHaveBeenCalledWith({
      enabled: false,
      earn_rate_vnd_per_point: 5000,
      redeem_value_vnd_per_point: 200,
    })
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
  })

  it("accepts the minimum earning rate and zero redemption value", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateLoyaltySettings(supabase, {
      enabled: true,
      earnRateVndPerPoint: 1,
      redeemValueVndPerPoint: 0,
    })

    expect(updateSpy).toHaveBeenCalledWith({
      enabled: true,
      earn_rate_vnd_per_point: 1,
      redeem_value_vnd_per_point: 0,
    })
  })

  it("throws when the update errors", async () => {
    const supabase = {
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: new Error("boom") }) }) }),
    } as unknown as SupabaseClient

    await expect(updateLoyaltySettings(supabase, { enabled: true, earnRateVndPerPoint: 10000, redeemValueVndPerPoint: 100 })).rejects.toThrow("boom")
  })
})

describe("getLandingHeroSettings", () => {
  it("maps the row to camelCase", async () => {
    const row = {
      landing_hero_base_images: ["https://x/base-1.webp", "https://x/base-2.webp", "https://x/base-3.webp"],
      landing_hero_reveal_image: "https://x/reveal.webp",
    }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getLandingHeroSettings(supabase)

    expect(selectSpy).toHaveBeenCalledWith("landing_hero_base_images, landing_hero_reveal_image")
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
    expect(result).toEqual({
      baseImages: ["https://x/base-1.webp", "https://x/base-2.webp", "https://x/base-3.webp"],
      revealImage: "https://x/reveal.webp",
    })
  })

  it("maps a null reveal image to null", async () => {
    const row = { landing_hero_base_images: [], landing_hero_reveal_image: null }
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) }),
    } as unknown as SupabaseClient

    const result = await getLandingHeroSettings(supabase)

    expect(result.revealImage).toBeNull()
    expect(result.baseImages).toEqual([])
  })
})

describe("updateLandingHeroSettings", () => {
  it("writes both columns", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateLandingHeroSettings(supabase, {
      baseImages: ["https://x/1.webp", "https://x/2.webp", "https://x/3.webp"],
      revealImage: "https://x/reveal.webp",
    })

    expect(updateSpy).toHaveBeenCalledWith({
      landing_hero_base_images: ["https://x/1.webp", "https://x/2.webp", "https://x/3.webp"],
      landing_hero_reveal_image: "https://x/reveal.webp",
    })
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
  })
})
