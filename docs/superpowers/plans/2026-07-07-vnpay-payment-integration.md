# VNPay Payment Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Checkout's VNPay button and POS's VNPay button real — customer self-checkout gets a real VNPay sandbox redirect with IPN-confirmed payment; POS's VNPay option marks an order paid immediately (money already collected in person).

**Architecture:** Extend the already-payment-method-agnostic `place-order` Edge Function with a VNPay branch that builds and signs a VNPay payment URL locally (no API call needed, unlike Stripe). Two new Edge Functions: `vnpay-ipn` (server-to-server, the sole source of truth for "paid," mirrors `stripe-webhook`'s guarded-update pattern) and `vnpay-return` (browser redirect target, verifies the same hash, sends the customer to Order Tracking on success or self-cancels via the existing `cancel_pending_order` RPC on failure).

**Tech Stack:** Deno Edge Functions (raw Web Crypto HMAC-SHA512 — no VNPay SDK, matching this project's dependency-free functions), Next.js/React client components, next-intl.

**Reference spec:** `docs/superpowers/specs/2026-07-07-vnpay-payment-integration-design.md`

## Global Constraints

- **VNPay's amount convention is the opposite of Stripe's**: `vnp_Amount = total × 100` always, regardless of currency — not a zero-decimal exception. Do not copy the Stripe branch's "send as-is" VND handling here.
- **`vnp_ReturnUrl` must point at the Supabase Edge Function URL** (`${SUPABASE_URL}/functions/v1/vnpay-return`, using the auto-provided `SUPABASE_URL` secret), **not** `SITE_URL` (the Vercel domain used for Stripe's `success_url`/`cancel_url`, which point directly at Next.js pages) — these are two different base URLs serving two different roles.
- **`vnpay-ipn` is the only place an order gets marked `paid`.** `vnpay-return` never marks an order paid itself — only `pending_payment`/`cancelled` outcomes, via the existing `cancel_pending_order` RPC.
- Every guarded `UPDATE` to `orders` uses `.eq("payment_status", "pending")`, matching the Stripe webhook's idempotency pattern — required so `handle_order_paid` fires exactly once even if VNPay retries the IPN call.
- Supabase Edge Function secrets (`Deno.env`) are a separate store from Vercel's env vars/`.env.local` — `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` must be set directly as Supabase secrets (see Task 6), same gotcha hit twice during the Stripe work.
- Every new user-facing string is added to **both** `messages/vi.json` and `messages/en.json`.
- Verify against the deployed Vercel URL (`https://phadincafe.vercel.app`), not `npm run dev`/localhost, per this project's established convention.

---

### Task 1: Extend `place-order` Edge Function with a VNPay branch

**Files:**
- Modify: `supabase/functions/place-order/index.ts`

**Interfaces:**
- Consumes: `place_order` RPC (unchanged). Existing Stripe branch and payload fields (`locale`, `tableNumber`) are unchanged.
- Produces: when `paymentMethod === "vnpay"` and `paymentCollected` isn't `true`, the response gains `checkoutUrl` (a VNPay sandbox gateway URL) — same field name/shape the client already handles from the Stripe work.
- Reads new env vars: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (Supabase Edge Function secrets, set in Task 6). `SUPABASE_URL` is already auto-provided by Supabase to every Edge Function.

**No automated test** — same reasoning as the Stripe work: no Deno test harness in this project for Edge Functions. Verified manually (Step 3) and end-to-end (Task 7).

- [ ] **Step 1: Replace the full file content**

Replace all of `supabase/functions/place-order/index.ts` with:

```ts
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

// Flattens a nested object into Stripe's bracket-notation form fields,
// e.g. { line_items: [{ quantity: 1 }] } -> "line_items[0][quantity]=1".
// Stripe's REST API expects application/x-www-form-urlencoded bodies,
// not JSON.
function flattenForStripe(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenForStripe(item, `${prefix}[${i}]`, out))
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flattenForStripe(v, prefix ? `${prefix}[${key}]` : key, out)
    }
  } else if (value !== undefined && value !== null) {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
  }
}

async function createStripeCheckoutSession(params: {
  orderId: string
  total: number
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string } | { error: string }> {
  const body: string[] = []
  flattenForStripe(
    {
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Stripe's minimum allowed Checkout Session lifetime (30 minutes) —
      // chosen over the 24h default so an abandoned session doesn't leave
      // a pending_payment order sitting around for a full day.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { order_id: params.orderId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "vnd",
            // VND is zero-decimal in Stripe — pass the integer total as-is.
            unit_amount: params.total,
            product_data: { name: "PhaDinCafe Order" },
          },
        },
      ],
    },
    "",
    body
  )

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")!}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.join("&"),
  })

  const json = await response.json()
  if (!response.ok) {
    return { error: json?.error?.message ?? "Stripe rejected the checkout session" }
  }
  return { url: json.url as string }
}

const VNPAY_GATEWAY_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"

// yyyyMMddHHmmss in Asia/Ho_Chi_Minh time — VNPay requires this exact
// format and timezone regardless of where this function actually runs.
function toVnpayDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`
}

async function signVnpayParams(params: Record<string, string>, secret: string): Promise<string> {
  const sortedKeys = Object.keys(params).sort()
  const signString = sortedKeys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signString))
  return Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function buildVnpayCheckoutUrl(params: {
  orderId: string
  total: number
  ipAddr: string
  locale: string
  returnUrl: string
}): Promise<string> {
  const now = new Date()
  const expire = new Date(now.getTime() + 15 * 60 * 1000)
  const vnpParams: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: Deno.env.get("VNPAY_TMN_CODE")!,
    // VNPay's own convention: amount is always x100, regardless of
    // currency having no subdivision — the OPPOSITE of the zero-decimal
    // VND handling used for Stripe above. Do not "fix" this to match.
    vnp_Amount: String(params.total * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: params.orderId,
    vnp_OrderInfo: `Thanh toan don hang ${params.orderId}`,
    vnp_OrderType: "other",
    vnp_Locale: params.locale === "vi" ? "vn" : "en",
    vnp_ReturnUrl: params.returnUrl,
    vnp_IpAddr: params.ipAddr,
    vnp_CreateDate: toVnpayDateString(now),
    vnp_ExpireDate: toVnpayDateString(expire),
  }
  const secureHash = await signVnpayParams(vnpParams, Deno.env.get("VNPAY_HASH_SECRET")!)
  const query = Object.keys(vnpParams)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(vnpParams[k])}`)
    .join("&")
  return `${VNPAY_GATEWAY_URL}?${query}&vnp_SecureHash=${secureHash}`
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
    const needsStripeSession = payload.paymentMethod === "stripe" && payload.paymentCollected !== true
    const needsVnpayUrl = payload.paymentMethod === "vnpay" && payload.paymentCollected !== true

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
      const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
      const returnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?orderId=${data.orderId}&locale=${locale}`

      const checkoutUrl = await buildVnpayCheckoutUrl({
        orderId: data.orderId,
        total: data.total,
        ipAddr,
        locale,
        returnUrl,
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
```

- [ ] **Step 2: Deploy the updated function**

Use the `mcp__supabase__deploy_edge_function` tool:
- `name: "place-order"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false` (matches the function's existing, already-deployed setting)
- `files: [{ name: "index.ts", content: "<the full content from Step 1>" }]`

- [ ] **Step 3: Manual smoke test (VNPay secrets not yet configured — expect a specific failure)**

`VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` aren't set as Supabase secrets until Task 6, so `Deno.env.get("VNPAY_TMN_CODE")!` will be `undefined` and produce `"vnp_TmnCode=undefined"` in the built URL rather than crashing (the `!` only affects TypeScript, not runtime). Confirm the *cash* path still works (regression check):

```bash
curl -s -X POST "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/place-order" \
  -H "Content-Type: application/json" \
  -d '{"orderType":"pickup","tableId":null,"pickupTime":"asap","paymentMethod":"cash","promoCode":null,"redeemLoyaltyPoints":0,"paymentCollected":false,"items":[]}'
```

Expected: a 400 JSON error about no items (`place_order` validation) — proves the cash path still reaches `place_order` unchanged, same as the Stripe plan's equivalent smoke test.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/place-order/index.ts
git commit -m "feat: build a signed VNPay checkout URL from place-order"
```

---

### Task 2: `vnpay-ipn` Edge Function

**Files:**
- Modify: `supabase/functions/vnpay-ipn/index.ts` (currently a one-line stub)

**Interfaces:**
- Consumes: VNPay's IPN HTTP GET request (`vnp_*` query params, including `vnp_TxnRef` = order id, `vnp_Amount`, `vnp_ResponseCode`, `vnp_SecureHash`).
- Produces: `orders.status`/`orders.payment_status` updates for the matching order. Response body is VNPay's required `{RspCode, Message}` JSON contract — not a generic 200.
- Reads env vars: `VNPAY_HASH_SECRET` (Supabase secret, set in Task 6), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (auto-provided).

**No automated test** — same reasoning as Task 1.

- [ ] **Step 1: Write the full file content**

Replace all of `supabase/functions/vnpay-ipn/index.ts` with:

```ts
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

async function verifyVnpaySignature(params: URLSearchParams, secret: string): Promise<boolean> {
  const received = params.get("vnp_SecureHash")
  if (!received) return false
  const entries = Array.from(params.entries()).filter(
    ([k]) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType"
  )
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signString = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signString))
  const computed = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  if (computed.length !== received.length) return false
  let mismatch = 0
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return mismatch === 0
}

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

  const orderId = params.get("vnp_TxnRef")
  const vnpAmount = Number(params.get("vnp_Amount") ?? "0")
  const responseCode = params.get("vnp_ResponseCode")

  if (!orderId) {
    return ipnResponse("01", "Order not found")
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: order } = await serviceClient
    .from("orders")
    .select("id, total, payment_status")
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
      .update({ status: "paid", payment_status: "paid" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  } else {
    await serviceClient
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  }

  return ipnResponse("00", "Confirm Success")
})
```

- [ ] **Step 2: Deploy the function**

Use the `mcp__supabase__deploy_edge_function` tool:
- `name: "vnpay-ipn"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files: [{ name: "index.ts", content: "<the full content from Step 1>" }]`

- [ ] **Step 3: Manual smoke test (expect a signature failure — real events tested in Task 7)**

```bash
curl -s "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/vnpay-ipn?vnp_TxnRef=test&vnp_Amount=100000&vnp_ResponseCode=00"
```

Expected: `{"RspCode":"97","Message":"Invalid signature"}` — confirms the function deployed, is reachable, and correctly rejects an unsigned/forged request rather than silently updating an order.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/vnpay-ipn/index.ts
git commit -m "feat: implement vnpay-ipn to confirm/cancel orders from VNPay's server callback"
```

---

### Task 3: `vnpay-return` Edge Function

**Files:**
- Modify: `supabase/functions/vnpay-return/index.ts` (currently a one-line stub)

**Interfaces:**
- Consumes: the browser's GET redirect from VNPay (`vnp_*` params plus `orderId`/`locale` this project appended to `vnp_ReturnUrl` itself in Task 1).
- Produces: an HTTP 302 redirect to either `/orders/{orderId}` (success) or `/checkout?paymentFailed=1` (failure/cancel/tampered). Never marks an order paid itself — only cancels via the existing `cancel_pending_order` RPC.
- Reads env vars: `VNPAY_HASH_SECRET` (Supabase secret), `SITE_URL` (Supabase secret, already set from the Stripe work), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (auto-provided).

**No automated test** — same reasoning as Task 1.

- [ ] **Step 1: Write the full file content**

Replace all of `supabase/functions/vnpay-return/index.ts` with:

```ts
// vnpay-return: browser-facing redirect after a VNPay checkout attempt.
// NOT the source of truth for "paid" — vnpay-ipn is (see that function
// and docs/superpowers/specs/2026-07-07-vnpay-payment-integration-design.md).
// This only decides where to send the customer's browser next, and
// self-cancels an order the customer backed out of or that failed,
// via the same guest-safe cancel_pending_order RPC the Stripe work
// added (migration 0018) — reused as-is, no VNPay-specific
// cancellation logic needed.

import { createClient } from "jsr:@supabase/supabase-js@2"

async function verifyVnpaySignature(params: URLSearchParams, secret: string): Promise<boolean> {
  const received = params.get("vnp_SecureHash")
  if (!received) return false
  const entries = Array.from(params.entries()).filter(
    ([k]) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType" && k !== "orderId" && k !== "locale"
  )
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signString = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signString))
  const computed = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  if (computed.length !== received.length) return false
  let mismatch = 0
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return mismatch === 0
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams
  const orderId = params.get("orderId")
  const locale = params.get("locale") === "en" ? "en" : "vi"
  const siteUrl = Deno.env.get("SITE_URL")!
  const hashSecret = Deno.env.get("VNPAY_HASH_SECRET")

  if (!orderId || !hashSecret || !(await verifyVnpaySignature(params, hashSecret))) {
    return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
  }

  const responseCode = params.get("vnp_ResponseCode")

  if (responseCode === "00") {
    return Response.redirect(`${siteUrl}/${locale}/orders/${orderId}`, 302)
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })

  return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
})
```

- [ ] **Step 2: Deploy the function**

Use the `mcp__supabase__deploy_edge_function` tool:
- `name: "vnpay-return"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files: [{ name: "index.ts", content: "<the full content from Step 1>" }]`

- [ ] **Step 3: Manual smoke test (expect a redirect to the failure page — real events tested in Task 7)**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/vnpay-return?orderId=test&locale=vi"
```

