// checkout-table-session: aggregate "Check Bill" payment for a table's
// running tab -- settles every currently-unpaid round at once, across
// all three payment methods. See
// docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md,
// Section 6. Always records payment_method on every covered order via
// checkout_table_session first. Cash: that's the whole job -- staff
// confirm the aggregate receipt later via confirm_table_cash_payment
// (KDS table card). Stripe/VNPay: creates ONE gateway session for the
// summed (post-discount) total, carrying the table_session_id so
// stripe-webhook/vnpay-ipn can mark every covered order paid in one
// event. verify_jwt is disabled -- any guest at the table must be able
// to check the bill without a session, same reasoning as
// place-order/pay-order.
//
// Takes qrToken (not a raw table id) -- checkout_table_session's RPC
// signature requires the table's QR token so a guest-callable function
// can't be driven against a table the caller never scanned (tables.id
// is enumerable via the public tables_select_all policy; qr_code_token
// is not, see migration 0077).

import { createClient } from "jsr:@supabase/supabase-js@2"
import { createStripeCheckoutSessionForTableSession } from "../_shared/stripe.ts"
import { buildVnpayCheckoutUrlForTableSession, buildVnpayReturnUrlForTableSession, extractClientIp } from "../_shared/vnpay.ts"
import { rateLimitOrNull } from "../_shared/rate-limit.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_LOCALES = ["vi", "en"]
const RATE_LIMIT_MAX_REQUESTS = 10
const RATE_LIMIT_WINDOW_SECONDS = 60

const KNOWN_ERROR_CODES = new Set([
  "table_not_found",
  "no_active_session",
  "payment_in_progress",
  "nothing_to_pay",
  "invalid_promo_code",
  "promo_code_inactive",
  "promo_code_not_started",
  "promo_code_expired",
  "promo_code_limit_reached",
  "promo_code_below_minimum",
])

function mapError(message: string): string {
  return KNOWN_ERROR_CODES.has(message) ? message : "Unable to check the bill"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const qrToken = payload.qrToken as string | undefined
    const method = payload.method as string | undefined
    const promoCode = (payload.promoCode as string | null | undefined) ?? null
    const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
    if (!qrToken) {
      return new Response(JSON.stringify({ error: "qrToken is required" }), { status: 400, headers: corsHeaders })
    }
    if (method !== "cash" && method !== "stripe" && method !== "vnpay") {
      return new Response(JSON.stringify({ error: "method must be cash, stripe, or vnpay" }), { status: 400, headers: corsHeaders })
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const clientIp = extractClientIp(req)
    const rateLimitResponse = await rateLimitOrNull(
      serviceClient,
      `checkout-table-session:${clientIp}`,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_SECONDS,
      corsHeaders
    )
    if (rateLimitResponse) return rateLimitResponse

    const { data, error } = await serviceClient.rpc("checkout_table_session", {
      p_qr_token: qrToken,
      p_method: method,
      p_promo_code: promoCode,
    })

    if (error) {
      return new Response(JSON.stringify({ error: mapError(error.message) }), { status: 400, headers: corsHeaders })
    }

    const result = data as { tableSessionId: string; orderIds: string[]; chargeTotal: number }

    if (method === "cash") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const siteUrl = Deno.env.get("SITE_URL")!
    const tableUrl = `${siteUrl}/${locale}/table/${qrToken}`

    if (method === "stripe") {
      const session = await createStripeCheckoutSessionForTableSession({
        tableSessionId: result.tableSessionId,
        total: result.chargeTotal,
        successUrl: tableUrl,
        cancelUrl: `${tableUrl}?stripeCanceled=1`,
      })
      if ("error" in session) {
        return new Response(JSON.stringify({ error: session.error }), { status: 400, headers: corsHeaders })
      }
      return new Response(JSON.stringify({ checkoutUrl: session.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const checkoutUrl = await buildVnpayCheckoutUrlForTableSession({
      tableSessionId: result.tableSessionId,
      total: result.chargeTotal,
      ipAddr: clientIp,
      locale,
      returnUrl: buildVnpayReturnUrlForTableSession(locale),
    })
    return new Response(JSON.stringify({ checkoutUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Unexpected error checking the bill" }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
