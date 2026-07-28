# Architecture Deepening (2026-07-29 review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all five deepening candidates from the 2026-07-29 architecture
review: collapse the payment-lifecycle transitions into one owned Postgres
RPC (closing a live race), extract a shared Order Line module for
Cart/POS/Checkout, deepen the Menu Item form's validation and its
duplicated add/edit-extra flow, route Admin's shift-closing through the
existing Shift hook instead of bypassing it, and dedupe the VNPay
gateway-redirect glue between `place-order` and `pay-order`.

**Architecture:** A new `confirm_order_payment` RPC (paired with the
existing `cancel_pending_order` RPC) becomes the single seam both Deno
Edge Functions (Stripe/VNPay webhooks) and the Next.js client (POS/KDS
cash confirm) call through — sidestepping the documented lack of a
shared-code bridge between those two runtimes (`tsconfig.json` excludes
`supabase/functions`). Everything else is in-process: pure functions
extracted into small new modules (`lib/order-line.ts`,
`lib/validate-menu-item-form.ts`, `components/admin/pagination.tsx`),
consumed by the existing components without touching their state shape.

**Tech Stack:** Next.js 15 (App Router), React 19, next-intl, Tailwind v4,
Supabase (Postgres RPCs via `security definer`, Deno Edge Functions),
vitest.

## Global Constraints

- Any new user-facing string needs a key in **both** `messages/en.json`
  and `messages/vi.json` — enforced by `lib/i18n-coverage.test.ts`. (This
  plan adds no new user-facing strings — all error messages already
  exist and are reused by their existing translation keys.)
- Use semantic Tailwind classes (`bg-primary` etc.) — never hardcode hex.
- Every `lib/supabase/*.ts` query module takes a `SupabaseClient` as its
  first argument (DI'd, not a singleton import) — follow this for
  `confirmOrderPayment`.
- Migrations are applied to the live hosted Supabase project via the
  Supabase MCP server's `apply_migration` tool, and the same SQL is also
  saved to `supabase/migrations/` for the repo's own record (see
  `supabase/CLAUDE.md`) — both steps are required, not just one.
- No Deno test harness exists in this project — Edge Function changes are
  verified live (this project's established convention), not with
  automated tests.
- Verify final behavior against the deployed Vercel URL
  (`https://phadincoffee.vercel.app`), not just `npm run dev` — this
  project's explicit convention. Local `build`/`tsc`/`test` are fine for
  fast feedback but not the source of truth for "does it actually work."
- This plan does **not** touch `hooks/useKitchenOrders.tsx`'s
  `NEXT_STATUS` map or merge it with anything — that split (client-side
  kitchen progression vs. payment-confirmation logic) was a deliberate
  prior decision (see root `CLAUDE.md`'s "Order-status lifecycle logic
  intentionally lives in two separate places" gotcha) and this plan
  leaves it in place. It only consolidates the payment-confirmation
  logic itself, which today lives in *three* duplicated places, into one
  RPC — strengthening the original split rather than reopening it.

---

### Task 1: Add the `confirm_order_payment` RPC

**Files:**
- Create: `supabase/migrations/0056_confirm_order_payment_fn.sql`

**Interfaces:**
- Produces: `public.confirm_order_payment(p_order_id uuid) returns boolean`
  — a `security definer` RPC. Atomically marks an order's payment as
  cleared: if the order is currently `served`, flips only
  `payment_status` to `'paid'` (letting `complete_order_when_served_and_paid`,
  migration `0022`, take it to `completed`); otherwise flips both
  `status` and `payment_status` to `'paid'` (making a pre-kitchen order
  kitchen-visible). Guarded on `payment_status = 'pending'` both at read
  and at write, so a duplicate call (webhook retry, double-tap) is a
  safe no-op. Returns `false` if the order wasn't found or wasn't
  pending. Callable by an authenticated staff/manager/admin session, or
  by the service-role key with no session at all (Stripe/VNPay
  webhooks) — rejects any other authenticated caller (a plain customer)
  with an exception. Later tasks (Task 2, Task 3) call this by name via
  `supabase.rpc("confirm_order_payment", { p_order_id })`.

This mirrors `change_order_payment_method` (migration `0032`)'s shape:
one guarded `UPDATE`, `get diagnostics` to report whether it took
effect.

- [ ] **Step 1: Write the migration file**

```sql
-- 0056_confirm_order_payment_fn.sql
-- Collapses the served-vs-not "mark this order's payment as cleared"
-- branch into one RPC, callable identically from Stripe/VNPay's
-- service-role webhooks and from an authenticated staff client (POS/KDS
-- cash confirm). Previously this branch was independently re-derived in
-- three places: hooks/useKitchenOrders.tsx's confirmCashPayment (from a
-- possibly-stale client-side order list -- a real race that could
-- silently revert an already-served cash order back to 'paid'),
-- stripe-webhook, and vnpay-ipn (both via the now-removed
-- _shared/order-status.ts buildPaidUpdate helper). See the 2026-07-29
-- architecture review and docs/superpowers/plans/2026-07-29-architecture-deepening.md.
--
-- auth.uid() is null when called via the service-role key (no user JWT
-- on the request at all), so "auth.uid() is not null and ... not in
-- (...)" short-circuits to false for webhook callers -- only a
-- logged-in non-staff caller (a plain customer) is rejected.

create or replace function public.confirm_order_payment(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_updated int;
begin
  if auth.uid() is not null and public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not authorized to confirm payment';
  end if;

  select status into v_status from public.orders where id = p_order_id and payment_status = 'pending';
  if not found then
    return false;
  end if;

  if v_status = 'served' then
    update public.orders set payment_status = 'paid'
      where id = p_order_id and payment_status = 'pending';
  else
    update public.orders set status = 'paid', payment_status = 'paid'
      where id = p_order_id and payment_status = 'pending';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.confirm_order_payment(uuid) from public;
grant execute on function public.confirm_order_payment(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP server's `apply_migration` tool with `name:
"confirm_order_payment_fn"` and the SQL body above (matching how all 55
prior migrations were applied — see `supabase/CLAUDE.md`).

- [ ] **Step 3: Verify live via a manual smoke check**

No Deno/pgTAP test harness exists in this project (Edge Functions and
RPCs are verified live). Using the Supabase MCP server's `execute_sql`
tool against a throwaway test order:

```sql
-- find or create a pending_payment test order, then:
select public.confirm_order_payment('<test-order-id>');
-- Expected: true, and the order's payment_status is now 'paid'
select public.confirm_order_payment('<same-test-order-id>');
-- Expected: false (already paid -- the guard rejects the retry)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0056_confirm_order_payment_fn.sql
git commit -m "feat: add confirm_order_payment RPC to unify payment confirmation"
```

---

### Task 2: Route cash confirmation through the new RPC

**Files:**
- Modify: `lib/supabase/orders-data.ts`
- Modify: `lib/supabase/orders-data.test.ts`
- Modify: `hooks/useKitchenOrders.tsx`

**Interfaces:**
- Consumes: `confirm_order_payment` RPC (Task 1).
- Produces: `confirmOrderPayment(supabase, orderId): Promise<boolean>` in
  `orders-data.ts`, replacing `confirmCashPayment`/
  `confirmServedCashPayment`. `useKitchenOrders`'s public
  `confirmCashPayment(orderId): Promise<void>` interface is unchanged —
  `components/staff/pos-terminal.tsx` and
  `components/staff/kitchen-tables-column.tsx` (both call
  `useKitchenOrders().confirmCashPayment`) need no changes.

- [ ] **Step 1: Write the failing test**

Replace the `confirmCashPayment`/`confirmServedCashPayment` describe
blocks in `lib/supabase/orders-data.test.ts` with:

```ts
describe("confirmOrderPayment", () => {
  it("calls the RPC and returns its boolean result", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await confirmOrderPayment(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("confirm_order_payment", { p_order_id: "ord-1" })
    expect(result).toBe(true)
  })

  it("returns false when the RPC reports the order wasn't pending", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    expect(await confirmOrderPayment(supabase, "ord-2")).toBe(false)
  })

  it("throws on RPC error", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(confirmOrderPayment(supabase, "ord-1")).rejects.toThrow("boom")
  })
})
```

Also update the top import list in the same file to import
`confirmOrderPayment` instead of `confirmCashPayment`/
`confirmServedCashPayment`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: FAIL with "confirmOrderPayment is not a function" (or a
TypeScript import error).

- [ ] **Step 3: Replace the two raw-update functions with the RPC wrapper**

In `lib/supabase/orders-data.ts`, replace:

```ts
export async function confirmCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: "paid", payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

