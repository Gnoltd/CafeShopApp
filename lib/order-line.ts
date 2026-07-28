export type OrderLineKeyInput = {
  menuItemId: string
  sizeId: string | null
  modifierIds: string[]
  note?: string | null
}

/** Identity key for merging two adds of the same item/size/extras/note into one line. */
export function buildOrderLineKey({ menuItemId, sizeId, modifierIds, note }: OrderLineKeyInput): string {
  const modifierKey = [...modifierIds].sort().join(",")
  return [menuItemId, sizeId ?? "no-size", modifierKey, note ?? ""].join("|")
}

export type OrderTotals = { taxableAmount: number; tax: number; total: number }

/** Tax is computed on the post-discount amount, rounded, and never goes negative. */
export function computeOrderTotals(subtotal: number, discount: number, taxRatePercent: number): OrderTotals {
  const taxableAmount = Math.max(subtotal - discount, 0)
  const tax = Math.round(taxableAmount * (taxRatePercent / 100))
  return { taxableAmount, tax, total: taxableAmount + tax }
}
