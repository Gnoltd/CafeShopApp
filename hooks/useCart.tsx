"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { validatePromoCode, type PromoValidation } from "@/lib/supabase/promotions-data"
import { resolvePromoDiscount, type PromoRule } from "@/lib/order-total"
import { subtractTransferredQuantities, type TableCartTransferItem } from "@/lib/table-cart-transfer"

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

type CartContextValue = {
  items: CartItem[]
  addItem: (item: AddToCartInput, quantity?: number) => void
  updateQuantity: (cartItemId: string, quantity: number) => void
  removeItem: (cartItemId: string) => void
  clear: () => void
  consumeTransfer: (items: TableCartTransferItem[]) => void
  subtotal: number
  itemCount: number
  promoCode: string | null
  promoDiscount: number
  applyPromoCode: (code: string) => Promise<PromoValidation>
  clearPromoCode: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = "phadincafe-cart"

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
  const [supabase] = useState(() => createClient())
  const [items, setItems] = useState<CartItem[]>([])
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [promoRule, setPromoRule] = useState<PromoRule | null>(null)
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
    setPromoRule(null)
  }

  function consumeTransfer(transferredItems: TableCartTransferItem[]) {
    setItems((prev) => subtractTransferredQuantities(prev, transferredItems))
    setPromoCode(null)
    setPromoRule(null)
  }

  async function applyPromoCode(code: string): Promise<PromoValidation> {
    const normalized = code.trim().toUpperCase()
    const result = await validatePromoCode(supabase, normalized, subtotal)
    if (result.valid) {
      setPromoCode(normalized)
      setPromoRule({ discountType: result.discountType, discountValue: result.discountValue })
    }
    return result
  }

  function clearPromoCode() {
    setPromoCode(null)
    setPromoRule(null)
  }

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items]
  )
  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  )
  const promoDiscount = useMemo(() => resolvePromoDiscount(subtotal, promoRule), [subtotal, promoRule])

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        updateQuantity,
        removeItem,
        clear,
        consumeTransfer,
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
