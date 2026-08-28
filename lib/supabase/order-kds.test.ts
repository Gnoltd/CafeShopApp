import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmTableCashPayment, markTableCashPayment } from "./order-kds"

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
