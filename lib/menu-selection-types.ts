export type CartModifier = {
  groupId: string
  optionId: string
  labelVi: string
  labelEn: string
  priceDelta: number
}

export type CartItem = {
  cartItemId: string
  menuItemId: string
  nameVi: string
  nameEn: string
  size?: { id: string; label: string; priceDelta: number }
  modifiers: CartModifier[]
  note?: string
  unitPrice: number
  quantity: number
  needsConfiguration?: boolean
}

export type AddToCartInput = Omit<CartItem, "cartItemId" | "quantity">
