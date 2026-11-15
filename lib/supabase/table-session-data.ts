import type { SupabaseClient } from "@supabase/supabase-js"
import type { RealPaymentMethod } from "./order-mapping"

export type TableSessionCartItem = {
  id: string
  menuItemId: string
  nameVi: string
  nameEn: string
  sizeId: string | null
  modifierIds: string[]
  note: string | null
  unitPrice: number
  quantity: number
  version: number
}

export type TableSessionRoundItem = {
  nameVi: string
  nameEn: string
  quantity: number
  unitPrice: number
  note: string | null
}

export type TableSessionRound = {
  id: string
  createdAt: number
  status: string
  paymentStatus: string
  paymentMethod: RealPaymentMethod | null
  subtotal: number
  taxAmount: number
  total: number
  items: TableSessionRoundItem[]
}

export type TableSession = {
  /** Active session id, or null when this table has no active session yet. */
  sessionId: string | null
  hasSession: boolean
  paymentPending: boolean
  checkoutPromoCode: string | null
  checkoutDiscountAmount: number
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
}

export type AddCartItemInput = {
  menuItemId: string
  sizeId?: string | null
  modifierIds: string[]
  note?: string | null
  quantity?: number
}

export type PlaceTableRoundResult = {
  orderId: string
  total: number
}

/**
 * Capability port for guest table-session operations keyed by QR token.
 * Hides Supabase RPC names, cash-only checkout defaults, optimistic versions,
 * and historical DB compatibility fallbacks behind one contract.
 */
export type TableSessionPort = {
  getSession: (qrToken: string) => Promise<TableSession>
  addCartItem: (qrToken: string, input: AddCartItemInput) => Promise<void>
  updateCartItemQuantity: (
    qrToken: string,
    cartItemId: string,
    delta: number,
    expectedVersion?: number
  ) => Promise<void>
  removeCartItem: (qrToken: string, cartItemId: string) => Promise<void>
  placeRound: (qrToken: string, submissionId?: string) => Promise<PlaceTableRoundResult>
  abandonSession: (qrToken: string) => Promise<boolean>
  requestBill: (qrToken: string) => Promise<void>
}

type GetTableSessionJson = {
  session: {
    id: string
    paymentPending: boolean
    checkoutPromoCode: string | null
    checkoutDiscountAmount: number
  } | null
  cartItems: {
    id: string
    menuItemId: string
    nameVi: string
    nameEn: string
    sizeId: string | null
    modifierIds: string[]
    note: string | null
    unitPrice: number
    quantity: number
    version?: number
  }[]
  rounds: {
    id: string
    createdAt: number
    status: string
    paymentStatus: string
    paymentMethod: RealPaymentMethod | null
    subtotal: number
    taxAmount: number
    total: number
    items: TableSessionRoundItem[]
  }[]
  unpaidTotal: number
}

/**
 * Returns true when an error indicates an optimistic-version conflict on a
 * shared cart row (`stale_cart_item`), whether thrown as an Error instance
 * or returned as a PostgREST error object.
 */
export function isStaleCartItemError(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes("stale_cart_item")
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).includes("stale_cart_item")
  }
  return false
}

/** Creates the Supabase RPC-backed `TableSessionPort` implementation. */
export function createSupabaseTableSessionAdapter(supabase: SupabaseClient): TableSessionPort {
  return {
    async getSession(qrToken: string): Promise<TableSession> {
      const { data, error } = await supabase.rpc("get_table_session", { p_qr_token: qrToken })
      if (error) throw error
      const json = data as GetTableSessionJson
      return {
        sessionId: json.session?.id ?? null,
        hasSession: json.session !== null,
        paymentPending: json.session?.paymentPending ?? false,
        checkoutPromoCode: json.session?.checkoutPromoCode ?? null,
        checkoutDiscountAmount: json.session?.checkoutDiscountAmount ?? 0,
        cartItems: json.cartItems.map((item) => ({ ...item, version: item.version ?? 0 })),
        rounds: json.rounds,
        unpaidTotal: json.unpaidTotal,
      }
    },

    async addCartItem(qrToken: string, input: AddCartItemInput): Promise<void> {
      const { error } = await supabase.rpc("add_cart_item", {
        p_qr_token: qrToken,
        p_menu_item_id: input.menuItemId,
        p_size_id: input.sizeId ?? null,
        p_modifier_ids: [...input.modifierIds].sort(),
        p_note: input.note ?? null,
        p_quantity: input.quantity ?? 1,
      })
      if (error) throw error
    },

    async updateCartItemQuantity(
      qrToken: string,
      cartItemId: string,
      delta: number,
      expectedVersion?: number
    ): Promise<void> {
      const { error } = await supabase.rpc("update_cart_item_quantity_delta", {
        p_qr_token: qrToken,
        p_cart_item_id: cartItemId,
        p_delta: delta,
        p_expected_version: expectedVersion ?? null,
      })
      if (error) throw error
    },

    async removeCartItem(qrToken: string, cartItemId: string): Promise<void> {
      const { error } = await supabase.rpc("remove_cart_item", {
        p_qr_token: qrToken,
        p_cart_item_id: cartItemId,
      })
      if (error) throw error
    },

    async placeRound(
      qrToken: string,
      submissionId = crypto.randomUUID()
    ): Promise<PlaceTableRoundResult> {
      const { data, error } = await supabase.rpc("place_table_round", {
        p_qr_token: qrToken,
        p_submission_id: submissionId,
      })
      // Production may temporarily be behind migration 0085. PostgREST's
      // PGRST202 means this exact overload is absent; only then is the legacy
      // one-argument function safe to try. Business/RLS/RPC failures must stay
      // visible to the caller and must never be replayed without idempotency.
      if (error && error.code === "PGRST202") {
        const legacy = await supabase.rpc("place_table_round", { p_qr_token: qrToken })
        if (legacy.error) throw legacy.error
        return legacy.data as PlaceTableRoundResult
      }
      if (error) throw error
      return data as PlaceTableRoundResult
    },

    async abandonSession(qrToken: string): Promise<boolean> {
      const { data, error } = await supabase.rpc("abandon_table_session", { p_qr_token: qrToken })
      if (error) throw error
      return data as boolean
    },

    async requestBill(qrToken: string): Promise<void> {
      const { error } = await supabase.rpc("checkout_table_session", {
        p_qr_token: qrToken,
        p_method: "cash",
        p_promo_code: null,
      })
      if (error) throw error
    },
  }
}
