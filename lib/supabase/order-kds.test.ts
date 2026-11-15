import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  confirmTablePayment,
  confirmServedPayment,
  advanceOrderItemStatus,
  markOrderItemsServed,
  recallLastCompletedOrder,
  getKitchenOrders,
  getPendingPaymentOrders,
  confirmCashPayment,
  createSupabaseKdsPreparationAdapter,
  createSupabaseTableSettlementAdapter,
} from "./order-kds"

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

describe("confirmCashPayment", () => {
  it("updates both status and payment_status to paid", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await confirmCashPayment(supabase, "ord-1")
    expect(updateSpy).toHaveBeenCalledWith({ status: "paid", payment_status: "paid" })
  })
})

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

describe("getPendingPaymentOrders", () => {
  it("queries cash pending orders that are pending_payment or served pickup", async () => {
    const orderSpy = vi.fn(() => Promise.resolve({ data: [], error: null }))
    const orSpy = vi.fn(() => ({ order: orderSpy }))
    const eqStatusSpy = vi.fn(() => ({ or: orSpy }))
    const eqMethodSpy = vi.fn(() => ({ eq: eqStatusSpy }))
    const supabase = {
      from: () => ({ select: () => ({ eq: eqMethodSpy }) }),
    } as unknown as SupabaseClient

    await getPendingPaymentOrders(supabase)

    expect(eqMethodSpy).toHaveBeenCalledWith("payment_method", "cash")
    expect(eqStatusSpy).toHaveBeenCalledWith("payment_status", "pending")
    expect(orSpy).toHaveBeenCalledWith("status.eq.pending_payment,and(status.eq.served,order_type.eq.pickup)")
  })
})

describe("createSupabaseKdsPreparationAdapter", () => {
  it("delegates KDS ticket reads, item transitions, hand-over, and recall", async () => {
    const orderSpy = vi.fn(() => Promise.resolve({ data: [], error: null }))
    const inSpy = vi.fn(() => ({ order: orderSpy }))
    const orSpy = vi.fn(() => ({ order: orderSpy }))
    const eqPendingStatus = vi.fn(() => ({ or: orSpy }))
    const eqPendingMethod = vi.fn(() => ({ eq: eqPendingStatus }))

    const itemUpdateEq = vi.fn(() => Promise.resolve({ error: null }))
    const itemsNeq = vi.fn(() => Promise.resolve({ error: null }))
    const itemsIn = vi.fn(() => ({ neq: itemsNeq }))
    const orderItemsUpdate = vi.fn((payload: { status: string }) =>
      payload.status === "served" ? { in: itemsIn } : { eq: itemUpdateEq }
    )

    const rpc = vi.fn(() => Promise.resolve({ error: null }))
    const from = vi.fn((table: string) => {
      if (table === "orders") {
        return {
          select: () => ({ in: inSpy, eq: eqPendingMethod }),
        }
      }
      return { update: orderItemsUpdate }
    })

    const adapter = createSupabaseKdsPreparationAdapter({ from, rpc } as unknown as SupabaseClient)

    await adapter.getKitchenOrders()
    expect(inSpy).toHaveBeenCalledWith("status", ["paid", "preparing", "ready", "served"])

    await adapter.getPendingPaymentOrders()
    expect(eqPendingMethod).toHaveBeenCalledWith("payment_method", "cash")

    await adapter.updateItemStatus("item-9", "ready")
    expect(itemUpdateEq).toHaveBeenCalledWith("id", "item-9")

    await adapter.markOrdersServed(["ord-9"])
    expect(itemsIn).toHaveBeenCalledWith("order_id", ["ord-9"])

    await adapter.recallLastCompletedOrder()
    expect(rpc).toHaveBeenCalledWith("recall_last_completed_order")
  })
})

describe("createSupabaseTableSettlementAdapter", () => {
  it("serves order ids via markOrderItemsServed and settles a table with cash default", async () => {
    const neq = vi.fn(() => Promise.resolve({ error: null }))
    const inFn = vi.fn(() => ({ neq }))
    const update = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ update }))
    const rpc = vi.fn(() => Promise.resolve({ data: 2, error: null }))
    const adapter = createSupabaseTableSettlementAdapter({ from, rpc } as unknown as SupabaseClient)

    await adapter.serveOrders(["ord-1", "ord-2"])
    expect(from).toHaveBeenCalledWith("order_items")
    expect(inFn).toHaveBeenCalledWith("order_id", ["ord-1", "ord-2"])

    const count = await adapter.settleTable("table-7")
    expect(rpc).toHaveBeenCalledWith("confirm_table_payment", { p_table_id: "table-7", p_method: "cash" })
    expect(count).toBe(2)
  })

  it("settleOrder routes served dine-in orders with tableId through confirm_table_payment", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: 1, error: null }))
    const from = vi.fn()
    const adapter = createSupabaseTableSettlementAdapter({ from, rpc } as unknown as SupabaseClient)

    await adapter.settleOrder({ id: "ord-1", orderType: "dine-in", status: "served", tableId: "table-1" })

    expect(rpc).toHaveBeenCalledWith("confirm_table_payment", { p_table_id: "table-1", p_method: "cash" })
    expect(from).not.toHaveBeenCalled()
  })

  it("settleOrder routes legacy served pickup orders through confirmServedPayment", async () => {
    const eq2 = vi.fn(() => Promise.resolve({ error: null }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const eq0 = vi.fn(() => ({ eq: eq1 }))
    const update = vi.fn(() => ({ eq: eq0 }))
    const from = vi.fn(() => ({ update }))
    const rpc = vi.fn()
    const adapter = createSupabaseTableSettlementAdapter({ from, rpc } as unknown as SupabaseClient)

    await adapter.settleOrder({ id: "ord-pickup", orderType: "pickup", status: "served" }, "vnpay")

    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ payment_method: "vnpay", payment_status: "paid" })
    expect(eq0).toHaveBeenCalledWith("id", "ord-pickup")
    expect(eq1).toHaveBeenCalledWith("status", "served")
    expect(eq2).toHaveBeenCalledWith("payment_status", "pending")
  })

  it("settleOrder routes legacy pending_payment orders through confirmCashPayment", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const rpc = vi.fn()
    const adapter = createSupabaseTableSettlementAdapter({ from, rpc } as unknown as SupabaseClient)

    await adapter.settleOrder({ id: "ord-pending", orderType: "pickup", status: "pending_payment" })

    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ status: "paid", payment_status: "paid" })
    expect(eq).toHaveBeenCalledWith("id", "ord-pending")
  })
})