export async function confirmServedCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}
```

with:

```ts
export async function confirmOrderPayment(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("confirm_order_payment", { p_order_id: orderId })
  if (error) throw error
  return data as boolean
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove the client-side served/not-served branch in the hook**

In `hooks/useKitchenOrders.tsx`, update the import:

```ts
import {
  advanceOrderStatus,
  confirmOrderPayment,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"
```

Replace:

```ts
async function confirmCashPayment(orderId: string) {
  const order = orders.find((o) => o.id === orderId) ?? pendingPaymentOrders.find((o) => o.id === orderId)
  if (order?.status === "served") {
    await confirmServedCashPaymentQuery(supabase, orderId)
  } else {
    await confirmCashPaymentQuery(supabase, orderId)
  }
}
```

with:

```ts
async function confirmCashPayment(orderId: string) {
  await confirmOrderPayment(supabase, orderId)
}
```

This removes the race entirely: the served-vs-not branch now happens
atomically inside the RPC (Task 1) against the database's current row,
not against a possibly-stale client-side `orders`/`pendingPaymentOrders`
array.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts hooks/useKitchenOrders.tsx
git commit -m "fix: confirm cash payment via confirm_order_payment RPC, closing the served/paid race"
```

---

### Task 3: Route Stripe/VNPay webhooks through the RPCs, delete the dead shared helper

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/vnpay-ipn/index.ts`
- Delete: `supabase/functions/_shared/order-status.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `confirm_order_payment` (Task 1), `cancel_pending_order`
  (existing, migration `0018`).

- [ ] **Step 1: Simplify `stripe-webhook`**

Replace the full body of `supabase/functions/stripe-webhook/index.ts`'s
imports and `Deno.serve` handler:

```ts
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

  if (orderId && event.type === "checkout.session.completed") {
    await serviceClient.rpc("confirm_order_payment", { p_order_id: orderId })
  } else if (orderId && event.type === "checkout.session.expired") {
    // Only a still-pre-kitchen order is cancellable -- cancel_pending_order
    // no-ops for a served Pay Later order whose deferred attempt expired,
    // which correctly just stays served/unpaid awaiting a retry.
    await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
```

This removes the pre-read of the order's `status` (both RPCs now guard
and branch on the row's current state themselves) and the
`buildPaidUpdate` import.

- [ ] **Step 2: Simplify `vnpay-ipn`**

Replace the full body of `supabase/functions/vnpay-ipn/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2"
import { verifyVnpaySignature } from "../_shared/vnpay.ts"

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
    await serviceClient.rpc("confirm_order_payment", { p_order_id: orderId })
  } else {
    // Only a still-pre-kitchen order is cancellable -- cancel_pending_order
    // no-ops for a served Pay Later order whose deferred attempt failed,
    // which correctly just stays served/unpaid awaiting a retry.
    await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })
  }

  return ipnResponse("00", "Confirm Success")
})
```

The amount-check and already-paid early-return stay (they're
IPN-protocol-specific — VNPay expects a specific `RspCode` for each,
which the generic RPC has no way to communicate back); only the two
write branches now delegate to the RPCs, and the `status` column is no
longer selected since neither branch needs it directly anymore.

- [ ] **Step 3: Confirm nothing else imports the dead helper, then delete it**

```bash
grep -rn "buildPaidUpdate\|order-status" supabase/functions/ --include="*.ts"
```

Expected: no matches remain outside `_shared/order-status.ts` itself.

```bash
git rm supabase/functions/_shared/order-status.ts
```

- [ ] **Step 4: Update the CLAUDE.md gotcha this touches**

In `CLAUDE.md`, find the paragraph starting "**Order-status lifecycle
logic intentionally lives in two separate places**" and replace it with:

```markdown
- **Order-status lifecycle logic intentionally lives in two separate
  places**, not one: `hooks/useKitchenOrders.tsx`'s `NEXT_STATUS` map
  (staff-driven kitchen progression, paid→preparing→ready→served) and
  the `confirm_order_payment`/`cancel_pending_order` Postgres RPCs (the
  served-or-not branch and the pending-cancel guard, called uniformly by
  cash confirm, Stripe's webhook, and VNPay's IPN/return — migration
  `0056`, unifying what used to be three separately-reimplemented
  copies). Considered unifying *these two* during an architecture review
  (2026-07-12) and rejected it — they're triggered by different events
  (a staff tap vs. a gateway callback) and, before migration `0056`, lived
  in different runtimes with no shared-code bridge (`tsconfig.json`
  excludes `supabase/functions` entirely). Moving the payment-confirmation
  side into a Postgres RPC (reachable from both runtimes) resolved the
  actual duplication without touching `NEXT_STATUS` — don't re-propose
  merging `NEXT_STATUS` itself without a third concern showing up that
  actually needs the same table.
