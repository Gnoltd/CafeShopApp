// pay-order: lets a customer choose (and pay, for Stripe/VNPay) the
// payment method for an already-placed, already-served Pay Later order
// — the method itself, not just the timing, is deferred to this point
// (revised same-day; see the "Revision" section of
// docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md).
// Always records payment_method on the order first. For "cash" that's
// the whole job — staff confirm receipt later via the existing flow.
// For "stripe"/"vnpay" it then reuses the same Stripe Checkout Session /
// VNPay redirect construction as place-order, just invoked later
// against an existing order instead of at placement time. verify_jwt is
// disabled — a guest's own deferred order must be payable without a
// session, same reasoning as place-order.

import { createClient } from "jsr:@supabase/supabase-js@2"
import { createStripeCheckoutSession } from "../_shared/stripe.ts"
import { buildVnpayCheckoutUrl, buildVnpayReturnUrl, extractClientIp } from "../_shared/vnpay.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_LOCALES = ["vi", "en"]

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const orderId = payload.orderId as string | undefined
    const paymentMethod = payload.paymentMethod as string | undefined
    const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), { status: 400, headers: corsHeaders })
    }
    if (paymentMethod !== "cash" && paymentMethod !== "stripe" && paymentMethod !== "vnpay") {
      return new Response(JSON.stringify({ error: "paymentMethod must be cash, stripe, or vnpay" }), { status: 400, headers: corsHeaders })
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: order, error: fetchError } = await serviceClient
      .from("orders")
      .select("id, total, payment_status, status")
      .eq("id", orderId)
      .maybeSingle()

    if (fetchError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders })
    }
    if (order.payment_status !== "pending") {
      return new Response(JSON.stringify({ error: "This order is already paid" }), { status: 400, headers: corsHeaders })
    }
    if (order.status !== "served") {
      return new Response(JSON.stringify({ error: "This order isn't ready for payment yet" }), { status: 400, headers: corsHeaders })
    }

    const { error: updateError } = await serviceClient.from("orders").update({ payment_method: paymentMethod }).eq("id", orderId)
    if (updateError) {
      return new Response(JSON.stringify({ error: "Failed to record payment method" }), { status: 500, headers: corsHeaders })
    }

    if (paymentMethod === "cash") {
      // Nothing more to do here -- staff collect it in person and confirm
      // receipt via the existing "Confirm Cash Received" flow (KDS Tables
      // column / pending-cash banner), which now picks this order up since
      // payment_method is set.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const siteUrl = Deno.env.get("SITE_URL")!

    if (paymentMethod === "stripe") {
      const session = await createStripeCheckoutSession({
        orderId: order.id,
        total: order.total,
        successUrl: `${siteUrl}/${locale}/orders/${order.id}`,
        cancelUrl: `${siteUrl}/${locale}/orders/${order.id}?stripeCanceled=1`,
      })
      if ("error" in session) {
        return new Response(JSON.stringify({ error: session.error }), { status: 400, headers: corsHeaders })
      }
      return new Response(JSON.stringify({ checkoutUrl: session.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const checkoutUrl = await buildVnpayCheckoutUrl({
      orderId: order.id,
      total: order.total,
      ipAddr: extractClientIp(req),
      locale,
      returnUrl: buildVnpayReturnUrl(order.id, locale),
    })
    return new Response(JSON.stringify({ checkoutUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Unexpected error creating payment" }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
