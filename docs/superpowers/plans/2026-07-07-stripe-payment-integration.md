# Stripe Payment Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Checkout's "Card" button and POS's "Card" button real — customer self-checkout gets a real Stripe Checkout redirect with webhook-confirmed payment and a self-cancel path; POS's Card option marks an order paid immediately (money already collected via a physical terminal outside this app).

**Architecture:** Extend the existing `place-order` Edge Function to optionally create a Stripe Checkout Session after `place_order` inserts the order (still `pending_payment`/`pending`); a new `stripe-webhook` Edge Function verifies Stripe's signature and flips the order to `paid` (on `checkout.session.completed`) or `cancelled` (on `checkout.session.expired`) via a plain `UPDATE`, which the existing `handle_order_paid` trigger picks up for inventory deduction and loyalty points with no new logic. A new `cancel_pending_order` RPC lets a customer self-cancel if they back out of Stripe's page.

**Tech Stack:** Deno Edge Functions (raw `fetch` against Stripe's REST API — no Stripe SDK, matching this project's existing dependency-free functions), Postgres/PL-pgSQL (Supabase), Next.js/React client components, next-intl.

**Reference spec:** `docs/superpowers/specs/2026-07-07-stripe-payment-integration-design.md`

## Global Constraints

- VND is a Stripe **zero-decimal currency** — amounts sent to Stripe's API are the integer VND value as-is, never multiplied by 100.
- Every new user-facing string is added to **both** `messages/vi.json` and `messages/en.json`.
- **Supabase Edge Function secrets (`Deno.env`) are a separate store from Vercel env vars.** A variable synced to Vercel (e.g. `STRIPE_SECRET_KEY` in `.env.local`/Vercel) is *not* automatically available inside an Edge Function — it must be set separately via the Supabase Dashboard or `supabase secrets set`.
- `handle_order_paid` (migration `0007`) only fires on an `UPDATE` that transitions `payment_status` to `'paid'` — never on `INSERT`. Any code path marking an order paid must do a genuine `UPDATE`, not insert already-paid.
- The Postgres `order_type` enum is `pickup | dine_in` (underscore). Client-side state uses hyphenated `"dine-in"` and must be translated to `dine_in` before it reaches any RPC call — this is currently *not* done correctly in two places (see Task 1).
- Verify against the deployed Vercel URL (`https://phadincafe.vercel.app`), not `npm run dev`/localhost, per this project's established convention.

---

### Task 1: Fix dine-in order placement (prerequisite bug fix)

