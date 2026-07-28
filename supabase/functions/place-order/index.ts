// place-order: validates cart, computes price server-side, applies
// loyalty redemption, creates order (Stripe/VNPay/cash).
//
// Stripe follow-up (2026-07-07): when paymentMethod is "stripe" and the
// payment wasn't already collected in person (POS sends
// paymentCollected: true and skips this branch entirely — see
// docs/superpowers/specs/2026-07-07-stripe-payment-integration-design.md),
// this function also creates a real Stripe Checkout Session for the
// order's server-computed total and returns its hosted URL for the
// browser to redirect to. Uses raw fetch against Stripe's REST API
// (form-urlencoded, per Stripe's API convention) rather than an SDK, to
// match this project's existing no-extra-Deno-dependency edge functions.
// VND is a Stripe zero-decimal currency — the integer total is sent
// as-is, never multiplied by 100.
//
// VNPay follow-up (2026-07-07): same shape, different gateway — see
// docs/superpowers/specs/2026-07-07-vnpay-payment-integration-design.md.
// Unlike Stripe, no API call is needed to build the redirect URL — it's
// a locally-signed query string. VNPay's amount convention is the
// OPPOSITE of Stripe's: always total × 100, not a zero-decimal
// exception. vnp_ReturnUrl points at this project's own Supabase
// function URL (SUPABASE_URL), not SITE_URL (the Vercel app domain used
// for Stripe's success/cancel URLs) — vnpay-return does its own
// server-side redirect onward to the actual Next.js pages after
// verifying VNPay's hash.
//
// verify_jwt is disabled for this function: a guest (no session at
// all) must be able to place an order, and place_order itself already
// correctly derives a null customer_id for that case — Supabase's
// platform-level JWT verification would otherwise reject a guest's
// request before this code ever runs.

import { createClient } from "jsr:@supabase/supabase-js@2"
import { createStripeCheckoutSession } from "../_shared/stripe.ts"
import { buildVnpayCheckoutUrl, buildVnpayReturnUrl, extractClientIp } from "../_shared/vnpay.ts"

// The browser calls this cross-origin (app on vercel.app, function on
// supabase.co) via supabase.functions.invoke, which sends a CORS
// preflight OPTIONS request first — found live via Playwright when a
// real browser call failed with a CORS error despite curl working fine
// (curl never sends a preflight, so this was invisible to direct testing).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// supabase.functions.invoke() always attaches *some* Authorization
// header, even for a guest with no session — in that case it's the
// client's own publishable key (e.g. "sb_publishable_..."), not a JWT.
// Forwarding that opaque value on to a Postgres connection makes
// auth.uid() fail ("Expected 3 parts in JWT; got 1") instead of just
// resolving to null like a guest should — found live via Playwright.
// Only forward it when it's actually JWT-shaped (a real logged-in
// customer's access token); otherwise let the service-role client run
// with no forwarded identity, which is exactly what a guest needs.
function isJwtShaped(token: string): boolean {
  return token.split(".").length === 3
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
    const authHeader = req.headers.get("Authorization")
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
    const forwardedAuthHeader = bearerToken && isJwtShaped(bearerToken) ? authHeader : null

    // The service-role client's own calls bypass RLS — place_order itself
    // re-derives auth.uid() internally via the forwarded Authorization
    // header on this same request (when there is a real one), so a
    // guest's null identity is handled correctly by the RPC, not by any
    // check in this function.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: forwardedAuthHeader ? { Authorization: forwardedAuthHeader } : {} } }
    )

    const { data, error } = await serviceClient.rpc("place_order", { p_payload: payload })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
    }

    const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
    const needsStripeSession = payload.paymentMethod === "stripe" && payload.paymentCollected !== true && payload.payAt !== "later"
    const needsVnpayUrl = payload.paymentMethod === "vnpay" && payload.paymentCollected !== true && payload.payAt !== "later"

    if (needsStripeSession) {
      const siteUrl = Deno.env.get("SITE_URL")!
      const tableQuery =
        payload.orderType === "dine_in" && payload.tableNumber
          ? `?table=${encodeURIComponent(payload.tableNumber)}`
          : ""

      const session = await createStripeCheckoutSession({
        orderId: data.orderId,
        total: data.total,
        successUrl: `${siteUrl}/${locale}/orders/${data.orderId}${tableQuery}`,
        cancelUrl: `${siteUrl}/${locale}/checkout?stripeCanceled=${data.orderId}`,
      })

      if ("error" in session) {
        return new Response(JSON.stringify({ error: session.error }), { status: 400, headers: corsHeaders })
      }

      return new Response(JSON.stringify({ ...data, checkoutUrl: session.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (needsVnpayUrl) {
      const checkoutUrl = await buildVnpayCheckoutUrl({
        orderId: data.orderId,
        total: data.total,
        ipAddr: extractClientIp(req),
        locale,
        returnUrl: buildVnpayReturnUrl(data.orderId, locale),
      })

      return new Response(JSON.stringify({ ...data, checkoutUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Unexpected error placing order" }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
