import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getTableSession,
  addCartItem,
  updateCartItemQuantity,
  removeCartItem,
  placeTableRound,
  abandonTableSession,
  checkoutTableSession,
  importTableCart,
} from "./table-session-data"

function mockRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  return { rpc, supabase: { rpc } as unknown as SupabaseClient }
}

describe("getTableSession", () => {
  it("maps a null session to hasSession: false with defaults", async () => {
    const { supabase } = mockRpc({
      data: { session: null, cartItems: [], rounds: [], unpaidTotal: 0 },
      error: null,
    })
    const result = await getTableSession(supabase, "qr-token-1")
    expect(result).toEqual({
      hasSession: false,
      paymentPending: false,
      checkoutPromoCode: null,
      checkoutDiscountAmount: 0,
      cartItems: [],
      rounds: [],
      unpaidTotal: 0,
    })
  })

  it("maps an active session", async () => {
    const { supabase } = mockRpc({
      data: {
        session: { id: "session-1", paymentPending: true, checkoutPromoCode: "SAVE10", checkoutDiscountAmount: 5000 },
        cartItems: [{ id: "ci-1", menuItemId: "mi-1", nameVi: "Cà phê", nameEn: "Coffee", sizeId: null, modifierIds: [], note: null, unitPrice: 30000, quantity: 2 }],
        rounds: [],
        unpaidTotal: 60000,
      },
      error: null,
    })
    const result = await getTableSession(supabase, "qr-token-1")
    expect(result.hasSession).toBe(true)
    expect(result.paymentPending).toBe(true)
    expect(result.checkoutPromoCode).toBe("SAVE10")
    expect(result.cartItems).toHaveLength(1)
    expect(result.unpaidTotal).toBe(60000)
  })

  it("calls the RPC with p_qr_token", async () => {
    const { rpc, supabase } = mockRpc({
      data: { session: null, cartItems: [], rounds: [], unpaidTotal: 0 },
      error: null,
    })
    await getTableSession(supabase, "qr-token-1")
    expect(rpc).toHaveBeenCalledWith("get_table_session", { p_qr_token: "qr-token-1" })
  })

  it("throws on error", async () => {
    const { supabase } = mockRpc({ data: null, error: new Error("boom") })
    await expect(getTableSession(supabase, "qr-token-1")).rejects.toThrow("boom")
  })
})

describe("addCartItem", () => {
  it("sorts modifierIds before calling the RPC", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await addCartItem(supabase, "qr-token-1", {
      menuItemId: "mi-1",
      sizeId: "size-1",
      modifierIds: ["mod-b", "mod-a"],
      note: "less ice",
      quantity: 2,
    })
    expect(rpc).toHaveBeenCalledWith("add_cart_item", {
      p_qr_token: "qr-token-1",
      p_menu_item_id: "mi-1",
      p_size_id: "size-1",
      p_modifier_ids: ["mod-a", "mod-b"],
      p_note: "less ice",
      p_quantity: 2,
    })
  })

  it("defaults sizeId/note to null and quantity to 1", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await addCartItem(supabase, "qr-token-1", { menuItemId: "mi-1", modifierIds: [] })
    expect(rpc).toHaveBeenCalledWith("add_cart_item", {
      p_qr_token: "qr-token-1",
      p_menu_item_id: "mi-1",
      p_size_id: null,
      p_modifier_ids: [],
      p_note: null,
      p_quantity: 1,
    })
  })
})

