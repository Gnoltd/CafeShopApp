import { describe, it, expect } from "vitest"
import { validateRecipeEntries, validateExtraFields, validateMenuItemForm } from "./validate-menu-item-form"

describe("validateRecipeEntries", () => {
  it("returns the parsed entries when every quantity is a positive finite number", () => {
    const result = validateRecipeEntries({ "ing-1": 2, "ing-2": 0.5 })
    expect(result).toEqual([
      { ingredientId: "ing-1", quantityUsed: 2 },
      { ingredientId: "ing-2", quantityUsed: 0.5 },
    ])
  })

  it("returns null when a quantity is zero or negative", () => {
    expect(validateRecipeEntries({ "ing-1": 0 })).toBeNull()
    expect(validateRecipeEntries({ "ing-1": -1 })).toBeNull()
  })

  it("returns null when a quantity is not finite", () => {
    expect(validateRecipeEntries({ "ing-1": NaN })).toBeNull()
  })

  it("returns an empty array for an empty recipe", () => {
    expect(validateRecipeEntries({})).toEqual([])
  })
})

describe("validateExtraFields", () => {
  it("returns the parsed price when both names are present and price is non-negative", () => {
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "5000")).toEqual({ priceDelta: 5000 })
  })

  it("returns null when either name is blank", () => {
    expect(validateExtraFields("", "Extra Milk", "5000")).toBeNull()
    expect(validateExtraFields("Sữa thêm", "  ", "5000")).toBeNull()
  })

  it("returns null when price is negative or not a number", () => {
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "-1")).toBeNull()
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "abc")).toBeNull()
  })
})

describe("validateMenuItemForm", () => {
  const validDraft = {
    nameVi: "Cà Phê Đen",
    nameEn: "Black Coffee",
    categoryId: "cat-1",
    price: "29000",
    recipe: { "ing-1": 1 },
    sizes: [{ name: "L", price: "5000" }],
  }

  it("returns the parsed value when everything is valid", () => {
    const result = validateMenuItemForm(validDraft)
    expect(result).toEqual({
      ok: true,
      value: {
        basePrice: 29000,
        recipeEntries: [{ ingredientId: "ing-1", quantityUsed: 1 }],
        sizes: [{ name: "L", priceDelta: 5000 }],
      },
    })
  })

  it("rejects a blank name, missing category, or non-positive price", () => {
    expect(validateMenuItemForm({ ...validDraft, nameVi: "" })).toEqual({ ok: false, error: "required_fields" })
    expect(validateMenuItemForm({ ...validDraft, categoryId: "" })).toEqual({ ok: false, error: "required_fields" })
    expect(validateMenuItemForm({ ...validDraft, price: "0" })).toEqual({ ok: false, error: "required_fields" })
  })

  it("rejects a non-positive recipe quantity", () => {
    expect(validateMenuItemForm({ ...validDraft, recipe: { "ing-1": 0 } })).toEqual({
      ok: false,
      error: "recipe_quantity_required",
    })
  })

  it("rejects a blank size name", () => {
    expect(validateMenuItemForm({ ...validDraft, sizes: [{ name: "  ", price: "5000" }] })).toEqual({
      ok: false,
      error: "size_required_fields",
    })
  })

  it("rejects a negative size price", () => {
    expect(validateMenuItemForm({ ...validDraft, sizes: [{ name: "L", price: "-1" }] })).toEqual({
      ok: false,
      error: "size_required_fields",
    })
  })
})