```

- [ ] **Step 5: Verify live via a manual smoke check**

No Deno test harness exists in this project. Using a Stripe/VNPay
sandbox test transaction (per this project's established
Edge-Function-verification convention):
- Place a Pay Now Stripe order, complete the sandbox checkout, confirm
  the order flips to `paid` and appears on the KDS board.
- Place a Pay Later order, mark it served, then pay via the customer's
  tracking page (VNPay sandbox), confirm `payment_status` flips to
  `paid` and the order auto-completes (`complete_order_when_served_and_paid`).
- Abandon a Stripe Checkout Session (let it expire, or use the
  `checkout.session.expired` test event) for a still-pending order,
  confirm it's cancelled.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/functions/vnpay-ipn/index.ts CLAUDE.md
git commit -m "refactor: route stripe-webhook/vnpay-ipn through confirm_order_payment/cancel_pending_order, delete dead buildPaidUpdate"
```

---

### Task 4: Extract the shared Order Line module

**Files:**
- Create: `lib/order-line.ts`
- Create: `lib/order-line.test.ts`

**Interfaces:**
- Produces: `buildOrderLineKey(input: OrderLineKeyInput): string`,
  `computeOrderTotals(subtotal: number, discount: number, taxRatePercent: number): OrderTotals`.
  Later tasks (Task 5, Task 6) import both.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/order-line.test.ts
import { describe, it, expect } from "vitest"
import { buildOrderLineKey, computeOrderTotals } from "./order-line"

describe("buildOrderLineKey", () => {
  it("produces the same key regardless of modifier order", () => {
    const a = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: ["mod-a", "mod-b"] })
    const b = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: ["mod-b", "mod-a"] })
    expect(a).toBe(b)
  })

  it("treats a missing size as distinct from any real size", () => {
    const noSize = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [] })
    const withSize = buildOrderLineKey({ menuItemId: "item-1", sizeId: "size-l", modifierIds: [] })
    expect(noSize).not.toBe(withSize)
  })

  it("treats two different notes as distinct lines", () => {
    const a = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "less sugar" })
    const b = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "extra ice" })
    expect(a).not.toBe(b)
  })

  it("treats an omitted note the same as an empty note", () => {
    const omitted = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [] })
    const empty = buildOrderLineKey({ menuItemId: "item-1", sizeId: null, modifierIds: [], note: "" })
    expect(omitted).toBe(empty)
  })
})

