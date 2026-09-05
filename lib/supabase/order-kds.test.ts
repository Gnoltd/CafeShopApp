import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  confirmTableCashPayment,
  markTableCashPayment,
  advanceOrderItemStatus,
  markOrderItemsServed,
  recallLastCompletedOrder,
} from "./order-kds"

describe("confirmTableCashPayment", () => {
  it("calls confirm_table_cash_payment with the table id and returns the row count", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: 3, error: null }))
    const supabase = { rpc } as unknown as SupabaseClient

    const result = await confirmTableCashPayment(supabase, "table-1")

    expect(rpc).toHaveBeenCalledWith("confirm_table_cash_payment", { p_table_id: "table-1" })
    expect(result).toBe(3)
  })

  it("throws on error", async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: null, error: new Error("not_authorized") })) } as unknown as SupabaseClient
    await expect(confirmTableCashPayment(supabase, "table-1")).rejects.toThrow("not_authorized")
  })
})

describe("markTableCashPayment", () => {
  it("updates every unset-method pending order on the table to cash", async () => {
    const is = vi.fn(() => Promise.resolve({ error: null }))
    const eq2 = vi.fn(() => ({ is }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const update = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await markTableCashPayment(supabase, "table-1")

    expect(from).toHaveBeenCalledWith("orders")
    expect(update).toHaveBeenCalledWith({ payment_method: "cash" })
    expect(eq1).toHaveBeenCalledWith("table_id", "table-1")
    expect(eq2).toHaveBeenCalledWith("payment_status", "pending")
    expect(is).toHaveBeenCalledWith("payment_method", null)
  })

  it("throws on error", async () => {
    const is = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const eq2 = vi.fn(() => ({ is }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const update = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(markTableCashPayment(supabase, "table-1")).rejects.toThrow("not_authorized")
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
