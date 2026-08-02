export type OrderTotalInput = {
  subtotal: number
  discount?: number
  taxRatePercent: number
}

export type OrderTotal = {
  taxableAmount: number
  tax: number
  total: number
}

export function computeOrderTotal({ subtotal, discount = 0, taxRatePercent }: OrderTotalInput): OrderTotal {
  const taxableAmount = Math.max(subtotal - discount, 0)
  const tax = Math.round(taxableAmount * (taxRatePercent / 100))
  return { taxableAmount, tax, total: taxableAmount + tax }
}

export type PromoRule = {
  discountType: "percent" | "fixed"
  discountValue: number
}

export function resolvePromoDiscount(subtotal: number, rule: PromoRule | null): number {
  if (!rule) return 0
  const raw = rule.discountType === "percent" ? Math.round((subtotal * rule.discountValue) / 100) : rule.discountValue
  return Math.min(raw, Math.max(subtotal, 0))
}
