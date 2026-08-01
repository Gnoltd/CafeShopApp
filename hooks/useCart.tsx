"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

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
}

type AddToCartInput = Omit<CartItem, "cartItemId" | "quantity">

type CartContextValue = {
  items: CartItem[]
  addItem: (item: AddToCartInput, quantity?: number) => void
  updateQuantity: (cartItemId: string, quantity: number) => void
  removeItem: (cartItemId: string) => void
  clear: () => void
  subtotal: number
  itemCount: number
  promoCode: string | null
  promoDiscount: number
  applyPromoCode: (code: string) => boolean
  clearPromoCode: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = "phadincafe-cart"

/** No `promotions` table yet — a single hardcoded valid code, 10% off subtotal. */
const VALID_PROMO_CODES: Record<string, number> = {
  WELCOME10: 0.1,
}

function buildCartItemId(item: AddToCartInput): string {
  const modifierKey = item.modifiers
    .map((m) => m.optionId)
    .sort()
    .join(",")
  // Note is part of the identity key so two adds of the same drink with
  // different notes (e.g. "less sugar" vs "extra ice") stay separate lines
  // instead of silently merging and dropping one note.
  return [item.menuItemId, item.size?.id ?? "no-size", modifierKey, item.note ?? ""].join("|")
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setItems(JSON.parse(stored))
    } catch {
      // ignore malformed/unavailable storage
    } finally {
      setHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items, hydrated])

  function addItem(item: AddToCartInput, quantity = 1) {
    const cartItemId = buildCartItemId(item)
    setItems((prev) => {
      const existing = prev.find((i) => i.cartItemId === cartItemId)
      if (existing) {
        return prev.map((i) =>
          i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + quantity } : i
        )
      }
      return [...prev, { ...item, cartItemId, quantity }]
    })
  }

  function updateQuantity(cartItemId: string, quantity: number) {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((i) => i.cartItemId !== cartItemId)
        : prev.map((i) => (i.cartItemId === cartItemId ? { ...i, quantity } : i))
    )
  }

  function removeItem(cartItemId: string) {
    setItems((prev) => prev.filter((i) => i.cartItemId !== cartItemId))
  }

  function clear() {
    setItems([])
    setPromoCode(null)
  }

  function applyPromoCode(code: string): boolean {
    const normalized = code.trim().toUpperCase()
    if (!(normalized in VALID_PROMO_CODES)) return false
    setPromoCode(normalized)
    return true
  }

  function clearPromoCode() {
    setPromoCode(null)
  }

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items]
  )
  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  )
  const promoDiscount = useMemo(
    () => (promoCode ? Math.round(subtotal * VALID_PROMO_CODES[promoCode]) : 0),
    [promoCode, subtotal]
  )

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        updateQuantity,
        removeItem,
        clear,
        subtotal,
        itemCount,
        promoCode,
        promoDiscount,
        applyPromoCode,
        clearPromoCode,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error("useCart must be used within a CartProvider")
  return ctx
}
