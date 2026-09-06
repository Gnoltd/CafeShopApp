import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  confirmTablePayment,
  confirmServedPayment,
  advanceOrderItemStatus,
  markOrderItemsServed,
  recallLastCompletedOrder,
} from "./order-kds"

describe("confirmTablePayment", () => {
  it("calls confirm_table_payment with the table id and method, returns the row count", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: 3, error: null }))
    const supabase = { rpc } as unknown as SupabaseClient

    const result = await confirmTablePayment(supabase, "table-1", "vnpay")

    expect(rpc).toHaveBeenCalledWith("confirm_table_payment", { p_table_id: "table-1", p_method: "vnpay" })
    expect(result).toBe(3)
  })

  it("throws on error", async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: null, error: new Error("not_authorized") })) } as unknown as SupabaseClient
    await expect(confirmTablePayment(supabase, "table-1", "cash")).rejects.toThrow("not_authorized")
  })
})

describe("confirmServedPayment", () => {
  it("sets the payment method and marks paid, scoped to a served-and-pending order", async () => {
    const eq2 = vi.fn(() => Promise.resolve({ error: null }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const eq0 = vi.fn(() => ({ eq: eq1 }))
    const update = vi.fn(() => ({ eq: eq0 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await confirmServedPayment(supabase, "order-1", "stripe")

    expect(from).toHaveBeenCalledWith("orders")
    expect(update).toHaveBeenCalledWith({ payment_method: "stripe", payment_status: "paid" })
    expect(eq0).toHaveBeenCalledWith("id", "order-1")
    expect(eq1).toHaveBeenCalledWith("status", "served")
    expect(eq2).toHaveBeenCalledWith("payment_status", "pending")
  })

  it("throws on error", async () => {
    const eq2 = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const eq0 = vi.fn(() => ({ eq: eq1 }))
    const update = vi.fn(() => ({ eq: eq0 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(confirmServedPayment(supabase, "order-1", "cash")).rejects.toThrow("not_authorized")
  })
})

describe("advanceOrderItemStatus", () => {
  it("updates the item's status by id", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await advanceOrderItemStatus(supabase, "item-1", "ready")

    expect(from).toHaveBeenCalledWith("order_items")
    expect(update).toHaveBeenCalledWith({ status: "ready" })
    expect(eq).toHaveBeenCalledWith("id", "item-1")
  })

  it("throws on error", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(advanceOrderItemStatus(supabase, "item-1", "ready")).rejects.toThrow("not_authorized")
  })
})

describe("markOrderItemsServed", () => {
  it("bulk-updates every non-served item across the given orders", async () => {
    const neq = vi.fn(() => Promise.resolve({ error: null }))
    const inFn = vi.fn(() => ({ neq }))
    const update = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await markOrderItemsServed(supabase, ["order-1", "order-2"])

    expect(from).toHaveBeenCalledWith("order_items")
    expect(update).toHaveBeenCalledWith({ status: "served" })
    expect(inFn).toHaveBeenCalledWith("order_id", ["order-1", "order-2"])
    expect(neq).toHaveBeenCalledWith("status", "served")
  })

  it("does nothing when given no order ids", async () => {
    const from = vi.fn()
    const supabase = { from } as unknown as SupabaseClient

    await markOrderItemsServed(supabase, [])

    expect(from).not.toHaveBeenCalled()
  })

  it("throws on error", async () => {
    const neq = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const inFn = vi.fn(() => ({ neq }))
    const update = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(markOrderItemsServed(supabase, ["order-1"])).rejects.toThrow("not_authorized")
  })
})

describe("recallLastCompletedOrder", () => {
  it("calls the RPC with no arguments", async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = { rpc } as unknown as SupabaseClient

    await recallLastCompletedOrder(supabase)

    expect(rpc).toHaveBeenCalledWith("recall_last_completed_order")
  })

  it("throws the RPC's error, including the nothing-to-recall case", async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: null, error: new Error("nothing_to_recall") })) } as unknown as SupabaseClient
    await expect(recallLastCompletedOrder(supabase)).rejects.toThrow("nothing_to_recall")
  })
})