describe("importTableCart", () => {
  it("sends the complete cart to one atomic RPC", async () => {
    const { rpc, supabase } = mockRpc({ data: 2, error: null })

    const imported = await importTableCart(supabase, "qr-token-1", "transfer-1", [
      {
        menuItemId: "mi-1",
        sizeId: "size-1",
        modifierIds: ["mod-b", "mod-a"],
        note: "less ice",
        quantity: 2,
      },
      { menuItemId: "mi-2", modifierIds: [], quantity: 1 },
    ])

    expect(rpc).toHaveBeenCalledWith("import_table_cart", {
      p_qr_token: "qr-token-1",
      p_transfer_id: "transfer-1",
      p_items: [
        {
          menuItemId: "mi-1",
          sizeId: "size-1",
          modifierIds: ["mod-a", "mod-b"],
          note: "less ice",
          quantity: 2,
        },
        {
          menuItemId: "mi-2",
          sizeId: null,
          modifierIds: [],
          note: null,
          quantity: 1,
        },
      ],
    })
    expect(imported).toBe(2)
  })

  it("throws without calling the RPC for an empty cart", async () => {
    const { rpc, supabase } = mockRpc({ data: 0, error: null })

    await expect(importTableCart(supabase, "qr-token-1", "transfer-1", [])).rejects.toThrow("cart is empty")
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("updateCartItemQuantity", () => {
  it("calls the RPC with qrToken, cartItemId and quantity", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await updateCartItemQuantity(supabase, "qr-token-1", "ci-1", 3)
    expect(rpc).toHaveBeenCalledWith("update_cart_item_quantity_delta", {
      p_qr_token: "qr-token-1",
      p_cart_item_id: "ci-1",
      p_delta: 3,
      p_expected_version: null,
    })
  })
})

describe("removeCartItem", () => {
  it("calls the RPC with qrToken and cartItemId", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await removeCartItem(supabase, "qr-token-1", "ci-1")
    expect(rpc).toHaveBeenCalledWith("remove_cart_item", { p_qr_token: "qr-token-1", p_cart_item_id: "ci-1" })
  })
})

describe("placeTableRound", () => {
  it("returns the RPC's orderId/total", async () => {
    const { supabase } = mockRpc({ data: { orderId: "order-1", total: 90000 }, error: null })
    const result = await placeTableRound(supabase, "qr-token-1")
    expect(result).toEqual({ orderId: "order-1", total: 90000 })
  })

  it("calls the RPC with p_qr_token", async () => {
    const { rpc, supabase } = mockRpc({ data: { orderId: "order-1", total: 90000 }, error: null })
    await placeTableRound(supabase, "qr-token-1", "submission-1")
    expect(rpc).toHaveBeenCalledWith("place_table_round", { p_qr_token: "qr-token-1", p_submission_id: "submission-1" })
  })
})

describe("abandonTableSession", () => {
  it("returns the RPC's boolean", async () => {
    const { supabase } = mockRpc({ data: true, error: null })
    const result = await abandonTableSession(supabase, "qr-token-1")
    expect(result).toBe(true)
  })

  it("calls the RPC with p_qr_token", async () => {
    const { rpc, supabase } = mockRpc({ data: true, error: null })
    await abandonTableSession(supabase, "qr-token-1")
    expect(rpc).toHaveBeenCalledWith("abandon_table_session", { p_qr_token: "qr-token-1" })
  })
})

describe("checkoutTableSession", () => {
  it("invokes checkout-table-session with qrToken/method/locale/promoCode", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { checkoutUrl: "https://example.com/pay" }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient

    const result = await checkoutTableSession(supabase, "qr-token-1", "vnpay", "vi", "SAVE10")

    expect(invoke).toHaveBeenCalledWith("checkout-table-session", {
      body: { qrToken: "qr-token-1", method: "vnpay", locale: "vi", promoCode: "SAVE10", attemptId: expect.any(String) },
    })
    expect(result.checkoutUrl).toBe("https://example.com/pay")
  })

  it("defaults promoCode to null", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient

    await checkoutTableSession(supabase, "qr-token-1", "cash", "en")

    expect(invoke).toHaveBeenCalledWith("checkout-table-session", {
      body: { qrToken: "qr-token-1", method: "cash", locale: "en", promoCode: null, attemptId: expect.any(String) },
    })
  })

  it("throws when the invoke response carries an error field", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { error: "no_active_session" }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient
    await expect(checkoutTableSession(supabase, "qr-token-1", "cash", "vi")).rejects.toThrow("no_active_session")
  })
})
