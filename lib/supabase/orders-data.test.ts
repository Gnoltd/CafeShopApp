import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getOrderForTracking,
  placeOrder,
  getMyOrders,
  getKitchenOrders,
  advanceOrderStatus,
  confirmOrderPayment,
  payExistingOrder,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  cancelPendingOrder,
  getOrderHistory,
  getOrderHistoryDetail,
} from "./orders-data"

describe("getOrderForTracking", () => {
  it("calls the RPC and returns its jsonb result directly", async () => {
    const result = {
      id: "ord-1",
      createdAt: 1751800000000,
      orderType: "dine_in",
      table: "3",
      status: "preparing",
      paymentStatus: "paid",
      paymentMethod: "cash",
      subtotal: 50000,
      discount: 0,
      taxAmount: 4000,
      total: 54000,
      items: [{ menuItemId: "item-9", nameVi: "Phin Sữa Đá", nameEn: "Iced Milk Coffee", quantity: 1, unitPrice: 50000, note: null }],
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: result, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const order = await getOrderForTracking(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("get_order_for_tracking", { p_order_id: "ord-1" })
    expect(order?.orderType).toBe("dine-in")
    expect(order?.table).toBe("3")
    expect(order?.status).toBe("preparing")
    expect(order?.items[0].menuItemId).toBe("item-9")
    expect(order?.taxAmount).toBe(4000)
  })

  it("returns null when the RPC returns null (not found or not permitted)", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const order = await getOrderForTracking(supabase, "nonexistent")
    expect(order).toBeNull()
  })
})

describe("placeOrder", () => {
  it("maps camelCase input to the RPC's payload shape, translating order type", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { orderId: "ord-new", total: 29000 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await placeOrder(supabase, {
      orderType: "dine-in",
      tableId: "tbl-1",
      pickupTime: null,
      paymentMethod: "cash",
      promoCode: "WELCOME10",
      redeemLoyaltyPoints: 0,
      paymentCollected: false,
      items: [{ menuItemId: "item-1", sizeId: null, modifierIds: [], quantity: 2, note: "less sugar" }],
    })

    expect(rpcSpy).toHaveBeenCalledWith("place_order", {
      p_payload: {
        orderType: "dine_in",
        tableId: "tbl-1",
        pickupTime: null,
        paymentMethod: "cash",
        promoCode: "WELCOME10",
        redeemLoyaltyPoints: 0,
        paymentCollected: false,
        items: [{ menuItemId: "item-1", sizeId: null, modifierIds: [], quantity: 2, note: "less sugar" }],
      },
    })
    expect(result).toEqual({ orderId: "ord-new", total: 29000 })
  })
})

describe("getMyOrders", () => {
  it("maps nested rows, translating order_type back to hyphenated form", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "dine_in",
      status: "completed",
      subtotal: 29000,
      discount_amount: 0,
      total: 29000,
      table_id: "tbl-2",
      payment_status: "paid",
      payment_method: "cash",
      tables: { table_number: "2" },
      order_items: [{ menu_item_id: "item-a", quantity: 1, unit_price: 29000, note: null, menu_items: { name_vi: "a", name_en: "b" } }],
    }
    const supabase = {
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }) }),
    } as unknown as SupabaseClient

    const result = await getMyOrders(supabase)
    expect(result[0].orderType).toBe("dine-in")
    expect(result[0].table).toBe("2")
  })

  it("includes menuItemId on each mapped item", async () => {
    const row = {
      id: "order-1",
      created_at: "2026-07-10T10:00:00Z",
      order_type: "dine_in",
      status: "completed",
      subtotal: 50000,
      discount_amount: 0,
      total: 50000,
      table_id: "table-1",
      payment_status: "paid",
      payment_method: "cash",
      tables: { table_number: "5" },
      order_items: [
        {
          menu_item_id: "item-1",
          quantity: 2,
          unit_price: 25000,
          note: null,
          menu_items: { name_vi: "Cà Phê Đen", name_en: "Black Coffee" },
        },
      ],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getMyOrders(supabase)

    expect(result[0].items[0]).toEqual({
      menuItemId: "item-1",
      nameVi: "Cà Phê Đen",
      nameEn: "Black Coffee",
      quantity: 2,
      unitPrice: 25000,
      note: undefined,
    })
  })
})

describe("getKitchenOrders", () => {
  it("filters to paid/preparing/ready/served statuses", async () => {
    const inSpy = vi.fn(() => ({ order: () => Promise.resolve({ data: [], error: null }) }))
    const supabase = {
      from: () => ({ select: () => ({ in: inSpy }) }),
    } as unknown as SupabaseClient

    await getKitchenOrders(supabase)
    expect(inSpy).toHaveBeenCalledWith("status", ["paid", "preparing", "ready", "served"])
  })
})

describe("advanceOrderStatus", () => {
  it("updates only the status column", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await advanceOrderStatus(supabase, "ord-1", "ready")
    expect(updateSpy).toHaveBeenCalledWith({ status: "ready" })
    expect(eqSpy).toHaveBeenCalledWith("id", "ord-1")
  })
})

