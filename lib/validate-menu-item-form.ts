export type RecipeEntry = { ingredientId: string; quantityUsed: number }

/** Shared by the item's own recipe and an extra's recipe -- both need "every quantity is a positive finite number." */
export function validateRecipeEntries(recipe: Record<string, number>): RecipeEntry[] | null {
  const entries = Object.entries(recipe).map(([ingredientId, quantityUsed]) => ({ ingredientId, quantityUsed }))
  if (entries.some((e) => !Number.isFinite(e.quantityUsed) || e.quantityUsed <= 0)) return null
  return entries
}

/** Shared by add-extra and edit-extra -- both need "both names present, price a non-negative number." */
export function validateExtraFields(nameVi: string, nameEn: string, price: string): { priceDelta: number } | null {
  const priceDelta = Number(price)
  if (!nameVi.trim() || !nameEn.trim() || !Number.isFinite(priceDelta) || priceDelta < 0) return null
  return { priceDelta }
}

export type MenuItemFormDraft = {
  nameVi: string
  nameEn: string
  categoryId: string
  price: string
  recipe: Record<string, number>
  sizes: { name: string; price: string }[]
}

export type MenuItemFormError = "required_fields" | "recipe_quantity_required" | "size_required_fields"

export type MenuItemFormValidated = {
  basePrice: number
  recipeEntries: RecipeEntry[]
  sizes: { name: string; priceDelta: number }[]
}

export function validateMenuItemForm(
  draft: MenuItemFormDraft
): { ok: true; value: MenuItemFormValidated } | { ok: false; error: MenuItemFormError } {
  const basePrice = Number(draft.price)
  if (!draft.nameVi.trim() || !draft.nameEn.trim() || !draft.categoryId || !Number.isFinite(basePrice) || basePrice <= 0) {
    return { ok: false, error: "required_fields" }
  }

  const recipeEntries = validateRecipeEntries(draft.recipe)
  if (!recipeEntries) {
    return { ok: false, error: "recipe_quantity_required" }
  }

  if (draft.sizes.some((s) => !s.name.trim())) {
    return { ok: false, error: "size_required_fields" }
  }
  const sizes = draft.sizes.map((s) => ({ name: s.name.trim(), priceDelta: Number(s.price) }))
  if (sizes.some((s) => !Number.isFinite(s.priceDelta) || s.priceDelta < 0)) {
    return { ok: false, error: "size_required_fields" }
  }

  return { ok: true, value: { basePrice, recipeEntries, sizes } }
}
