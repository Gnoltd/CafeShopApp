import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmTableCashPayment } from "./order-kds"

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