describe("confirmOrderPayment", () => {
  it("calls the RPC and returns its boolean result", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await confirmOrderPayment(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("confirm_order_payment", { p_order_id: "ord-1" })
    expect(result).toBe(true)
  })

  it("returns false when the RPC reports the order wasn't pending", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    expect(await confirmOrderPayment(supabase, "ord-2")).toBe(false)
  })

  it("throws on RPC error", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(confirmOrderPayment(supabase, "ord-1")).rejects.toThrow("boom")
  })
})

describe("changeOrderPaymentMethod", () => {
  it("calls the RPC with the order id and method", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await changeOrderPaymentMethod(supabase, "ord-1", null)

    expect(rpcSpy).toHaveBeenCalledWith("change_order_payment_method", { p_order_id: "ord-1", p_method: null })
    expect(result).toBe(true)
  })

  it("returns false when the guard rejects the order", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    expect(await changeOrderPaymentMethod(supabase, "ord-paid", "vnpay")).toBe(false)
  })

  it("throws on RPC error", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(changeOrderPaymentMethod(supabase, "ord-1", "cash")).rejects.toThrow("boom")
  })
})

describe("cancelPendingOrder", () => {
  it("calls the RPC with the order id and returns its boolean result", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await cancelPendingOrder(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("cancel_pending_order", { p_order_id: "ord-1" })
    expect(result).toBe(true)
  })

  it("returns false when the RPC reports the order wasn't cancellable", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await cancelPendingOrder(supabase, "ord-2")
    expect(result).toBe(false)
  })
})

describe("getOrderHistory", () => {
  it("calls the RPC with snake_case params built from camelCase filters", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(
      supabase,
      { dateFrom: "2026-07-01", dateTo: "2026-07-07", statuses: ["completed"], orderType: "dine-in", search: "A1B2" },
      { limit: 20, offset: 0 }
    )

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: "2026-07-01",
      p_date_to: "2026-07-07",
      p_statuses: ["completed"],
      p_order_type: "dine_in",
      p_search: "A1B2",
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("omits order type and passes null search when not provided", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: null,
      p_date_to: null,
      p_statuses: null,
      p_order_type: null,
      p_search: null,
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("maps snake_case rows to camelCase, translating order_type and defaulting a null customer name to undefined", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "dine_in",
      table_number: "5",
      customer_name: null,
      payment_method: "cash",
      status: "completed",
      total: 60000,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [row], totalCount: 1 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(result.totalCount).toBe(1)
    expect(result.rows[0]).toEqual({
      id: "ord-1",
      createdAt: new Date("2026-07-06T10:00:00.000Z").getTime(),
      orderType: "dine-in",
      table: "5",
      customerName: undefined,
      paymentMethod: "cash",
      status: "completed",
      total: 60000,
    })
  })
})

describe("getOrderHistoryDetail", () => {
  it("selects a single order by id with the staff detail shape and maps a guest's null profile to an undefined customerName", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "pickup",
      status: "completed",
      subtotal: 60000,
      discount_amount: 0,
      total: 60000,
      table_id: null,
      payment_method: "cash",
      payment_status: "paid",
      tables: null,
      profiles: null,
      order_items: [{ quantity: 1, unit_price: 60000, note: null, menu_items: { name_vi: "a", name_en: "b" } }],
    }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "ord-1")

    expect(eqSpy).toHaveBeenCalledWith("id", "ord-1")
    expect(result?.customerName).toBeUndefined()
    expect(result?.paymentMethod).toBe("cash")
    expect(result?.paymentStatus).toBe("paid")
  })

  it("returns null when no matching row is found", async () => {
    const singleSpy = vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } }))
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: singleSpy }) }) }),
    } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "unknown-id")
    expect(result).toBeNull()
  })
})

describe("payExistingOrder", () => {
  it("invokes the pay-order function with orderId, locale, and paymentMethod", async () => {
    const invokeSpy = vi.fn(() => Promise.resolve({ data: { checkoutUrl: "https://example.com/pay" }, error: null }))
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    const result = await payExistingOrder(supabase, "order-1", "vi", "stripe")

    expect(invokeSpy).toHaveBeenCalledWith("pay-order", {
      body: { orderId: "order-1", locale: "vi", paymentMethod: "stripe" },
    })
    expect(result.checkoutUrl).toBe("https://example.com/pay")
  })

  it("returns no checkoutUrl for a cash choice", async () => {
    const invokeSpy = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    const result = await payExistingOrder(supabase, "order-1", "vi", "cash")

    expect(result.checkoutUrl).toBeUndefined()
  })
})

describe("setOrderPaymentMethodCash", () => {
  it("updates only payment_method to cash", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await setOrderPaymentMethodCash(supabase, "order-1")

    expect(updateSpy).toHaveBeenCalledWith({ payment_method: "cash" })
    expect(eqSpy).toHaveBeenCalledWith("id", "order-1")
  })
})