describe("computeOrderTotals", () => {
  it("computes tax on the post-discount amount, rounded", () => {
    const result = computeOrderTotals(100000, 10000, 8)
    expect(result).toEqual({ taxableAmount: 90000, tax: 7200, total: 97200 })
  })

  it("clamps taxable amount at zero when discount exceeds subtotal", () => {
    const result = computeOrderTotals(10000, 50000, 8)
    expect(result).toEqual({ taxableAmount: 0, tax: 0, total: 0 })
  })

  it("applies zero tax when the rate is zero", () => {
    const result = computeOrderTotals(50000, 0, 0)
    expect(result).toEqual({ taxableAmount: 50000, tax: 0, total: 50000 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/order-line.test.ts`
Expected: FAIL — `./order-line` doesn't exist yet.

- [ ] **Step 3: Write the module**

```ts
// lib/order-line.ts
export type OrderLineKeyInput = {
  menuItemId: string
  sizeId: string | null
  modifierIds: string[]
  note?: string | null
}

/** Identity key for merging two adds of the same item/size/extras/note into one line. */
export function buildOrderLineKey({ menuItemId, sizeId, modifierIds, note }: OrderLineKeyInput): string {
  const modifierKey = [...modifierIds].sort().join(",")
  return [menuItemId, sizeId ?? "no-size", modifierKey, note ?? ""].join("|")
}

export type OrderTotals = { taxableAmount: number; tax: number; total: number }

/** Tax is computed on the post-discount amount, rounded, and never goes negative. */
export function computeOrderTotals(subtotal: number, discount: number, taxRatePercent: number): OrderTotals {
  const taxableAmount = Math.max(subtotal - discount, 0)
  const tax = Math.round(taxableAmount * (taxRatePercent / 100))
  return { taxableAmount, tax, total: taxableAmount + tax }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/order-line.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/order-line.ts lib/order-line.test.ts
git commit -m "feat: extract shared order-line identity key and totals math"
```

---

### Task 5: Wire `useCart` to the shared line-key builder

**Files:**
- Modify: `hooks/useCart.tsx`

**Interfaces:**
- Consumes: `buildOrderLineKey` (Task 4).

- [ ] **Step 1: Replace the local key builder**

In `hooks/useCart.tsx`, add the import:

```ts
import { buildOrderLineKey } from "@/lib/order-line"
```

Replace:

```ts
function buildCartItemId(item: AddToCartInput): string {
  const modifierKey = item.modifiers
    .map((m) => m.optionId)
    .sort()
    .join(",")
  // Note is part of the identity key so two adds of the same drink with
  // different notes (e.g. "less sugar" vs "extra ice") stay separate lines
  // instead of silently merging and dropping one note.
  return [item.menuItemId, item.size?.id ?? "no-size", modifierKey, item.note ?? ""].join("|")
}
```

with:

```ts
function buildCartItemId(item: AddToCartInput): string {
  return buildOrderLineKey({
    menuItemId: item.menuItemId,
    sizeId: item.size?.id ?? null,
    modifierIds: item.modifiers.map((m) => m.optionId),
    note: item.note,
  })
}
```

Behavior is identical to before (same key shape) — this is a pure
delegation to the now-shared implementation.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no existing test targets `buildCartItemId`
directly — its behavior is now covered by `lib/order-line.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add hooks/useCart.tsx
git commit -m "refactor: useCart delegates line-key building to lib/order-line"
```

---

### Task 6: Wire POS and Checkout to the shared modules

**Files:**
- Modify: `components/staff/pos-terminal.tsx`
- Modify: `components/customer/checkout-view.tsx`

**Interfaces:**
- Consumes: `buildOrderLineKey`, `computeOrderTotals` (Task 4).

- [ ] **Step 1: Replace POS's local merge-key function and totals math**

In `components/staff/pos-terminal.tsx`, add the import:

```ts
import { buildOrderLineKey, computeOrderTotals } from "@/lib/order-line"
```

Remove the local function:

```ts
function lineMergeKey(menuItemId: string, sizeId: string | null, modifierIds: string[]): string {
  return `${menuItemId}|${sizeId ?? ""}|${[...modifierIds].sort().join(",")}`
}
```

Replace its one call site inside `addLine`:

```ts
function addLine(item: MenuItem, selection: PosPickerSelection) {
  const key = lineMergeKey(item.id, selection.sizeId, selection.modifierIds)
  setOrder((prev) => {
    const existing = prev.find(
      (line) => lineMergeKey(line.menuItemId, line.sizeId, line.modifierIds) === key
    )
```

with:

```ts
function addLine(item: MenuItem, selection: PosPickerSelection) {
  const key = buildOrderLineKey({ menuItemId: item.id, sizeId: selection.sizeId, modifierIds: selection.modifierIds })
  setOrder((prev) => {
    const existing = prev.find(
      (line) => buildOrderLineKey({ menuItemId: line.menuItemId, sizeId: line.sizeId, modifierIds: line.modifierIds }) === key
    )
```

Replace the totals math:

```ts
const subtotal = order.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
const tax = Math.round(subtotal * (taxRatePercent / 100))
const total = subtotal + tax
```

with:

```ts
const subtotal = order.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
const { tax, total } = computeOrderTotals(subtotal, 0, taxRatePercent)
```

(POS has no discounts, so `discount` is always `0` here.)

- [ ] **Step 2: Replace Checkout's totals math**

In `components/customer/checkout-view.tsx`, add the import:

```ts
import { computeOrderTotals } from "@/lib/order-line"
```

Replace:

```ts
const discount = promoDiscount + loyaltyDiscount + redemptionDiscount
const taxableAmount = Math.max(subtotal - discount, 0)
const tax = Math.round(taxableAmount * (taxRatePercent / 100))
const total = taxableAmount + tax
```

with:

```ts
const discount = promoDiscount + loyaltyDiscount + redemptionDiscount
const { taxableAmount, tax, total } = computeOrderTotals(subtotal, discount, taxRatePercent)
```

Checkout keeps computing its own `discount` composition (promo + loyalty
+ redemptions is checkout-specific business logic, not general order-total
math) and only delegates the shared tax/total formula.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Verify live**

On `https://phadincoffee.vercel.app`: add the same item/size/extras combo
twice in POS and confirm it still merges to quantity 2; place a checkout
order with a promo code and a redemption applied together and confirm
the displayed tax/total match what `place_order` actually charges.

- [ ] **Step 6: Commit**

```bash
git add components/staff/pos-terminal.tsx components/customer/checkout-view.tsx
git commit -m "refactor: POS and Checkout delegate line-key/totals math to lib/order-line"
```

---

### Task 7: Extract Menu Item form validation

**Files:**
- Create: `lib/validate-menu-item-form.ts`
- Create: `lib/validate-menu-item-form.test.ts`

**Interfaces:**
- Produces: `validateRecipeEntries`, `validateExtraFields`,
  `validateMenuItemForm`. Task 8 imports all three.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/validate-menu-item-form.test.ts
import { describe, it, expect } from "vitest"
import { validateRecipeEntries, validateExtraFields, validateMenuItemForm } from "./validate-menu-item-form"

describe("validateRecipeEntries", () => {
  it("returns the parsed entries when every quantity is a positive finite number", () => {
    const result = validateRecipeEntries({ "ing-1": 2, "ing-2": 0.5 })
    expect(result).toEqual([
      { ingredientId: "ing-1", quantityUsed: 2 },
      { ingredientId: "ing-2", quantityUsed: 0.5 },
    ])
  })

  it("returns null when a quantity is zero or negative", () => {
    expect(validateRecipeEntries({ "ing-1": 0 })).toBeNull()
    expect(validateRecipeEntries({ "ing-1": -1 })).toBeNull()
  })

  it("returns null when a quantity is not finite", () => {
    expect(validateRecipeEntries({ "ing-1": NaN })).toBeNull()
  })

  it("returns an empty array for an empty recipe", () => {
    expect(validateRecipeEntries({})).toEqual([])
  })
})

describe("validateExtraFields", () => {
  it("returns the parsed price when both names are present and price is non-negative", () => {
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "5000")).toEqual({ priceDelta: 5000 })
  })

  it("returns null when either name is blank", () => {
    expect(validateExtraFields("", "Extra Milk", "5000")).toBeNull()
    expect(validateExtraFields("Sữa thêm", "  ", "5000")).toBeNull()
  })

  it("returns null when price is negative or not a number", () => {
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "-1")).toBeNull()
    expect(validateExtraFields("Sữa thêm", "Extra Milk", "abc")).toBeNull()
  })
})

describe("validateMenuItemForm", () => {
  const validDraft = {
    nameVi: "Cà Phê Đen",
    nameEn: "Black Coffee",
    categoryId: "cat-1",
    price: "29000",
    recipe: { "ing-1": 1 },
    sizes: [{ name: "L", price: "5000" }],
  }

  it("returns the parsed value when everything is valid", () => {
    const result = validateMenuItemForm(validDraft)
    expect(result).toEqual({
      ok: true,
      value: {
        basePrice: 29000,
        recipeEntries: [{ ingredientId: "ing-1", quantityUsed: 1 }],
        sizes: [{ name: "L", priceDelta: 5000 }],
      },
    })
  })

  it("rejects a blank name, missing category, or non-positive price", () => {
    expect(validateMenuItemForm({ ...validDraft, nameVi: "" })).toEqual({ ok: false, error: "required_fields" })
    expect(validateMenuItemForm({ ...validDraft, categoryId: "" })).toEqual({ ok: false, error: "required_fields" })
    expect(validateMenuItemForm({ ...validDraft, price: "0" })).toEqual({ ok: false, error: "required_fields" })
  })

  it("rejects a non-positive recipe quantity", () => {
    expect(validateMenuItemForm({ ...validDraft, recipe: { "ing-1": 0 } })).toEqual({
      ok: false,
      error: "recipe_quantity_required",
    })
  })

  it("rejects a blank size name", () => {
    expect(validateMenuItemForm({ ...validDraft, sizes: [{ name: "  ", price: "5000" }] })).toEqual({
      ok: false,
      error: "size_required_fields",
    })
  })

  it("rejects a negative size price", () => {
    expect(validateMenuItemForm({ ...validDraft, sizes: [{ name: "L", price: "-1" }] })).toEqual({
      ok: false,
      error: "size_required_fields",
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/validate-menu-item-form.test.ts`
Expected: FAIL — `./validate-menu-item-form` doesn't exist yet.

- [ ] **Step 3: Write the module**

```ts
// lib/validate-menu-item-form.ts
export type RecipeEntry = { ingredientId: string; quantityUsed: number }

/** Shared by the item's own recipe and an extra's recipe -- both need "every quantity is a positive finite number." */
export function validateRecipeEntries(recipe: Record<string, number>): RecipeEntry[] | null {
  const entries = Object.entries(recipe).map(([ingredientId, quantityUsed]) => ({ ingredientId, quantityUsed }))
  if (entries.some((e) => !Number.isFinite(e.quantityUsed) || e.quantityUsed <= 0)) return null
  return entries
}

/** Shared by add-extra and edit-extra -- both need "both names present, price a non-negative number." */
export function validateExtraFields(nameVi: string, nameEn: string, price: string): { priceDelta: number } | null {
  const priceDelta = Number(price)
  if (!nameVi.trim() || !nameEn.trim() || !Number.isFinite(priceDelta) || priceDelta < 0) return null
  return { priceDelta }
}

export type MenuItemFormDraft = {
  nameVi: string
  nameEn: string
  categoryId: string
  price: string
  recipe: Record<string, number>
  sizes: { name: string; price: string }[]
}

export type MenuItemFormError = "required_fields" | "recipe_quantity_required" | "size_required_fields"

export type MenuItemFormValidated = {
  basePrice: number
  recipeEntries: RecipeEntry[]
  sizes: { name: string; priceDelta: number }[]
}

export function validateMenuItemForm(
  draft: MenuItemFormDraft
): { ok: true; value: MenuItemFormValidated } | { ok: false; error: MenuItemFormError } {
  const basePrice = Number(draft.price)
  if (!draft.nameVi.trim() || !draft.nameEn.trim() || !draft.categoryId || !Number.isFinite(basePrice) || basePrice <= 0) {
    return { ok: false, error: "required_fields" }
  }

  const recipeEntries = validateRecipeEntries(draft.recipe)
  if (!recipeEntries) {
    return { ok: false, error: "recipe_quantity_required" }
  }

  if (draft.sizes.some((s) => !s.name.trim())) {
    return { ok: false, error: "size_required_fields" }
  }
  const sizes = draft.sizes.map((s) => ({ name: s.name.trim(), priceDelta: Number(s.price) }))
  if (sizes.some((s) => !Number.isFinite(s.priceDelta) || s.priceDelta < 0)) {
    return { ok: false, error: "size_required_fields" }
  }

  return { ok: true, value: { basePrice, recipeEntries, sizes } }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/validate-menu-item-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validate-menu-item-form.ts lib/validate-menu-item-form.test.ts
git commit -m "feat: extract menu item form validation as pure, unit-testable functions"
```

---

### Task 8: Wire the Menu Item form to the shared validators

**Files:**
- Modify: `components/admin/menu-item-form.tsx`

**Interfaces:**
- Consumes: `validateMenuItemForm`, `validateExtraFields`,
  `validateRecipeEntries` (Task 7).

- [ ] **Step 1: Add the import**

```ts
import { validateMenuItemForm, validateExtraFields, validateRecipeEntries } from "@/lib/validate-menu-item-form"
```

- [ ] **Step 2: Replace `handleSave`'s inline validation chain**

Replace:

```ts
  async function handleSave() {
    const parsedPrice = Number(price)
    if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError(t("requiredFieldsError"))
      return
    }

    const recipeEntries: RecipeEntry[] = Object.entries(selectedRecipe).map(([ingredientId, quantityUsed]) => ({
      ingredientId,
      quantityUsed,
    }))
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setRecipeError(t("recipeQuantityRequiredError"))
      return
    }
    setRecipeError(null)

    if (sizes.some((s) => !s.name.trim())) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    const parsedSizes: MenuItemSizeInput[] = sizes.map((s) => ({ name: s.name.trim(), priceDelta: Number(s.price) }))
    if (parsedSizes.some((s) => !Number.isFinite(s.priceDelta) || s.priceDelta < 0)) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    setSizesError(null)
```

with:

```ts
  async function handleSave() {
    const validated = validateMenuItemForm({
      nameVi,
      nameEn,
      categoryId,
      price,
      recipe: selectedRecipe,
      sizes,
    })
    if (!validated.ok) {
      if (validated.error === "required_fields") setError(t("requiredFieldsError"))
      if (validated.error === "recipe_quantity_required") setRecipeError(t("recipeQuantityRequiredError"))
      if (validated.error === "size_required_fields") setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    setError(null)
    setRecipeError(null)
    setSizesError(null)
    const { basePrice: parsedPrice, recipeEntries, sizes: parsedSizes } = validated.value
```

(The rest of `handleSave` — image upload and the `onSave(...)` call —
stays unchanged; it already reads `parsedPrice`/`recipeEntries`/
`parsedSizes`, which now come from `validated.value` instead of being
computed inline.)

- [ ] **Step 3: Replace `handleAddExtra`'s validation**

Replace:

```ts
  async function handleAddExtra() {
    const parsedPrice = Number(newExtraPrice)
    if (!newExtraNameVi.trim() || !newExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setExtrasError(t("extraRequiredFieldsError"))
      return
    }
    setExtrasError(null)
    try {
      const created = await createModifierGroup(supabase, {
        nameVi: newExtraNameVi.trim(),
        nameEn: newExtraNameEn.trim(),
        priceDelta: parsedPrice,
      })
```

with:

```ts
  async function handleAddExtra() {
    const validated = validateExtraFields(newExtraNameVi, newExtraNameEn, newExtraPrice)
    if (!validated) {
      setExtrasError(t("extraRequiredFieldsError"))
      return
    }
    setExtrasError(null)
    try {
      const created = await createModifierGroup(supabase, {
        nameVi: newExtraNameVi.trim(),
        nameEn: newExtraNameEn.trim(),
        priceDelta: validated.priceDelta,
      })
```

- [ ] **Step 4: Replace `handleSaveExtraEdit`'s validation**

Replace:

```ts
  async function handleSaveExtraEdit(group: MenuModifierGroup) {
    const parsedPrice = Number(editExtraPrice)
    if (!editExtraNameVi.trim() || !editExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setEditExtraError(t("extraRequiredFieldsError"))
      return
    }
    const recipeEntries = Object.entries(editExtraRecipe).map(([ingredientId, quantityUsed]) => ({
      ingredientId,
      quantityUsed,
    }))
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setEditExtraError(t("recipeQuantityRequiredError"))
      return
    }
    setEditExtraError(null)
    setIsSavingExtra(true)
    try {
      const updated = await updateModifierGroup(supabase, group.id, {
        nameVi: editExtraNameVi.trim(),
        nameEn: editExtraNameEn.trim(),
        priceDelta: parsedPrice,
      })
```

with:

```ts
  async function handleSaveExtraEdit(group: MenuModifierGroup) {
    const validated = validateExtraFields(editExtraNameVi, editExtraNameEn, editExtraPrice)
    if (!validated) {
      setEditExtraError(t("extraRequiredFieldsError"))
      return
    }
    const recipeEntries = validateRecipeEntries(editExtraRecipe)
    if (!recipeEntries) {
      setEditExtraError(t("recipeQuantityRequiredError"))
      return
    }
    setEditExtraError(null)
    setIsSavingExtra(true)
    try {
      const updated = await updateModifierGroup(supabase, group.id, {
        nameVi: editExtraNameVi.trim(),
        nameEn: editExtraNameEn.trim(),
        priceDelta: validated.priceDelta,
      })
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `RecipeEntry`'s import from `menu-data` becomes
unused, remove it from the import list at the top of the file.)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Verify live**

On `https://phadincoffee.vercel.app`'s `/admin/menu`: try saving an item
with a blank size name (confirm the error still shows), add a new extra
with a negative price (confirm rejected), edit an existing extra's
recipe with a zero quantity (confirm rejected), then successfully save a
valid edit end-to-end.

- [ ] **Step 8: Commit**

```bash
git add components/admin/menu-item-form.tsx
git commit -m "refactor: menu-item-form delegates validation to lib/validate-menu-item-form"
```

---

### Task 9: Extract a shared Pagination component

**Files:**
- Create: `components/admin/pagination.tsx`
- Modify: `components/admin/menu-management.tsx`

**Interfaces:**
- Produces: `<Pagination currentPage totalPages rangeStart rangeEnd totalCount onPageChange />`.

- [ ] **Step 1: Write the component**

```tsx
// components/admin/pagination.tsx
"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

type PaginationProps = {
  currentPage: number
  totalPages: number
  rangeStart: number
  rangeEnd: number
  totalCount: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, rangeStart, rangeEnd, totalCount, onPageChange }: PaginationProps) {
  const t = useTranslations("AdminMenu")

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {t("showingItems", { start: rangeStart, end: rangeEnd, total: totalCount })}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {t("previous")}
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={cn(
              "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
              page === currentPage ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
            )}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {t("next")}
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Replace the mobile pagination block in `menu-management.tsx`**

Add the import:

```ts
import { Pagination } from "@/components/admin/pagination"
```

Replace:

```tsx
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {t("showingItems", {
              start: visibleItems.length === 0 ? 0 : pageStart + 1,
              end: Math.min(pageStart + PAGE_SIZE, visibleItems.length),
              total: visibleItems.length,
            })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("previous")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
                  page === currentPage
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground"
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
```

with:

```tsx
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            rangeStart={visibleItems.length === 0 ? 0 : pageStart + 1}
            rangeEnd={Math.min(pageStart + PAGE_SIZE, visibleItems.length)}
            totalCount={visibleItems.length}
            onPageChange={setCurrentPage}
          />
        </div>
```

- [ ] **Step 3: Replace the desktop pagination block**

Replace the second, near-identical block (inside
`<div className="flex flex-col items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 sm:flex-row">`)
the same way — same `<Pagination .../>` props, kept inside its own
(differently-styled, `sm:flex-row`) wrapper div.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Verify live**

On `https://phadincoffee.vercel.app`'s `/admin/menu`, at both a phone
width and a desktop width: confirm page navigation (prev/next/page
number taps) still works identically on both the mobile card list and
the desktop table.

- [ ] **Step 7: Commit**

```bash
git add components/admin/pagination.tsx components/admin/menu-management.tsx
git commit -m "refactor: extract shared Pagination component, remove duplicated mobile/desktop pagination JSX"
```

---

### Task 10: Route Admin's shift-closing through the `useShift` hook

**Files:**
- Modify: `hooks/useShift.tsx`
- Modify: `components/admin/shift-closing.tsx`

**Interfaces:**
- Produces (change): `useShift()`'s `openShift`/`closeShift` now return
  `Promise<ShiftReport>` instead of `Promise<void>` (they already compute
  the result internally — this just returns it to the caller too,
  instead of discarding it after `setReport`).

- [ ] **Step 1: Make `useShift`'s open/close methods return their result**

In `hooks/useShift.tsx`, update the type:

```ts
type ShiftContextValue = {
  supabase: ReturnType<typeof createClient>
  report: ShiftReport | null
  isLoading: boolean
  isShiftOpen: boolean
  currentUserId: string | null
  isCurrentUserWorking: boolean
  refetch: () => void
  openShift: (startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) => Promise<ShiftReport>
  closeShift: (countedCash: number, notes?: string) => Promise<ShiftReport>
  joinShift: () => Promise<void>
  leaveShift: () => Promise<void>
}
```

Replace:

```ts
  async function openShift(startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) {
    const result = await openShiftQuery(supabase, startingCash, plannedStartAt, plannedEndAt)
    setReport(result)
  }

  async function closeShift(countedCash: number, notes?: string) {
    const result = await closeShiftQuery(supabase, countedCash, notes)
    setReport(result)
  }
```

with:

```ts
  async function openShift(startingCash: number, plannedStartAt?: number | null, plannedEndAt?: number | null) {
    const result = await openShiftQuery(supabase, startingCash, plannedStartAt, plannedEndAt)
    setReport(result)
    return result
  }

  async function closeShift(countedCash: number, notes?: string) {
    const result = await closeShiftQuery(supabase, countedCash, notes)
    setReport(result)
    return result
  }
```

`components/staff/shift-controls-dialog.tsx` (the other consumer) awaits
these without using the return value, so it needs no changes — a
`Promise<ShiftReport>` is still perfectly awaitable where a
`Promise<void>` was before.

- [ ] **Step 2: Route `shift-closing.tsx` through the hook**

In `components/admin/shift-closing.tsx`, replace the imports:

```ts
import { useShift } from "@/hooks/useShift"
import {
  openShift,
  closeShift,
  getShiftReport,
  getShiftHistory,
  type ShiftReport,
  type ShiftHistoryEntry,
} from "@/lib/supabase/shift-data"
```

with:

```ts
import { useShift } from "@/hooks/useShift"
import { getShiftReport, getShiftHistory, type ShiftReport, type ShiftHistoryEntry } from "@/lib/supabase/shift-data"
```

Replace the destructure:

```ts
  const { supabase, report, isLoading, refetch } = useShift()
```

with:

```ts
  const { supabase, report, isLoading, openShift, closeShift } = useShift()
```

Replace `handleOpen`:

```ts
  async function handleOpen() {
    const amount = Number(startingCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await openShift(
        supabase,
        Math.round(amount),
        plannedStartInput ? new Date(plannedStartInput).getTime() : null,
        plannedEndInput ? new Date(plannedEndInput).getTime() : null
      )
      setStartingCashInput("")
      setPlannedStartInput("")
      setPlannedEndInput("")
      setClosedSummary(null)
      refetch()
    } catch {
      setError(t("openError"))
    } finally {
      setIsSubmitting(false)
    }
  }
```

with:

```ts
  async function handleOpen() {
    const amount = Number(startingCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await openShift(
        Math.round(amount),
        plannedStartInput ? new Date(plannedStartInput).getTime() : null,
        plannedEndInput ? new Date(plannedEndInput).getTime() : null
      )
      setStartingCashInput("")
      setPlannedStartInput("")
      setPlannedEndInput("")
      setClosedSummary(null)
    } catch {
      setError(t("openError"))
    } finally {
      setIsSubmitting(false)
    }
  }
```

Replace `handleClose`:

```ts
  async function handleClose() {
    const amount = Number(countedCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      const summary = await closeShift(supabase, Math.round(amount), notesInput.trim() || undefined)
      setClosedSummary(summary)
      setCountedCashInput("")
      setNotesInput("")
      setHistory(null)
      refetch()
    } catch {
      setError(t("closeError"))
    } finally {
      setIsSubmitting(false)
    }
  }
```

with:

```ts
  async function handleClose() {
    const amount = Number(countedCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      const summary = await closeShift(Math.round(amount), notesInput.trim() || undefined)
      setClosedSummary(summary)
      setCountedCashInput("")
      setNotesInput("")
      setHistory(null)
    } catch {
      setError(t("closeError"))
    } finally {
      setIsSubmitting(false)
    }
  }
```

`supabase` (still destructured from `useShift()`) stays in use by
`handleSelectShift`'s `getShiftReport(supabase, id)` call and the
history-tab `getShiftHistory(supabase)` effect — those are read-only
lookups outside the hook's own state, unaffected by this change.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass. (No dedicated `useShift`/`shift-closing` test
exists in this codebase today — Context-based hooks here are verified
live, matching this project's established convention; this task doesn't
introduce new test infrastructure to cover the gap on its own.)

- [ ] **Step 5: Verify live**

On `https://phadincoffee.vercel.app`'s `/admin/shift`: open a shift with
a starting cash amount, confirm it appears immediately (no need to
navigate away and back); close it with a counted amount, confirm the
"just closed" summary with its full per-method breakdown still displays
correctly (this is the one behavior this task's refactor could plausibly
regress); switch to the History tab and confirm the just-closed shift
appears there too.

- [ ] **Step 6: Commit**

```bash
git add hooks/useShift.tsx components/admin/shift-closing.tsx
git commit -m "fix: route admin shift-closing through useShift hook instead of bypassing it"
```

---

### Task 11: Share the VNPay gateway-redirect glue

**Files:**
- Modify: `supabase/functions/_shared/vnpay.ts`
- Modify: `supabase/functions/place-order/index.ts`
- Modify: `supabase/functions/pay-order/index.ts`

**Interfaces:**
- Produces: `extractClientIp(req: Request): string`,
  `buildVnpayReturnUrl(orderId: string, locale: string): string` in
  `_shared/vnpay.ts`.

- [ ] **Step 1: Add the two shared helpers**

In `supabase/functions/_shared/vnpay.ts`, add (near the top, after the
existing `vnpayEncode` export):

```ts
/** The caller's real IP for VNPay's vnp_IpAddr field -- the same one-liner was previously copy-pasted into both place-order and pay-order. */
export function extractClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
}

/** VNPay always redirects here after a checkout attempt, regardless of whether it was built by place-order or pay-order. */
export function buildVnpayReturnUrl(orderId: string, locale: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?orderId=${orderId}&locale=${locale}`
}
```

- [ ] **Step 2: Use them in `place-order`**

In `supabase/functions/place-order/index.ts`, update the import:

```ts
import { buildVnpayCheckoutUrl, buildVnpayReturnUrl, extractClientIp } from "../_shared/vnpay.ts"
```

Replace:

```ts
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
```

with:

```ts
    if (needsVnpayUrl) {
      const checkoutUrl = await buildVnpayCheckoutUrl({
        orderId: data.orderId,
        total: data.total,
        ipAddr: extractClientIp(req),
        locale,
        returnUrl: buildVnpayReturnUrl(data.orderId, locale),
      })
```

- [ ] **Step 3: Use them in `pay-order`**

In `supabase/functions/pay-order/index.ts`, update the import:

```ts
import { buildVnpayCheckoutUrl, buildVnpayReturnUrl, extractClientIp } from "../_shared/vnpay.ts"
```

Replace:

```ts
    const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
    const returnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?orderId=${order.id}&locale=${locale}`
    const checkoutUrl = await buildVnpayCheckoutUrl({
      orderId: order.id,
      total: order.total,
      ipAddr,
      locale,
      returnUrl,
    })
```

with:

```ts
    const checkoutUrl = await buildVnpayCheckoutUrl({
      orderId: order.id,
      total: order.total,
      ipAddr: extractClientIp(req),
      locale,
      returnUrl: buildVnpayReturnUrl(order.id, locale),
    })
```

- [ ] **Step 4: Verify live via a manual smoke check**

No Deno test harness exists in this project. Place a Pay Now VNPay
order (via `place-order`) and separately pay an existing Pay Later
order via VNPay (via `pay-order`); confirm both redirect to VNPay's
sandbox correctly and both return correctly afterward.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/vnpay.ts supabase/functions/place-order/index.ts supabase/functions/pay-order/index.ts
git commit -m "refactor: share VNPay return-URL/IP-extraction glue between place-order and pay-order"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every new test file added in this
plan (`lib/order-line.test.ts`, `lib/validate-menu-item-form.test.ts`,
the updated `lib/supabase/orders-data.test.ts`) and
`lib/i18n-coverage.test.ts`.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 3: Push and verify live on Vercel**

Push the branch/commits so Vercel auto-deploys, then manually re-check
each of the live-verification steps from Tasks 3, 6, 8, 9, 10, and 11
above in one pass against `https://phadincoffee.vercel.app`, plus:

- KDS: confirm a served pickup order's cash payment via "Confirm Cash
  Received" and confirm a pre-kitchen paid order's cash payment via the
  same button — both should transition correctly (this is the race Task
  1/2 closed; there is no way to force the old race directly, so this is
  a regression check on the two branches the RPC now handles internally).
- Admin `/admin/shift`: full open → close → History tab round trip.
- Admin `/admin/menu`: add an item with sizes and one existing extra
  attached, edit it, delete it; page through a category with more than 5
  items on both mobile and desktop widths.
- Checkout: place one order with a promo code, loyalty redemption, and a
  reward redemption all applied together; confirm the displayed total
  matches what actually gets charged.
- POS: charge an order with a multi-modifier item added twice (confirm
  it merges to quantity 2) and confirm the tax/total shown match the
  created order.

- [ ] **Step 4: Commit any final fixups**

If manual verification surfaces an issue, fix it, re-run Steps 1–2, and
commit:

```bash
git add -A
git commit -m "fix: address issues found in live verification"
```

(Skip this step if no issues were found.)
