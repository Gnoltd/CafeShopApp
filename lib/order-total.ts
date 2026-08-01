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