**Context:** While designing the Stripe redirect's success URL (which needs `orderType` to reach `place_order` correctly for both pickup and dine-in), live testing found that `'dine-in'::order_type` throws `invalid input value for enum order_type` — confirmed directly against the hosted database. `components/customer/checkout-view.tsx`'s `handlePlaceOrder` sends the client's hyphenated `orderType` state straight through to the `place-order` Edge Function, which passes it unmodified to `place_order`'s `(p_payload->>'orderType')::order_type` cast. **Every dine-in order placed via Checkout today fails** — this blocks dine-in + Stripe together, so it must be fixed first. (POS has the identical bug; fixed in Task 7 alongside enabling POS's Card button, same file/function.)

**Files:**
- Modify: `components/customer/checkout-view.tsx:73-90` (the `handlePlaceOrder` function's `body` object)

**Interfaces:**
- No new exports. Pure internal fix to the request body sent to the existing `place-order` Edge Function.

- [ ] **Step 1: Change the `orderType` field sent to the Edge Function**

In `components/customer/checkout-view.tsx`, inside `handlePlaceOrder`, find:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType,
          tableId: orderType === "dine-in" ? (activeTable?.id ?? null) : null,
```

Replace with:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (activeTable?.id ?? null) : null,
```

- [ ] **Step 2: Verify the cast now succeeds**

Run against the live database (this project has no local Postgres/Deno test harness for RPC/enum-level checks — matches the existing convention of verifying SQL behavior directly):

```sql
select 'dine_in'::order_type;
```

Expected: returns `dine_in` with no error (confirms the value Checkout will now send is valid — the actual end-to-end order-placement check happens in Task 9).

- [ ] **Step 3: Commit**

```bash
git add components/customer/checkout-view.tsx
git commit -m "fix: send valid dine_in enum value to place_order, not hyphenated dine-in"
```

---

### Task 2: Migration — `cancel_pending_order` RPC

**Files:**
- Create: `supabase/migrations/0018_cancel_pending_order_fn.sql`

**Interfaces:**
- Produces: SQL function `public.cancel_pending_order(p_order_id uuid) returns boolean`, granted to `anon, authenticated`. Returns `true` if it cancelled the order, `false` if the order didn't exist or wasn't `pending_payment` (no-op). Raises an exception if a logged-in caller isn't that order's owner.

- [ ] **Step 1: Write the migration file**

```sql
-- 0018_cancel_pending_order_fn.sql
-- Stripe follow-up: lets a customer self-cancel their own still-pending
-- order (e.g. backing out of Stripe Checkout) without waiting for the
-- checkout.session.expired webhook's 30-minute timeout. Mirrors
-- get_order_for_tracking's guest-safe pattern (migration 0014) — a
-- single-row operation keyed by an unguessable UUID, never a broad RLS
-- policy that could let one guest affect another guest's order.

create or replace function public.cancel_pending_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id from public.orders
    where id = p_order_id and status = 'pending_payment';

  if not found then
    return false;
  end if;

  if v_customer_id is not null and v_customer_id != auth.uid() then
    raise exception 'not authorized to cancel this order';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;
  return true;
end;
$$;

grant execute on function public.cancel_pending_order(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration to the hosted project**

Use the `mcp__supabase__apply_migration` tool with `name: "cancel_pending_order_fn"` and the exact SQL from Step 1.

- [ ] **Step 3: Verify live**

Run via `mcp__supabase__execute_sql`:

```sql
-- Should return false (no such order) rather than erroring:
select public.cancel_pending_order('00000000-0000-0000-0000-000000000000'::uuid);
```

Expected: `false`, no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_cancel_pending_order_fn.sql
git commit -m "feat: add cancel_pending_order RPC for Stripe checkout self-cancel"
```

---

### Task 3: `cancelPendingOrder` query-layer function

**Files:**
- Modify: `lib/supabase/orders-data.ts`
- Modify: `lib/supabase/orders-data.test.ts`

**Interfaces:**
- Consumes: `cancel_pending_order` RPC from Task 2 (`p_order_id uuid` → `boolean`).
- Produces: `cancelPendingOrder(supabase: SupabaseClient, orderId: string): Promise<boolean>`, used by Task 6's Checkout self-cancel effect.

- [ ] **Step 1: Write the failing tests**

Append to `lib/supabase/orders-data.test.ts` (add `cancelPendingOrder` to the existing import line at the top of the file, then add this new `describe` block at the end of the file):

```ts
describe("cancelPendingOrder", () => {
  it("calls the RPC with the order id and returns its boolean result", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await cancelPendingOrder(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("cancel_pending_order", { p_order_id: "ord-1" })
    expect(result).toBe(true)
  })

  it("returns false when the RPC reports the order wasn't cancellable", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await cancelPendingOrder(supabase, "ord-2")
    expect(result).toBe(false)
  })
})
```

The import line at the top of `lib/supabase/orders-data.test.ts` changes from:

```ts
import {
  getOrderForTracking,
  placeOrder,
  getMyOrders,
  getKitchenOrders,
  advanceOrderStatus,
  confirmCashPayment,
} from "./orders-data"
```

to:

```ts
import {
  getOrderForTracking,
  placeOrder,
  getMyOrders,
  getKitchenOrders,
  advanceOrderStatus,
  confirmCashPayment,
  cancelPendingOrder,
} from "./orders-data"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- orders-data`
Expected: FAIL — `cancelPendingOrder` is not exported from `./orders-data`.

- [ ] **Step 3: Implement `cancelPendingOrder`**

Append to `lib/supabase/orders-data.ts` (after `confirmCashPayment`):

```ts
export async function cancelPendingOrder(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("cancel_pending_order", { p_order_id: orderId })
  if (error) throw error
  return data as boolean
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- orders-data`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "feat: add cancelPendingOrder query-layer function"
```

---

### Task 4: Extend `place-order` Edge Function to create a Stripe Checkout Session

**Files:**
- Modify: `supabase/functions/place-order/index.ts`

**Interfaces:**
- Consumes: `place_order` RPC (unchanged). New payload fields (all optional, only meaningful when `paymentMethod === "stripe"` and `paymentCollected` is not `true`): `locale: "vi" | "en"`, `tableNumber?: string`.
- Produces: response body gains an optional `checkoutUrl` field. `{ orderId, total }` (cash, or POS card) vs. `{ orderId, total, checkoutUrl }` (customer online Stripe checkout).
- Reads new env vars at runtime: `STRIPE_SECRET_KEY`, `SITE_URL` (both Supabase Edge Function secrets — see Task 8, not yet set until then).

**No automated test for this task** — this project has no Deno-level test harness for Edge Functions (every prior Edge Function, e.g. `place-order`'s original cash path and `create-staff-account`, was verified by live/manual calls, not unit tests, per the established convention noted in `daily.md`'s "No Vitest/RTL coverage beyond the `lib/supabase/*.ts` query layers" note). Verification is manual (Step 3 below) and end-to-end (Task 9).

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
// For this pass, VNPay stays disabled in Checkout until its own spec
// lands. This function is a thin wrapper around the place_order RPC,
// shaped so a future VNPay pass can wrap a gateway call around this
// same call without re-architecting anything here.
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

    const needsStripeSession = payload.paymentMethod === "stripe" && payload.paymentCollected !== true

    if (needsStripeSession) {
      const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
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
- `verify_jwt: false` (matches the function's existing, already-deployed setting — a guest with no session must be able to call it)
- `files: [{ name: "index.ts", content: "<the full content from Step 1>" }]`

- [ ] **Step 3: Manual smoke test (Stripe secrets not yet configured — expect a specific failure)**

This function's Stripe branch can't fully succeed yet because `STRIPE_SECRET_KEY`/`SITE_URL` aren't set as Supabase secrets until Task 8. Confirm the *cash* path (payload has no Stripe fields) still works, since that's the regression risk of this change:

```bash
curl -s -X POST "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/place-order" \
  -H "Content-Type: application/json" \
  -d '{"orderType":"pickup","tableId":null,"pickupTime":"asap","paymentMethod":"cash","promoCode":null,"redeemLoyaltyPoints":0,"paymentCollected":false,"items":[]}'
```

Expected: a 400 JSON error about no items (`place_order` validation, not a CORS/auth/deploy failure) — proves the cash path still reaches `place_order` unchanged. (An empty-cart order is intentionally invalid; this call is just checking the function still runs, not placing a real order.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/place-order/index.ts
git commit -m "feat: create a Stripe Checkout Session from place-order for online card payment"
```

---

### Task 5: `stripe-webhook` Edge Function

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts` (currently a one-line stub)

**Interfaces:**
- Consumes: Stripe webhook HTTP requests (`Stripe-Signature` header, JSON body with `type` and `data.object.metadata.order_id`).
- Produces: `orders.status`/`orders.payment_status` updates for the matching order — no new exported TS interfaces (this is an HTTP endpoint, not an importable module).
- Reads env vars: `STRIPE_WEBHOOK_SECRET` (Supabase secret, set in Task 8), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (auto-provided by Supabase to every Edge Function, no action needed).

**No automated test** — same reasoning as Task 4 (no Deno test harness in this project; verified live in Task 9 via Stripe's dashboard test-event tooling).

- [ ] **Step 1: Write the full file content**

Replace all of `supabase/functions/stripe-webhook/index.ts` with:

```ts
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

  if (event.type === "checkout.session.completed" && orderId) {
    await serviceClient
      .from("orders")
      .update({ status: "paid", payment_status: "paid" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  } else if (event.type === "checkout.session.expired" && orderId) {
    await serviceClient
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
```

- [ ] **Step 2: Deploy the function**

Use the `mcp__supabase__deploy_edge_function` tool:
- `name: "stripe-webhook"`
- `entrypoint_path: "index.ts"`
- `verify_jwt: false`
- `files: [{ name: "index.ts", content: "<the full content from Step 1>" }]`

- [ ] **Step 3: Manual smoke test (expect a signature failure — real events tested in Task 9)**

```bash
curl -s -X POST "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/stripe-webhook" \
  -H "Content-Type: application/json" \
  -d '{"type":"checkout.session.completed","data":{"object":{"metadata":{"order_id":"test"}}}}'
```

Expected: `Missing signature` (400) — confirms the function deployed and is reachable; a request with no `Stripe-Signature` header is correctly rejected rather than silently updating an order.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: implement stripe-webhook to confirm/cancel orders from Stripe events"
```

---

### Task 6: Enable Stripe on Checkout, add self-cancel handling

**Files:**
- Modify: `components/customer/checkout-view.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `cancelPendingOrder` from `@/lib/supabase/orders-data` (Task 3); `place-order`'s new `checkoutUrl` response field (Task 4).
- Produces: no new exports — this is the customer-facing UI entry point for the whole feature.

- [ ] **Step 1: Add the new translation keys**

In `messages/en.json`, inside the `Checkout` namespace, add (after `"placeOrderError"`):

```json
    "placeOrderError": "Failed to place order. Try again.",
    "cardPaymentUnavailable": "Card payment isn't available for this order — try Cash.",
    "paymentCanceledNotice": "Payment cancelled — your cart is still here, try another method.",
```

In `messages/vi.json`, inside the `Checkout` namespace, add (after `"placeOrderError"`):

```json
    "placeOrderError": "Đặt hàng thất bại. Vui lòng thử lại.",
    "cardPaymentUnavailable": "Không thể thanh toán bằng thẻ cho đơn này — vui lòng dùng Tiền Mặt.",
    "paymentCanceledNotice": "Đã hủy thanh toán — giỏ hàng của bạn vẫn còn, hãy thử phương thức khác.",
```

- [ ] **Step 2: Enable the Stripe payment option**

In `components/customer/checkout-view.tsx`, change:

```tsx
const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: false },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
]
```

to:

```tsx
const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: true },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
]
```

- [ ] **Step 3: Add the self-cancel effect**

Add `useSearchParams` to the `next/navigation` import and `cancelPendingOrder` to the orders-data import. At the top of the file, change:

```tsx
import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CreditCard, Banknote, QrCode, TableIcon, Sparkles } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { useCart } from "@/hooks/useCart"
import { useTables } from "@/hooks/useTables"
```

to:

```tsx
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CreditCard, Banknote, QrCode, TableIcon, Sparkles } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { cancelPendingOrder } from "@/lib/supabase/orders-data"
import { useCart } from "@/hooks/useCart"
import { useTables } from "@/hooks/useTables"
```

Inside `CheckoutView`, add a `searchParams` hook and a `canceledNotice` state near the other `useState` declarations:

```tsx
  const searchParams = useSearchParams()
  const [canceledNotice, setCanceledNotice] = useState(false)
```

Add a new effect (after the existing `useEffect` that loads `isLoggedIn`/`pointsBalance`/`redeemValuePerPoint`):

```tsx
  useEffect(() => {
    const canceledOrderId = searchParams.get("stripeCanceled")
    if (!canceledOrderId) return
    cancelPendingOrder(supabase, canceledOrderId).finally(() => {
      setCanceledNotice(true)
      router.replace("/checkout")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 4: Send `locale`/`tableNumber` and handle `checkoutUrl` in `handlePlaceOrder`**

Change:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (activeTable?.id ?? null) : null,
          pickupTime: orderType === "pickup" ? pickupTime : null,
          paymentMethod,
          promoCode,
          redeemLoyaltyPoints: redeemLoyalty && canRedeem ? REDEEM_CHUNK_POINTS : 0,
          paymentCollected: false,
          items: items.map((item) => ({
            menuItemId: item.menuItemId,
            sizeId: item.size?.id ?? null,
            modifierIds: item.modifiers.map((m) => m.optionId),
            quantity: item.quantity,
            note: item.note ?? null,
          })),
        },
      })
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      clear()
      if (orderType === "dine-in") {
        router.push(`/orders/${data.orderId}?table=${encodeURIComponent(tableNumber)}`)
      } else {
        router.push(`/orders/${data.orderId}`)
      }
```

to:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (activeTable?.id ?? null) : null,
          tableNumber: orderType === "dine-in" ? tableNumber : null,
          pickupTime: orderType === "pickup" ? pickupTime : null,
          paymentMethod,
          promoCode,
          redeemLoyaltyPoints: redeemLoyalty && canRedeem ? REDEEM_CHUNK_POINTS : 0,
          paymentCollected: false,
          locale,
          items: items.map((item) => ({
            menuItemId: item.menuItemId,
            sizeId: item.size?.id ?? null,
            modifierIds: item.modifiers.map((m) => m.optionId),
            quantity: item.quantity,
            note: item.note ?? null,
          })),
        },
      })
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      clear()
      if (orderType === "dine-in") {
        router.push(`/orders/${data.orderId}?table=${encodeURIComponent(tableNumber)}`)
      } else {
        router.push(`/orders/${data.orderId}`)
      }
```

The `catch` block just below this also needs to differentiate a Stripe-specific failure (e.g. Stripe rejecting a too-small total) from a generic one, per the design spec. Change:

```tsx
    } catch {
      setError(t("placeOrderError"))
      setIsPlacing(false)
    }
```

to:

```tsx
    } catch {
      setError(paymentMethod === "stripe" ? t("cardPaymentUnavailable") : t("placeOrderError"))
      setIsPlacing(false)
    }
```

Note: `clear()` is intentionally skipped on the `checkoutUrl` branch — the cart stays intact until payment is actually confirmed (Order Tracking's arrival via `success_url` is the confirmation point), unlike Cash which clears immediately since payment there is already guaranteed in-hand.

- [ ] **Step 5: Render the cancellation notice**

Change:

```tsx
      {error && (
        <p className="mx-auto mb-2 max-w-2xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
```

to:

```tsx
      {canceledNotice && (
        <p className="mx-auto mb-2 max-w-2xl rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t("paymentCanceledNotice")}
        </p>
      )}
      {error && (
        <p className="mx-auto mb-2 max-w-2xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
```

- [ ] **Step 6: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add components/customer/checkout-view.tsx messages/vi.json messages/en.json
git commit -m "feat: enable Stripe Checkout on customer checkout with self-cancel handling"
```

---

### Task 7: Enable Card on POS, fix its dine-in bug

**Files:**
- Modify: `components/staff/pos-terminal.tsx`

**Interfaces:**
- No new exports. `paymentMethod: "card"` in POS's local state now maps to `payment_method: "stripe"` in the request body (per the design spec, POS's "Card" reuses the `'stripe'` enum value to mean "card," since there is no separate DB enum value for it — see Global Constraints and the design spec's payment_method note).

- [ ] **Step 1: Enable the Card option**

In `components/staff/pos-terminal.tsx`, change:

```tsx
              {(["cash", "card", "vnpay"] as PaymentMethod[]).map((method) => {
                const enabled = method === "cash"
```

to:

```tsx
              {(["cash", "card", "vnpay"] as PaymentMethod[]).map((method) => {
                const enabled = method === "cash" || method === "card"
```

- [ ] **Step 2: Fix the dine-in enum bug and map `paymentMethod` to the DB enum in `handleCharge`**

Change:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine-in" : "pickup",
          tableId: orderType === "dine-in" ? (selectedTable?.id ?? null) : null,
          pickupTime: null,
          paymentMethod: "cash",
          promoCode: null,
          redeemLoyaltyPoints: 0,
          paymentCollected: true,
```

to:

```tsx
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (selectedTable?.id ?? null) : null,
          pickupTime: null,
          paymentMethod: paymentMethod === "card" ? "stripe" : "cash",
          promoCode: null,
          redeemLoyaltyPoints: 0,
          paymentCollected: true,
```

- [ ] **Step 3: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/staff/pos-terminal.tsx
git commit -m "feat: enable POS Card charge, fix dine-in enum mismatch"
```

---

### Task 8: Manual configuration (Supabase secrets + Stripe Dashboard webhook)

**No files change in this task.** These steps require Dashboard access / values that shouldn't be typed into an agent session, and no MCP tool in this project exposes Supabase Edge Function secret management or Stripe webhook endpoint creation (the same category of manual step as Supabase Auth's URL Configuration, documented in CLAUDE.md's Deployment section).

- [ ] **Step 1: Set Supabase Edge Function secrets**

Via the Supabase Dashboard (Project `qhiypdqnrnzndxdwqxbx` → Edge Functions → Secrets), or the Supabase CLI if installed (`supabase secrets set --project-ref qhiypdqnrnzndxdwqxbx KEY=value`), set:

- `STRIPE_SECRET_KEY` — the same test-mode key already in `.env.local`/Vercel (`sk_test_...`). This is a **separate secret store from Vercel** — syncing it to Vercel earlier did not make it available to this Edge Function.
- `SITE_URL` — `https://phadincafe.vercel.app` (the production domain; this is a new secret specific to Edge Functions, distinct from Vercel's `NEXT_PUBLIC_SITE_URL`, which defaults to `localhost:3000` in `.env.local` and is not readable from Deno's environment).

- [ ] **Step 2: Create the Stripe webhook endpoint**

In the Stripe Dashboard (test mode) → Developers → Webhooks → Add endpoint:
- Endpoint URL: `https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/stripe-webhook`
- Events to send: `checkout.session.completed`, `checkout.session.expired`
- Save, then copy the endpoint's signing secret (starts with `whsec_...`).

- [ ] **Step 3: Set the webhook secret**

Set `STRIPE_WEBHOOK_SECRET` (the `whsec_...` value from Step 2) as a Supabase Edge Function secret, same mechanism as Step 1. Also update `.env.local` and Vercel's env vars for consistency with the rest of the project's env-var tracking (not read by any Next.js code, but keeps `.env.local` accurate as the project's source-of-truth reference, per its existing convention of listing every secret even ones only Edge Functions read).

- [ ] **Step 4: Confirm secrets are live**

Re-run Task 5 Step 3's curl smoke test — behavior is unchanged (still rejects for missing signature, since a plain curl still sends no `Stripe-Signature` header), but this confirms the function redeployed cleanly after the secret was added. Real signature verification is exercised in Task 9 using an actual Stripe test payment.

---

### Task 9: End-to-end verification

**No files change in this task** — this is the final verification pass, run against the deployed Vercel URL per this project's established convention (not `npm run dev`).

- [ ] **Step 1: Deploy the frontend changes**

Push the commits from Tasks 1, 6, 7 to `main` (Vercel auto-deploys on push, per CLAUDE.md's Deployment section — no manual `vercel deploy` needed).

- [ ] **Step 2: Verify pickup + Stripe success path**

On `https://phadincafe.vercel.app`, add an item to cart, go to Checkout, choose Pickup, select Card, place the order. Confirm:
- Browser redirects to a `checkout.stripe.com` URL.
- Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.
- Browser redirects back to `/orders/{id}` on success.
- Within a few seconds, the order's status updates to reflect payment (via existing Realtime/polling) — confirm via `mcp__supabase__execute_sql`: `select status, payment_status, loyalty_points_earned from orders where id = '<id>';` shows `status` no longer `pending_payment` and `payment_status = 'paid'`.
- If a logged-in test customer was used, confirm `loyalty_points_earned > 0` and the ingredient stock for the ordered item decreased (via `select * from inventory_logs where reference_order_id = '<id>';`) — proves `handle_order_paid` fired correctly off the webhook's `UPDATE`.

- [ ] **Step 3: Verify dine-in + Stripe (the bug fixed in Task 1)**

Scan a real table's QR code (or visit `/table/table-1`), add an item, go to Checkout — confirm it shows Dine-in with a real table number — pay with Card. Confirm the order is created successfully (no `invalid input value for enum order_type` error) and the success redirect includes `?table=`.

- [ ] **Step 4: Verify self-cancel**

Start a Card checkout, and on Stripe's hosted page, use its "‹ Back" link (not browser back) to return to the shop. Confirm:
- Landed back on `/checkout` with the cart still populated.
- The "payment cancelled" notice is shown.
- `select status from orders where id = '<id>';` shows `cancelled`.
- Placing the order again (e.g. with Cash) works normally.

- [ ] **Step 5: Verify `checkout.session.expired`**

In the Stripe Dashboard (test mode) → Developers → Webhooks → the endpoint from Task 8 → "Send test webhook" → select `checkout.session.expired`, with a `metadata.order_id` matching a real `pending_payment` test order created in Step 2/3 style (place one, don't pay it). Confirm that order's `status` becomes `cancelled` after the test event is sent.

- [ ] **Step 6: Verify POS Card charge**

Log into a staff/manager/admin account, go to `/staff/pos`, add an item, select Card, tap Charge. Confirm:
- No redirect happens (no Stripe API call for this path).
- The order appears on `/staff/orders` (Kitchen Display) in the "New" column immediately.
- `select payment_method, status, payment_status from orders where id = '<id>';` shows `payment_method = 'stripe'`, `status = 'paid'`, `payment_status = 'paid'` — confirms the POS path correctly reuses the `'stripe'` enum value without invoking Stripe.

- [ ] **Step 7: Regression check — Cash still works**

Place one Cash order via customer Checkout (pickup) and one via POS, confirming both still behave exactly as before this plan's changes (Checkout's Cash order clears the cart and navigates immediately; POS's Cash charge clears the ticket and appears on Kitchen Display).

- [ ] **Step 8: Update `daily.md`**

Mark the Stripe follow-up as shipped in `daily.md`'s "Open / not started" section (move it out, add a note in `CLAUDE.md`'s payments coverage once this is confirmed working, following the same documentation pattern used for the other three "make all data real-time" sub-projects).
