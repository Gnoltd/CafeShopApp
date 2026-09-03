import type { SupabaseClient } from "@supabase/supabase-js"

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
  version?: number
}

export type TableSessionRoundItem = { nameVi: string; nameEn: string; quantity: number; unitPrice: number; note: string | null }

export type TableSessionRound = {
  id: string
  createdAt: number
  status: string
  paymentStatus: string
  paymentMethod: "stripe" | "cash" | "vnpay" | null
  subtotal: number
  taxAmount: number
  total: number
  items: TableSessionRoundItem[]
}

export type TableSession = {
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

type GetTableSessionJson = {
  session: { id: string; paymentPending: boolean; checkoutPromoCode: string | null; checkoutDiscountAmount: number } | null
  cartItems: {
    id: string; menuItemId: string; nameVi: string; nameEn: string
    sizeId: string | null; modifierIds: string[]; note: string | null
    unitPrice: number; quantity: number
  }[]
  rounds: {
    id: string; createdAt: number; status: string; paymentStatus: string
    paymentMethod: "stripe" | "cash" | "vnpay" | null
    subtotal: number; taxAmount: number; total: number
    items: TableSessionRoundItem[]
  }[]
  unpaidTotal: number
}

export async function getTableSession(supabase: SupabaseClient, qrToken: string): Promise<TableSession> {
  const { data, error } = await supabase.rpc("get_table_session", { p_qr_token: qrToken })
  if (error) throw error
  const json = data as GetTableSessionJson
  return {
    hasSession: json.session !== null,
    paymentPending: json.session?.paymentPending ?? false,
    checkoutPromoCode: json.session?.checkoutPromoCode ?? null,
    checkoutDiscountAmount: json.session?.checkoutDiscountAmount ?? 0,
    cartItems: json.cartItems,
    rounds: json.rounds,
    unpaidTotal: json.unpaidTotal,
  }
}

export async function addCartItem(supabase: SupabaseClient, qrToken: string, input: AddCartItemInput): Promise<void> {
  const { error } = await supabase.rpc("add_cart_item", {
    p_qr_token: qrToken,
    p_menu_item_id: input.menuItemId,
    p_size_id: input.sizeId ?? null,
    p_modifier_ids: [...input.modifierIds].sort(),
    p_note: input.note ?? null,
    p_quantity: input.quantity ?? 1,
  })
  if (error) throw error
}

export async function importTableCart(
  supabase: SupabaseClient,
  qrToken: string,
  transferId: string,
  items: AddCartItemInput[]
): Promise<number> {
  if (items.length === 0) throw new Error("cart is empty")

  const { data, error } = await supabase.rpc("import_table_cart", {
    p_qr_token: qrToken,
    p_transfer_id: transferId,
    p_items: items.map((item) => ({
      menuItemId: item.menuItemId,
      sizeId: item.sizeId ?? null,
      modifierIds: [...item.modifierIds].sort(),
      note: item.note ?? null,
      quantity: item.quantity ?? 1,
    })),
  })
  if (error) throw error
  return data as number
}

export async function updateCartItemQuantity(
  supabase: SupabaseClient,
  qrToken: string,
  cartItemId: string,
  quantity: number,
  expectedVersion?: number
): Promise<void> {
  const { error } = await supabase.rpc("update_cart_item_quantity_delta", {
    p_qr_token: qrToken,
    p_cart_item_id: cartItemId,
    p_delta: quantity,
    p_expected_version: expectedVersion ?? null,
  })
  if (error) throw error
}

export async function removeCartItem(supabase: SupabaseClient, qrToken: string, cartItemId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_cart_item", { p_qr_token: qrToken, p_cart_item_id: cartItemId })
  if (error) throw error
}

export async function placeTableRound(
  supabase: SupabaseClient,
  qrToken: string,
  submissionId = crypto.randomUUID()
): Promise<{ orderId: string; total: number }> {
  const { data, error } = await supabase.rpc("place_table_round", { p_qr_token: qrToken, p_submission_id: submissionId })
  if (error) throw error
  return data as { orderId: string; total: number }
}

export async function abandonTableSession(supabase: SupabaseClient, qrToken: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("abandon_table_session", { p_qr_token: qrToken })
  if (error) throw error
  return data as boolean
}

export async function checkoutTableSession(
  supabase: SupabaseClient,
  qrToken: string,
  method: "cash" | "stripe" | "vnpay",
  locale: string,
  promoCode?: string | null,
  attemptId = crypto.randomUUID()
): Promise<{ checkoutUrl?: string }> {
  const { data, error } = await supabase.functions.invoke("checkout-table-session", {
    body: { qrToken, method, locale, promoCode: promoCode ?? null, attemptId },
  })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { checkoutUrl?: string }
}