Expected: `302` with a redirect URL ending in `/vi/checkout?paymentFailed=1` (no `orderId`/hash means the signature check fails, which is the correct behavior for an unsigned request) — confirms the function deployed and is reachable.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/vnpay-return/index.ts
git commit -m "feat: implement vnpay-return to redirect after VNPay checkout"
```

---

### Task 4: Enable VNPay on Checkout

**Files:**
- Modify: `components/customer/checkout-view.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `place-order`'s `checkoutUrl` response field (already handled generically since the Stripe work — no new branching needed for the redirect itself).
- Produces: no new exports.

- [ ] **Step 1: Add the new translation key**

In `messages/en.json`, inside the `Checkout` namespace, add (after `"payCash"`):

```json
    "payCash": "Cash",
    "payVNPay": "VNPay",
```

In `messages/vi.json`, inside the `Checkout` namespace, add (after `"payCash"`):

```json
    "payCash": "Tiền Mặt",
    "payVNPay": "VNPay",
```

(`"VNPay"` is a third-party brand name, not translated — same value in both files, same convention as `Brand.name`.)

- [ ] **Step 2: Fold VNPay into `PAYMENT_OPTIONS` and remove the separate hardcoded button**

In `components/customer/checkout-view.tsx`, change:

```tsx
const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: true },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
]
```

