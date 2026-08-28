// vnpay-ipn: VNPay's server-to-server confirmation call — the sole
// source of truth for "paid," mirroring stripe-webhook's role. See
// docs/superpowers/specs/2026-07-07-vnpay-payment-integration-design.md.
//
// Unlike vnpay-return (a browser redirect that isn't guaranteed to
// fire — the customer can close the tab first), VNPay always calls
// this from its own servers regardless of what the customer's browser
// does. verify_jwt is disabled — VNPay's own signature is the real
// trust boundary; there is no Supabase session on this request at all.
//
// Every guarded UPDATE below uses payment_status = 'pending', and
// handle_order_paid (migration 0007) has its own `old is distinct from
// 'paid'` check — together these make VNPay's IPN retries a safe no-op
// (returning RspCode "02") rather than a double inventory deduction or
// double loyalty award.

import { createClient } from "jsr:@supabase/supabase-js@2"
import { verifyVnpaySignature } from "../_shared/vnpay.ts"
import { buildPaidUpdate } from "../_shared/order-status.ts"

function ipnResponse(rspCode: string, message: string): Response {
  return new Response(JSON.stringify({ RspCode: rspCode, Message: message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams

  const hashSecret = Deno.env.get("VNPAY_HASH_SECRET")
  if (!hashSecret || !(await verifyVnpaySignature(params, hashSecret))) {
    return ipnResponse("97", "Invalid signature")
  }

  const txnRef = params.get("vnp_TxnRef")
  const vnpAmount = Number(params.get("vnp_Amount") ?? "0")
  const responseCode = params.get("vnp_ResponseCode")

  if (!txnRef) {
    return ipnResponse("01", "Order not found")
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  // Aggregate Check Bill charge (docs/superpowers/specs/
  // 2026-08-28-shared-table-ordering-session-design.md, Section 6) --
  // vnp_TxnRef carries a "session:" prefix instead of a raw order id.
  if (txnRef.startsWith("session:")) {
    const tableSessionId = txnRef.slice("session:".length)
    const { data: session } = await serviceClient
      .from("table_sessions")
      .select("id, checkout_discount_amount")
      .eq("id", tableSessionId)
      .maybeSingle()
    if (!session) {
      return ipnResponse("01", "Order not found")
    }

    const { data: pendingOrders } = await serviceClient
      .from("orders")
      .select("id, total")
      .eq("table_session_id", tableSessionId)
      .eq("payment_status", "pending")

    const aggregateTotal = (pendingOrders ?? []).reduce((sum, o) => sum + o.total, 0)
    const expectedCharge = aggregateTotal - session.checkout_discount_amount

    if (!pendingOrders || pendingOrders.length === 0) {
      return ipnResponse("02", "Order already confirmed")
    }
    if (vnpAmount / 100 !== expectedCharge) {
      return ipnResponse("04", "Invalid amount")
    }

    if (responseCode === "00") {
      await serviceClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("table_session_id", tableSessionId)
        .eq("payment_status", "pending")
    }
    await serviceClient.from("table_sessions").update({ payment_pending: false }).eq("id", tableSessionId)

    return ipnResponse("00", "Confirm Success")
  }

  const orderId = txnRef
  const { data: order } = await serviceClient
    .from("orders")
    .select("id, total, status, payment_status")
    .eq("id", orderId)
    .maybeSingle()

  if (!order) {
    return ipnResponse("01", "Order not found")
  }

  if (vnpAmount / 100 !== order.total) {
    return ipnResponse("04", "Invalid amount")
  }

  if (order.payment_status === "paid") {
    return ipnResponse("02", "Order already confirmed")
  }

  if (responseCode === "00") {
    await serviceClient
      .from("orders")
      .update(buildPaidUpdate(order.status))
      .eq("id", orderId)
      .eq("payment_status", "pending")
  } else if (order.status === "pending_payment") {
    // Only cancel a still-pre-kitchen order -- a served order whose
    // deferred payment failed just stays served/unpaid for a retry.
    await serviceClient
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  }

  return ipnResponse("00", "Confirm Success")
})
