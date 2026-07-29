// stripe-webhook: verifies Stripe's signature and marks the matching
// order paid/cancelled — see
// docs/superpowers/specs/2026-07-07-stripe-payment-integration-design.md.
//
// Verifies manually via Web Crypto (HMAC-SHA256) rather than pulling in
// the Stripe SDK, matching this project's existing dependency-free edge
// functions. verify_jwt is disabled — Stripe's own signature is the
// real trust boundary here; there is no Supabase session on this
// request at all.
//
// Both handled event types guard their UPDATE with
// `payment_status = 'pending'`, and handle_order_paid (migration 0007)
// has its own `old is distinct from 'paid'` check — together these make
// Stripe's automatic webhook retries a safe no-op rather than a double
// inventory deduction or double loyalty award.

import { createClient } from "jsr:@supabase/supabase-js@2"
import { buildPaidUpdate } from "../_shared/order-status.ts"

// Matches Stripe's own SDK default (DEFAULT_TOLERANCE, 300s) -- generous
// enough to absorb normal delivery/retry latency, tight enough that a
// captured signature+payload pair can't be replayed indefinitely.
const WEBHOOK_TOLERANCE_SECONDS = 300

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=")
      return [key, value]
    })
  )
  const timestamp = parts["t"]
  const expectedSig = parts["v1"]
  if (!timestamp || !expectedSig) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds)
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) return false

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const computedSig = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  if (computedSig.length !== expectedSig.length) return false
  let mismatch = 0
  for (let i = 0; i < computedSig.length; i++) {
    mismatch |= computedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i)
  }
  return mismatch === 0
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const signatureHeader = req.headers.get("Stripe-Signature")
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")
  const rawBody = await req.text()

  if (!signatureHeader || !webhookSecret) {
    return new Response("Missing signature", { status: 400 })
  }

  const isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret)
  if (!isValid) {
    return new Response("Invalid signature", { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const orderId = event.data?.object?.metadata?.order_id

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.expired") && orderId) {
    const { data: order } = await serviceClient.from("orders").select("status").eq("id", orderId).maybeSingle()

    if (event.type === "checkout.session.completed") {
      await serviceClient
        .from("orders")
        .update(buildPaidUpdate(order?.status))
        .eq("id", orderId)
        .eq("payment_status", "pending")
    } else if (order?.status === "pending_payment") {
      // Only a still-pre-kitchen order should be cancelled on expiry --
      // a served order whose deferred payment attempt expired just
      // stays served/unpaid, awaiting a retry.
      await serviceClient
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", orderId)
        .eq("payment_status", "pending")
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