to:

```tsx
const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash" | "payVNPay"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: true },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
  { id: "vnpay", icon: QrCode, labelKey: "payVNPay", enabled: true },
]
```

Then remove the now-redundant hardcoded VNPay button that sits after the `PAYMENT_OPTIONS.map(...)` block:

```tsx
          <button
            type="button"
            disabled
            title={t("paymentMethodComingSoon")}
            onClick={() => setPaymentMethod("vnpay")}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground opacity-50 transition-colors"
          >
            <QrCode className="h-7 w-7" />
            <span className="text-xs font-bold">VNPay</span>
          </button>
```

Delete this block entirely — `PAYMENT_OPTIONS.map(...)` now renders VNPay's button itself.

- [ ] **Step 3: Handle `?paymentFailed=1`**

Add a new effect right after the existing `?stripeCanceled=` effect:

```tsx
  useEffect(() => {
    if (searchParams.get("paymentFailed") !== "1") return
    setCanceledNotice(true)
    router.replace("/checkout")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

This reuses the existing `canceledNotice` state and its already-rendered `paymentCanceledNotice` notice — no new UI needed, since `vnpay-return` already performed the actual cancellation server-side before this redirect (unlike the Stripe path, which cancels client-side on arrival).

- [ ] **Step 4: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/customer/checkout-view.tsx messages/vi.json messages/en.json
git commit -m "feat: enable VNPay on customer checkout"
```

