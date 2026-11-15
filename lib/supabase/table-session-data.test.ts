import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseTableSessionAdapter, isStaleCartItemError } from "./table-session-data"

function mockRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  const supabase = { rpc } as unknown as SupabaseClient
  return { rpc, adapter: createSupabaseTableSessionAdapter(supabase) }
}

describe("createSupabaseTableSessionAdapter", () => {
  describe("getSession", () => {
    it("maps a null session to hasSession: false with defaults", async () => {
      const { adapter } = mockRpc({
        data: { session: null, cartItems: [], rounds: [], unpaidTotal: 0 },
        error: null,
      })
      const result = await adapter.getSession("qr-token-1")
      expect(result).toEqual({
        sessionId: null,
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
      const { adapter } = mockRpc({
        data: {
          session: {
            id: "session-1",
            paymentPending: true,
            checkoutPromoCode: "SAVE10",
            checkoutDiscountAmount: 5000,
          },
          cartItems: [
            {
              id: "ci-1",
              menuItemId: "mi-1",
              nameVi: "Cà phê",
              nameEn: "Coffee",
              sizeId: null,
              modifierIds: [],
              note: null,
              unitPrice: 30000,
              quantity: 2,
            },
          ],
          rounds: [],
          unpaidTotal: 60000,
        },
        error: null,
      })
      const result = await adapter.getSession("qr-token-1")
      expect(result.sessionId).toBe("session-1")
      expect(result.hasSession).toBe(true)
      expect(result.paymentPending).toBe(true)
      expect(result.checkoutPromoCode).toBe("SAVE10")
      expect(result.cartItems).toHaveLength(1)
      expect(result.unpaidTotal).toBe(60000)
    })

    it("preserves the server cart version for optimistic mutations", async () => {
      const { adapter } = mockRpc({
        data: {
          session: null,
          cartItems: [
            {
              id: "ci-1",
              menuItemId: "mi-1",
              nameVi: "x",
              nameEn: "x",
              sizeId: null,
              modifierIds: [],
              note: null,
              unitPrice: 1,
              quantity: 2,
              version: 7,
            },
          ],
          rounds: [],
          unpaidTotal: 0,
        },
        error: null,
      })
      const result = await adapter.getSession("qr-token-1")
      expect(result.cartItems[0].version).toBe(7)
    })

    it("calls the RPC with p_qr_token", async () => {
      const { rpc, adapter } = mockRpc({
        data: { session: null, cartItems: [], rounds: [], unpaidTotal: 0 },
        error: null,
      })
      await adapter.getSession("qr-token-1")
      expect(rpc).toHaveBeenCalledWith("get_table_session", { p_qr_token: "qr-token-1" })
    })

    it("throws on error", async () => {
      const { adapter } = mockRpc({ data: null, error: new Error("boom") })
      await expect(adapter.getSession("qr-token-1")).rejects.toThrow("boom")
    })
  })

  describe("addCartItem", () => {
    it("sorts modifierIds before calling the RPC", async () => {
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.addCartItem("qr-token-1", {
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
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.addCartItem("qr-token-1", { menuItemId: "mi-1", modifierIds: [] })
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

  describe("updateCartItemQuantity", () => {
    it("calls the delta RPC with qrToken, cartItemId, delta, and expectedVersion", async () => {
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.updateCartItemQuantity("qr-token-1", "ci-1", 3, 5)
      expect(rpc).toHaveBeenCalledWith("update_cart_item_quantity_delta", {
        p_qr_token: "qr-token-1",
        p_cart_item_id: "ci-1",
        p_delta: 3,
        p_expected_version: 5,
      })
    })

    it("defaults expectedVersion to null when omitted", async () => {
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.updateCartItemQuantity("qr-token-1", "ci-1", -1)
      expect(rpc).toHaveBeenCalledWith("update_cart_item_quantity_delta", {
        p_qr_token: "qr-token-1",
        p_cart_item_id: "ci-1",
        p_delta: -1,
        p_expected_version: null,
      })
    })
  })

  describe("removeCartItem", () => {
    it("calls the RPC with qrToken and cartItemId", async () => {
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.removeCartItem("qr-token-1", "ci-1")
      expect(rpc).toHaveBeenCalledWith("remove_cart_item", {
        p_qr_token: "qr-token-1",
        p_cart_item_id: "ci-1",
      })
    })
  })

  describe("placeRound", () => {
    it("returns the RPC's orderId/total", async () => {
      const { adapter } = mockRpc({ data: { orderId: "order-1", total: 90000 }, error: null })
      const result = await adapter.placeRound("qr-token-1")
      expect(result).toEqual({ orderId: "order-1", total: 90000 })
    })

    it("calls the RPC with p_qr_token and p_submission_id", async () => {
      const { rpc, adapter } = mockRpc({ data: { orderId: "order-1", total: 90000 }, error: null })
      await adapter.placeRound("qr-token-1", "submission-1")
      expect(rpc).toHaveBeenCalledWith("place_table_round", {
        p_qr_token: "qr-token-1",
        p_submission_id: "submission-1",
      })
    })

    it("retries only a missing two-argument RPC signature with the legacy overload", async () => {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "function not found" } })
        .mockResolvedValueOnce({ data: { orderId: "legacy-order", total: 40000 }, error: null })
      const adapter = createSupabaseTableSessionAdapter({ rpc } as unknown as SupabaseClient)
      await expect(adapter.placeRound("qr-token-1", "submission-1")).resolves.toEqual({
        orderId: "legacy-order",
        total: 40000,
      })
      expect(rpc).toHaveBeenNthCalledWith(2, "place_table_round", { p_qr_token: "qr-token-1" })
    })

    it("does not retry real RPC failures", async () => {
      const rpc = vi.fn(() => Promise.resolve({ data: null, error: { code: "42501", message: "not authorized" } }))
      const adapter = createSupabaseTableSessionAdapter({ rpc } as unknown as SupabaseClient)
      await expect(adapter.placeRound("qr-token-1")).rejects.toEqual(
        expect.objectContaining({ code: "42501" })
      )
      expect(rpc).toHaveBeenCalledTimes(1)
    })
  })

  describe("abandonSession", () => {
    it("returns the RPC's boolean", async () => {
      const { adapter } = mockRpc({ data: true, error: null })
      const result = await adapter.abandonSession("qr-token-1")
      expect(result).toBe(true)
    })

    it("calls the RPC with p_qr_token", async () => {
      const { rpc, adapter } = mockRpc({ data: true, error: null })
      await adapter.abandonSession("qr-token-1")
      expect(rpc).toHaveBeenCalledWith("abandon_table_session", { p_qr_token: "qr-token-1" })
    })
  })

  describe("requestBill", () => {
    it("calls the RPC with cash method and no promo code", async () => {
      const { rpc, adapter } = mockRpc({ data: null, error: null })
      await adapter.requestBill("qr-token-1")
      expect(rpc).toHaveBeenCalledWith("checkout_table_session", {
        p_qr_token: "qr-token-1",
        p_method: "cash",
        p_promo_code: null,
      })
    })

    it("throws on error", async () => {
      const { adapter } = mockRpc({ data: null, error: new Error("no_active_session") })
      await expect(adapter.requestBill("qr-token-1")).rejects.toThrow("no_active_session")
    })
  })
})

describe("isStaleCartItemError", () => {
  it("detects both Error instances and PostgREST error objects", () => {
    expect(isStaleCartItemError(new Error("stale_cart_item"))).toBe(true)
    expect(isStaleCartItemError({ code: "P0001", message: "stale_cart_item" })).toBe(true)
    expect(isStaleCartItemError(new Error("cart_item_not_found"))).toBe(false)
    expect(isStaleCartItemError(null)).toBe(false)
  })
})