---

### Task 5: Enable VNPay on POS

**Files:**
- Modify: `components/staff/pos-terminal.tsx`

**Interfaces:**
- No new exports. `paymentMethod: "vnpay"` in POS's local state maps directly to `payment_method: "vnpay"` in the request body — `'vnpay'` is already its own distinct enum value (unlike Card, which reuses `'stripe'`).

- [ ] **Step 1: Enable the VNPay option**

In `components/staff/pos-terminal.tsx`, change:

```tsx
              {(["cash", "card", "vnpay"] as PaymentMethod[]).map((method) => {
                const enabled = method === "cash" || method === "card"
```

to:

```tsx
              {(["cash", "card", "vnpay"] as PaymentMethod[]).map((method) => {
                const enabled = method === "cash" || method === "card" || method === "vnpay"
```

- [ ] **Step 2: Map `paymentMethod` to the DB enum in `handleCharge`**

Change:

```tsx
          paymentMethod: paymentMethod === "card" ? "stripe" : "cash",
```

to:

```tsx
          paymentMethod: paymentMethod === "card" ? "stripe" : paymentMethod === "vnpay" ? "vnpay" : "cash",
```

- [ ] **Step 3: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/staff/pos-terminal.tsx
git commit -m "feat: enable POS VNPay charge"
```

---

### Task 6: Manual configuration (Supabase secrets)

**No files change in this task.** Same category of manual step as the Stripe work's Task 8 — no MCP tool in this project manages Supabase Edge Function secrets.

- [ ] **Step 1: Set Supabase Edge Function secrets**

Via the Supabase Dashboard (Project `qhiypdqnrnzndxdwqxbx` → Edge Functions → Secrets), or the Supabase CLI if installed (`supabase secrets set --project-ref qhiypdqnrnzndxdwqxbx KEY=value`), set:

- `VNPAY_TMN_CODE` — the same value already in `.env.local` (a real, registered VNPay sandbox merchant code, confirmed with the user during design).
- `VNPAY_HASH_SECRET` — the same value already in `.env.local`.

`SITE_URL` and `SUPABASE_URL` are already available (the former set during the Stripe work, the latter auto-provided) — no new secret needed for either.

- [ ] **Step 2: Confirm secrets are live**

Re-run Task 1 Step 3 and Task 2 Step 3's curl smoke tests — behavior is unchanged (they test signature/validation failures, not the secrets themselves), but this confirms both functions redeployed cleanly after the secrets were added. Real end-to-end confirmation happens in Task 7 using an actual VNPay sandbox payment.

---

### Task 7: End-to-end verification

**No files change in this task** — final verification pass, run against the deployed Vercel URL per this project's established convention (not `npm run dev`).

- [ ] **Step 1: Deploy the frontend changes**

Push the commits from Tasks 4 and 5 to `main` (Vercel auto-deploys on push).

- [ ] **Step 2: Verify VNPay success path**

On `https://phadincafe.vercel.app`, add an item to cart, go to Checkout, select VNPay, place the order. Confirm:
- Browser redirects to VNPay's sandbox gateway (`sandbox.vnpayment.vn`).
- Pay with a VNPay sandbox test card (from VNPay's sandbox documentation for the registered test merchant).
- Browser lands on `/orders/{id}` after VNPay redirects through `vnpay-return`.
- Within a few seconds, confirm via `mcp__supabase__execute_sql`:
  `select status, payment_status, loyalty_points_earned from orders where id = '<id>';`
  shows `status` no longer `pending_payment` and `payment_status = 'paid'`.

- [ ] **Step 3: Verify VNPay failure/cancel path**

Start a VNPay checkout again, but choose a sandbox failure/cancel option on VNPay's page (or use a documented always-failing sandbox test card). Confirm:
- Lands back on `/checkout` with `?paymentFailed=1` (or the URL already stripped by `router.replace`) and the "payment cancelled" notice shown.
- `select status from orders where id = '<id>';` shows `cancelled`.
- Placing the order again (e.g. with Cash) works normally.

- [ ] **Step 4: Verify IPN idempotency**

Using the order id from Step 2 (already `paid`), manually replay the same IPN call it would have received (reconstructing the query string with the same `vnp_TxnRef`/`vnp_Amount`/`vnp_ResponseCode`/`vnp_SecureHash` values — or simplest: call `vnpay-ipn` a second time with the exact same URL if it was logged/captured):

```bash
curl -s "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/vnpay-ipn?<same-query-string-as-the-real-IPN-call>"
```

Expected: `{"RspCode":"02","Message":"Order already confirmed"}` — confirms no double inventory deduction or loyalty award. If the original IPN's query string wasn't captured, skip this and rely on the guarded-`UPDATE` code review instead — same idempotency mechanism already proven to work for Stripe's webhook.

- [ ] **Step 5: Verify POS VNPay charge**

Log into a staff/manager/admin account, go to `/staff/pos`, add an item, select VNPay, tap Charge. Confirm:
- No redirect happens (no VNPay API call for this path).
- The order appears on `/staff/orders` (Kitchen Display) in the "New" column immediately.
- `select payment_method, status, payment_status from orders where id = '<id>';` shows `payment_method = 'vnpay'`, `status = 'paid'`, `payment_status = 'paid'`.

- [ ] **Step 6: Regression check — Cash and Stripe still work**

Place one Cash order and one Stripe order via customer Checkout, confirming both still behave exactly as before this plan's changes.

- [ ] **Step 7: Update `daily.md` and `CLAUDE.md`**

Mark VNPay as shipped in `daily.md`'s "Open / not started" section, and add a "VNPay payment integration" section to `CLAUDE.md` following the same structure/level of detail as the existing "Stripe payment integration" section — this closes out the entire Cash → Stripe → VNPay payment sequencing from the original Orders Realtime spec.
