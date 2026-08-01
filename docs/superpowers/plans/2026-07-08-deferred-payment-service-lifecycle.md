# Deferred Payment + Table-Driven Service Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pay Now / Pay Later checkout choice (all 3 payment methods, both order types) and a new `served` order status, wired so an order auto-completes the instant it's both served and paid — reusing the table-driven Tables column from the table-status feature for dine-in, and the existing Ready-column tap + pending-cash banner for pickup.

**Architecture:** One migration adds the `served` enum value, an auto-completion trigger, and extends `place_order`/`get_order_for_tracking`. The `place-order` Edge Function gains a `payAt` branch; a new `pay-order` Edge Function lets a customer trigger deferred Stripe/VNPay payment later from their tracking page. `stripe-webhook`/`vnpay-ipn` are corrected to stop assuming every successful/failed payment belongs to a pre-kitchen `pending_payment` order. The KDS Tables column becomes the dine-in "Served → Awaiting Payment" control surface; pickup reuses the existing Ready-column tap and pending-cash banner, both already generic enough to need no visual changes — just query/logic extensions underneath.

**Tech Stack:** Next.js/TypeScript, Supabase Postgres (migration via MCP `apply_migration`), Supabase Edge Functions (Deno, raw `fetch`/Web Crypto, no SDKs — matches this project's existing functions), Vitest for `lib/supabase/*.ts`, next-intl for `en`/`vi` copy.

## Global Constraints

- Every new/changed translation key goes into **both** `messages/en.json` and `messages/vi.json` in the same task that introduces it.
- Query-layer functions in `lib/supabase/*.ts` take `SupabaseClient` as their first argument (DI'd, testable with a mocked client) — follow the existing pattern already in `orders-data.ts`.
- Edge Functions in this project use raw `fetch`/Web Crypto, no SDK, and duplicate small helpers (e.g. `vnpayEncode`) across function directories rather than sharing code — an established, deliberate convention (confirmed: `vnpayEncode` already exists separately in `place-order`, `vnpay-ipn`, and `vnpay-return`). Follow it for the new `pay-order` function rather than introducing a shared-imports pattern.
- Migrations apply live via the Supabase MCP `apply_migration` tool (project `qhiypdqnrnzndxdwqxbx`), verified afterward via `execute_sql`.
- Commit directly to `main` after each task (no feature branch), matching this project's established convention for this session.
- Verification is against the deployed Vercel URL, not `npm run dev` — local `build`/`tsc`/`vitest` are for fast feedback only.
- Do not modify `sync_table_occupancy` (migration `0021`) — the new auto-completion trigger is designed specifically so that trigger needs zero changes.

---

### Task 1: Migration — `served` status, auto-completion trigger, `payAt`

**Files:**
- Create: `supabase/migrations/0022_deferred_payment_service_lifecycle.sql`

**Interfaces:**
- Produces: `order_status` enum gains `'served'` (after `'ready'`); trigger `on_order_served_and_paid` on `public.orders`; `place_order(p_payload jsonb)` accepts an optional `payAt` field (`"now"` default, `"later"`); `get_order_for_tracking(p_order_id uuid)`'s returned JSON gains `paymentStatus`/`paymentMethod`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0022_deferred_payment_service_lifecycle.sql
-- Adds a 'served' order_status (between ready and completed), an
-- auto-completion trigger that promotes an order to completed the
-- instant it's both served and paid (regardless of which becomes true
-- first), and a payAt ("now"/"later") choice in place_order so a Pay
-- Later order skips the pre-kitchen payment gate entirely. See
-- docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md.
--
-- The existing sync_table_occupancy trigger (migration 0021) is NOT
-- modified -- it already fires on any order reaching 'completed' and
-- moves the table to 'cleaning'; this migration's new trigger is what
-- gets an order to 'completed' via a second path (served-then-paid, not
-- just paid-then-served-then-tapped-complete).

alter type public.order_status add value 'served' after 'ready';

create or replace function public.complete_order_when_served_and_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'served' and new.payment_status = 'paid' and old.status is distinct from 'completed' then
    new.status := 'completed';
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_served_and_paid on public.orders;
create trigger on_order_served_and_paid
  before update on public.orders
  for each row
  execute function public.complete_order_when_served_and_paid();

create or replace function public.place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_type order_type := (p_payload->>'orderType')::order_type;
  v_table_id uuid := (p_payload->>'tableId')::uuid;
  v_payment_method payment_method := (p_payload->>'paymentMethod')::payment_method;
  v_promo_code text := upper(trim(coalesce(p_payload->>'promoCode', '')));
  v_redeem_points integer := coalesce((p_payload->>'redeemLoyaltyPoints')::integer, 0);
  v_payment_collected boolean := coalesce((p_payload->>'paymentCollected')::boolean, false);
  v_pay_at text := coalesce(p_payload->>'payAt', 'now');
  v_initial_status order_status;
  v_pickup_time timestamptz;
  v_item jsonb;
  v_line record;
  v_menu_item record;
  v_size_delta integer;
  v_modifier_delta integer;
  v_unit_price integer;
  v_line_subtotal integer;
  v_subtotal integer := 0;
  v_promo_discount integer := 0;
  v_loyalty_discount integer := 0;
  v_redeem_value integer;
  v_balance integer;
  v_order_id uuid;
  v_order_item_id uuid;
  v_modifier_id uuid;
begin
  v_pickup_time := case p_payload->>'pickupTime'
    when '15' then now() + interval '15 minutes'
    when '30' then now() + interval '30 minutes'
    else null
  end;

  v_initial_status := (case when v_pay_at = 'later' then 'paid' else 'pending_payment' end)::order_status;

  if v_redeem_points > 0 then
    if v_customer_id is null then
      raise exception 'guests cannot redeem loyalty points';
    end if;
    select loyalty_points_balance into v_balance from public.profiles where id = v_customer_id;
    if v_balance is null or v_redeem_points > v_balance then
      raise exception 'insufficient loyalty points balance';
    end if;
  end if;

  create temporary table _place_order_lines (
    menu_item_id uuid, size_id uuid, quantity integer, note text,
    unit_price integer, line_subtotal integer, modifier_ids uuid[], modifier_deltas integer[]
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(p_payload->'items')
  loop
    select id, base_price, is_available into v_menu_item
      from public.menu_items where id = (v_item->>'menuItemId')::uuid;
    if v_menu_item.id is null then
      raise exception 'menu item % not found', v_item->>'menuItemId';
    end if;
    if not v_menu_item.is_available then
      raise exception 'menu item % is not available', v_item->>'menuItemId';
    end if;

    v_size_delta := 0;
    if (v_item->>'sizeId') is not null then
      select price_delta into v_size_delta from public.menu_item_sizes where id = (v_item->>'sizeId')::uuid;
      if v_size_delta is null then
        raise exception 'size % not found', v_item->>'sizeId';
      end if;
    end if;

    v_modifier_delta := 0;
    if jsonb_array_length(coalesce(v_item->'modifierIds', '[]'::jsonb)) > 0 then
      select coalesce(sum(price_delta), 0) into v_modifier_delta
        from public.modifiers
        where id in (select jsonb_array_elements_text(v_item->'modifierIds')::uuid);
    end if;

    v_unit_price := v_menu_item.base_price + v_size_delta + v_modifier_delta;
    v_line_subtotal := v_unit_price * (v_item->>'quantity')::integer;
    v_subtotal := v_subtotal + v_line_subtotal;

    insert into _place_order_lines (menu_item_id, size_id, quantity, note, unit_price, line_subtotal, modifier_ids)
    values (
      v_menu_item.id,
      (v_item->>'sizeId')::uuid,
      (v_item->>'quantity')::integer,
      v_item->>'note',
      v_unit_price,
      v_line_subtotal,
      case when jsonb_array_length(coalesce(v_item->'modifierIds', '[]'::jsonb)) > 0
        then (select array_agg((x)::uuid) from jsonb_array_elements_text(v_item->'modifierIds') x)
        else array[]::uuid[]
      end
    );
  end loop;

  if v_promo_code = 'WELCOME10' then
    v_promo_discount := round(v_subtotal * 0.1);
  end if;

  if v_redeem_points > 0 then
    select redeem_value_vnd_per_point into v_redeem_value from public.loyalty_settings where id = 1;
    v_loyalty_discount := v_redeem_points * v_redeem_value;
  end if;

  insert into public.orders (
    customer_id, order_type, table_id, status, payment_method, payment_status,
    subtotal, discount_amount, total, pickup_time
  ) values (
    v_customer_id, v_order_type, v_table_id, v_initial_status, v_payment_method, 'pending',
    v_subtotal, v_promo_discount + v_loyalty_discount,
    greatest(v_subtotal - v_promo_discount - v_loyalty_discount, 0),
    v_pickup_time
  ) returning id into v_order_id;

  for v_line in select * from _place_order_lines
  loop
    insert into public.order_items (order_id, menu_item_id, size_id, quantity, unit_price, subtotal, note)
    values (v_order_id, v_line.menu_item_id, v_line.size_id, v_line.quantity, v_line.unit_price, v_line.line_subtotal, v_line.note)
    returning id into v_order_item_id;

    if v_line.modifier_ids is not null and array_length(v_line.modifier_ids, 1) > 0 then
      foreach v_modifier_id in array v_line.modifier_ids
      loop
        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta)
        select v_order_item_id, v_modifier_id, price_delta from public.modifiers where id = v_modifier_id;
      end loop;
    end if;
  end loop;

  if v_redeem_points > 0 then
    insert into public.loyalty_transactions (customer_id, order_id, points_change, type)
    values (v_customer_id, v_order_id, -v_redeem_points, 'redeem');
    update public.profiles set loyalty_points_balance = loyalty_points_balance - v_redeem_points
      where id = v_customer_id;
  end if;

  if v_payment_collected then
    update public.orders set status = 'paid', payment_status = 'paid' where id = v_order_id;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'total', greatest(v_subtotal - v_promo_discount - v_loyalty_discount, 0));
end;
$$;

create or replace function public.get_order_for_tracking(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', o.id,
    'createdAt', extract(epoch from o.created_at) * 1000,
    'orderType', o.order_type,
    'table', t.table_number,
    'status', o.status,
    'paymentStatus', o.payment_status,
    'paymentMethod', o.payment_method,
    'subtotal', o.subtotal,
    'discount', o.discount_amount,
    'total', o.total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nameVi', mi.name_vi, 'nameEn', mi.name_en,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'note', oi.note
      ))
      from public.order_items oi
      join public.menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.orders o
  left join public.tables t on t.id = o.table_id
  where o.id = p_order_id
    and (
      o.customer_id = auth.uid()
      or o.customer_id is null
      or public.current_user_role() in ('staff', 'manager', 'admin')
    );

  return v_result;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `deferred_payment_service_lifecycle` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select unnest(enum_range(null::order_status));
```
Expected: includes `served` between `ready` and `completed`.

```sql
select proname from pg_proc where proname = 'complete_order_when_served_and_paid';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0022_deferred_payment_service_lifecycle.sql
git commit -m "Add served order status, auto-completion trigger, and payAt to place_order/get_order_for_tracking"
```

---

### Task 2: Query layer — `orders-data.ts`

**Files:**
- Modify: `lib/supabase/orders-data.ts`
- Modify: `lib/supabase/orders-data.test.ts`

**Interfaces:**
- Consumes: migration from Task 1.
- Produces: `RealOrderStatus` includes `"served"`; `OrderForTracking` gains `paymentStatus: string`, `paymentMethod: "stripe" | "cash" | "vnpay"`; `KdsOrderRow` gains `tableId?: string`, `paymentStatus: string`, `paymentMethod: "stripe" | "cash" | "vnpay"`; `getKitchenOrders` includes `served` orders; `getPendingPaymentOrders` includes served+cash+pending pickup orders; new `confirmServedCashPayment(supabase, orderId): Promise<void>`; new `payExistingOrder(supabase, orderId, locale): Promise<{ checkoutUrl: string }>`.

- [ ] **Step 1: Widen `RealOrderStatus`**

```typescript
export type RealOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "served" | "completed" | "cancelled"
```

- [ ] **Step 2: Add payment fields to `OrderRow`/`ORDER_SELECT`/`OrderForTracking`/`TrackingJson`**

Replace `OrderRow`:

```typescript
type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  total: number
  table_id: string | null
  payment_status: string
  payment_method: "stripe" | "cash" | "vnpay"
  tables: { table_number: string } | null
  order_items: { menu_items: { name_vi: string; name_en: string }; quantity: number; unit_price: number; note: string | null }[]
}
```

Replace `ORDER_SELECT`:

```typescript
const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`
```

Add to `OrderForTracking`:

```typescript
export type OrderForTracking = {
  id: string
  createdAt: number
  orderType: OrderType
  table?: string
  items: OrderForTrackingItem[]
  subtotal: number
  discount: number
  total: number
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: "stripe" | "cash" | "vnpay"
}
```

Update `mapOrderRow` to populate the new fields:

```typescript
function mapOrderRow(row: OrderRow): OrderForTracking {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    orderType: fromRealOrderType(row.order_type),
    table: row.tables?.table_number,
    items: row.order_items.map((oi) => ({
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      unitPrice: oi.unit_price,
      note: oi.note ?? undefined,
    })),
    subtotal: row.subtotal,
    discount: row.discount_amount,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
  }
}
```

Update `TrackingJson` and `mapTrackingJson`:

```typescript
type TrackingJson = {
  id: string
  createdAt: number
  orderType: RealOrderType
  table: string | null
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: "stripe" | "cash" | "vnpay"
  subtotal: number
  discount: number
  total: number
  items: TrackingJsonItem[]
}

function mapTrackingJson(json: TrackingJson): OrderForTracking {
  return {
    id: json.id,
    createdAt: json.createdAt,
    orderType: fromRealOrderType(json.orderType),
    table: json.table ?? undefined,
    items: json.items.map((item) => ({ ...item, note: item.note ?? undefined })),
    subtotal: json.subtotal,
    discount: json.discount,
    total: json.total,
    status: json.status,
    paymentStatus: json.paymentStatus,
    paymentMethod: json.paymentMethod,
  }
}
```

- [ ] **Step 3: Add `tableId`/payment fields to `KdsOrderRow`, widen `getKitchenOrders`, extend `getPendingPaymentOrders`**

Replace `KdsOrderRow` and `mapKdsRow`:

```typescript
export type KdsOrderRow = {
  id: string
  orderType: OrderType
  table?: string
  tableId?: string
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: "stripe" | "cash" | "vnpay"
  createdAt: number
  items: KdsOrderItemRow[]
}

function mapKdsRow(row: OrderRow): KdsOrderRow {
  return {
    id: row.id,
    orderType: fromRealOrderType(row.order_type),
    table: row.tables?.table_number,
    tableId: row.table_id ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    createdAt: new Date(row.created_at).getTime(),
    items: row.order_items.map((oi) => ({
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      note: oi.note,
    })),
  }
}
```

Replace `getKitchenOrders`'s filter:

```typescript
export async function getKitchenOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("status", ["paid", "preparing", "ready", "served"])
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}
```

Replace `getPendingPaymentOrders`:

```typescript
export async function getPendingPaymentOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("payment_method", "cash")
    .eq("payment_status", "pending")
    .or("status.eq.pending_payment,and(status.eq.served,order_type.eq.pickup)")
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}
```

- [ ] **Step 4: Add `confirmServedCashPayment` and `payExistingOrder`**

Add after `confirmCashPayment`:

```typescript
export async function confirmServedCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

export async function payExistingOrder(
  supabase: SupabaseClient,
  orderId: string,
  locale: string
): Promise<{ checkoutUrl: string }> {
  const { data, error } = await supabase.functions.invoke("pay-order", { body: { orderId, locale } })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { checkoutUrl: string }
}
```

- [ ] **Step 5: Update `orders-data.test.ts` fixtures**

Every `OrderRow`/`TrackingJson`-shaped fixture in this file needs `table_id`, `payment_status`, `payment_method` (or `tableId`/`paymentStatus`/`paymentMethod` in expected outputs) added. Find every existing fixture object literal that has `tables:` or `table:` and `status:` and add the three new fields alongside — e.g. a `getMyOrders`/`getKitchenOrders`-style row fixture becomes:

```typescript
{
  id: "order-1",
  created_at: "2026-07-08T10:00:00Z",
  order_type: "dine_in",
  status: "paid",
  subtotal: 100000,
  discount_amount: 0,
  total: 100000,
  table_id: "tbl-1",
  payment_status: "paid",
  payment_method: "cash",
  tables: { table_number: "1" },
  order_items: [],
}
```

and its expected mapped output gains `tableId: "tbl-1"` (for `KdsOrderRow` cases) or nothing extra for `OrderForTracking` cases beyond `paymentStatus: "paid", paymentMethod: "cash"`. Apply the same pattern to any `TrackingJson`-shaped fixture (add `paymentStatus`/`paymentMethod` at the top level, not nested).

Add two new test blocks:

```typescript
describe("confirmServedCashPayment", () => {
  it("updates only payment_status, not status", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await confirmServedCashPayment(supabase, "order-1")

    expect(updateSpy).toHaveBeenCalledWith({ payment_status: "paid" })
    expect(eqSpy).toHaveBeenCalledWith("id", "order-1")
  })
})

describe("payExistingOrder", () => {
  it("invokes the pay-order function with orderId and locale", async () => {
    const invokeSpy = vi.fn(() => Promise.resolve({ data: { checkoutUrl: "https://example.com/pay" }, error: null }))
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    const result = await payExistingOrder(supabase, "order-1", "vi")

    expect(invokeSpy).toHaveBeenCalledWith("pay-order", { body: { orderId: "order-1", locale: "vi" } })
    expect(result.checkoutUrl).toBe("https://example.com/pay")
  })
})
```

Add `confirmServedCashPayment, payExistingOrder` to the existing import line at the top of the test file.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "Widen order status/query layer for served status and deferred payment"
```

---

### Task 3: `place-order` Edge Function — skip payment session on Pay Later

**Files:**
- Modify: `supabase/functions/place-order/index.ts`

**Interfaces:**
- Consumes: `payload.payAt` (already forwarded to `place_order` via the existing `p_payload: payload` pass-through — no change needed to how the payload reaches the RPC).

- [ ] **Step 1: Guard session/URL creation on `payAt`**

Replace:

```typescript
    const needsStripeSession = payload.paymentMethod === "stripe" && payload.paymentCollected !== true
    const needsVnpayUrl = payload.paymentMethod === "vnpay" && payload.paymentCollected !== true
```

with:

```typescript
    const needsStripeSession = payload.paymentMethod === "stripe" && payload.paymentCollected !== true && payload.payAt !== "later"
    const needsVnpayUrl = payload.paymentMethod === "vnpay" && payload.paymentCollected !== true && payload.payAt !== "later"
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "place-order"`, `entrypoint_path: "index.ts"`, `verify_jwt: false` (matching its current setting), `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/place-order/index.ts
git commit -m "place-order: skip Stripe/VNPay session creation for payAt=later orders"
```

---

### Task 4: New `pay-order` Edge Function — customer-triggered deferred payment

**Files:**
- Create: `supabase/functions/pay-order/index.ts`

**Interfaces:**
- Consumes: `orders` table (`id`, `total`, `payment_method`, `payment_status`, `status`).
- Produces: `POST { orderId: string, locale: "vi"|"en" }` → `{ checkoutUrl: string }` or `{ error: string }`.

- [ ] **Step 1: Write the function**

```typescript
// pay-order: lets a customer trigger deferred Stripe/VNPay payment for
// an already-placed, already-served order (the Pay Later checkout
// flow) — see
// docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md.
// Reuses the same Stripe Checkout Session / VNPay redirect construction
// as place-order, just invoked later against an existing order instead
// of at placement time. verify_jwt is disabled — a guest's own deferred
// order must be payable without a session, same reasoning as
// place-order.

import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_LOCALES = ["vi", "en"]

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
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { order_id: params.orderId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "vnd",
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

function vnpayEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+")
}

async function signVnpayParams(params: Record<string, string>, secret: string): Promise<string> {
  const sortedKeys = Object.keys(params).sort()
  const signString = sortedKeys.map((k) => `${k}=${vnpayEncode(params[k])}`).join("&")
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
    .map((k) => `${k}=${vnpayEncode(vnpParams[k])}`)
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
    const orderId = payload.orderId as string | undefined
    const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), { status: 400, headers: corsHeaders })
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: order, error: fetchError } = await serviceClient
      .from("orders")
      .select("id, total, payment_method, payment_status, status")
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
    if (order.payment_method !== "stripe" && order.payment_method !== "vnpay") {
      return new Response(
        JSON.stringify({ error: "This order's payment method doesn't support online payment" }),
        { status: 400, headers: corsHeaders }
      )
    }

    const siteUrl = Deno.env.get("SITE_URL")!

    if (order.payment_method === "stripe") {
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

    const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
    const returnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?orderId=${order.id}&locale=${locale}`
    const checkoutUrl = await buildVnpayCheckoutUrl({
      orderId: order.id,
      total: order.total,
      ipAddr,
      locale,
      returnUrl,
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
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "pay-order"`, `entrypoint_path: "index.ts"`, `verify_jwt: false` (a guest must be able to pay their own deferred order without a session — same reasoning as `place-order`), `files: [{ name: "index.ts", content: <the file above> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/pay-order/index.ts
git commit -m "Add pay-order Edge Function for customer-triggered deferred payment"
```

---

### Task 5: Fix `stripe-webhook` — don't regress or cancel a served order

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

**Why:** today this function unconditionally sets `status: "paid"` on success and `status: "cancelled"` on expiry, assuming every order it touches is still `pending_payment`. For a Pay Later order that's already `served` when its deferred Stripe payment completes, forcing `status` back to `"paid"` would regress it, and cancelling it on expiry would cancel an order whose food was already served. It needs to look at the order's current status first.

- [ ] **Step 1: Replace the event-handling block**

Replace:

```typescript
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
```

with:

```typescript
  const event = JSON.parse(rawBody)
  const orderId = event.data?.object?.metadata?.order_id

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.expired") && orderId) {
    const { data: order } = await serviceClient.from("orders").select("status").eq("id", orderId).maybeSingle()

    if (event.type === "checkout.session.completed") {
      // A pre-kitchen Pay Now order also needs `status` flipped to
      // 'paid' (that's what makes it kitchen-visible). A Pay Later
      // order is already 'served' by the time its deferred payment
      // clears -- only payment_status changes there; the
      // complete_order_when_served_and_paid trigger (migration 0022)
      // takes it to 'completed' from that single field flip.
      const update = order?.status === "served" ? { payment_status: "paid" } : { status: "paid", payment_status: "paid" }
      await serviceClient.from("orders").update(update).eq("id", orderId).eq("payment_status", "pending")
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
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "stripe-webhook"`, `entrypoint_path: "index.ts"`, `verify_jwt: false` (matching its current setting), `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "stripe-webhook: branch on current order status so a served order isn't regressed or wrongly cancelled"
```

---

### Task 6: Fix `vnpay-ipn` — same correction as Task 5

**Files:**
- Modify: `supabase/functions/vnpay-ipn/index.ts`

**Interfaces:**
- Consumes: same reasoning as Task 5.

- [ ] **Step 1: Widen the order lookup and branch the update**

Replace:

```typescript
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
```

with:

```typescript
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
    // Pay Later order: already 'served' by the time payment clears --
    // only payment_status changes; complete_order_when_served_and_paid
    // (migration 0022) takes it to 'completed' from there.
    const update = order.status === "served" ? { payment_status: "paid" } : { status: "paid", payment_status: "paid" }
    await serviceClient.from("orders").update(update).eq("id", orderId).eq("payment_status", "pending")
  } else if (order.status === "pending_payment") {
    // Only cancel a still-pre-kitchen order -- a served order whose
    // deferred payment failed just stays served/unpaid for a retry.
    await serviceClient
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
  }
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "vnpay-ipn"`, `entrypoint_path: "index.ts"`, `verify_jwt: false` (matching its current setting), `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/vnpay-ipn/index.ts
git commit -m "vnpay-ipn: branch on current order status so a served order isn't regressed or wrongly cancelled"
```

---

### Task 7: Fix `vnpay-return` — don't send a served order's failed retry to Checkout

**Files:**
- Modify: `supabase/functions/vnpay-return/index.ts`

**Why:** `cancel_pending_order` (migration `0018`) already only cancels an order with `status = 'pending_payment'` — it's already a safe no-op for a `served` order, and returns `false` in that case. But the redirect target is currently hardcoded to `/checkout?paymentFailed=1` regardless — wrong for a served order's failed deferred-payment retry, which has no cart to check out and should land back on its own tracking page instead.

- [ ] **Step 1: Branch the failure redirect on `cancel_pending_order`'s return value**

Replace:

```typescript
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })

  return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
```

with:

```typescript
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const { data: wasCancelled } = await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })

  // cancel_pending_order only ever cancels a still-pre-kitchen order and
  // returns false as a no-op otherwise (e.g. a served Pay Later order
  // whose deferred payment attempt just failed) -- send that case back
  // to its own tracking page instead of an empty Checkout.
  if (wasCancelled) {
    return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
  }
  return Response.redirect(`${siteUrl}/${locale}/orders/${orderId}?paymentFailed=1`, 302)
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "vnpay-return"`, `entrypoint_path: "index.ts"`, `verify_jwt: false` (matching its current setting), `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/vnpay-return/index.ts
git commit -m "vnpay-return: send a served order's failed payment retry back to its tracking page, not Checkout"
```

---

### Task 8: `useKitchenOrders.tsx` — served target, serveTable, cash-confirm branching

**Files:**
- Modify: `hooks/useKitchenOrders.tsx`

**Interfaces:**
- Consumes: `confirmServedCashPayment` from Task 2.
- Produces: `NEXT_STATUS.ready === "served"`; `KitchenOrdersContextValue.serveTable(orderIds: string[]): Promise<void>`; `confirmCashPayment` now branches internally by the target order's current status.

- [ ] **Step 1: Update the import and `NEXT_STATUS`**

Replace:

```typescript
import {
  advanceOrderStatus,
  confirmCashPayment as confirmCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"

export type KdsStatus = "paid" | "preparing" | "ready"
export type { KdsOrderRow as KdsOrder }

export const NEXT_STATUS: Record<KdsStatus, RealOrderStatus | null> = {
  paid: "preparing",
  preparing: "ready",
  ready: "completed",
}
```

with:

```typescript
import {
  advanceOrderStatus,
  confirmCashPayment as confirmCashPaymentQuery,
  confirmServedCashPayment as confirmServedCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"

export type KdsStatus = "paid" | "preparing" | "ready"
export type { KdsOrderRow as KdsOrder }

export const NEXT_STATUS: Record<KdsStatus, RealOrderStatus | null> = {
  paid: "preparing",
  preparing: "ready",
  ready: "served",
}
```

- [ ] **Step 2: Add `serveTable` and branch `confirmCashPayment`**

Add `serveTable` to the context type:

```typescript
type KitchenOrdersContextValue = {
  orders: KdsOrderRow[]
  pendingPaymentOrders: KdsOrderRow[]
  isLoading: boolean
  advance: (orderId: string) => Promise<void>
  serveTable: (orderIds: string[]) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
  completedCount: number
  avgTimeLabel: string
}
```

Add the implementation (after `advance`):

```typescript
  async function serveTable(orderIds: string[]) {
    for (const orderId of orderIds) {
      const order = orders.find((o) => o.id === orderId)
      if (!order || order.status !== "ready") continue
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
      await advanceOrderStatus(supabase, orderId, "served")
    }
  }
```

Replace `confirmCashPayment`:

```typescript
  async function confirmCashPayment(orderId: string) {
    const order = orders.find((o) => o.id === orderId) ?? pendingPaymentOrders.find((o) => o.id === orderId)
    if (order?.status === "served") {
      await confirmServedCashPaymentQuery(supabase, orderId)
    } else {
      await confirmCashPaymentQuery(supabase, orderId)
    }
  }
```

Add `serveTable` to the provider's returned value:

```typescript
    <KitchenOrdersContext.Provider
      value={{ orders, pendingPaymentOrders, isLoading, advance, serveTable, confirmCashPayment, completedCount, avgTimeLabel }}
    >
```

- [ ] **Step 3: Commit**

```bash
git add hooks/useKitchenOrders.tsx
git commit -m "useKitchenOrders: Ready advances to served, add serveTable, branch cash-confirm by order status"
```

---

### Task 9: KDS board — remove dine-in's Ready-column button, fix stats footer

**Files:**
- Modify: `components/staff/kitchen-board.tsx`
- Modify: `components/staff/kitchen-stats-footer.tsx`

**Why:** dine-in's "Served" action now lives on the table card (Task 10) instead of the order card — the Ready column's existing button stays only for pickup (whose "Complete" tap targets `served` too, via `NEXT_STATUS` from Task 8, and relies on the new auto-completion trigger to finish the job immediately when already paid). The stats footer's "active orders" count needs to stop counting orders that already left the kitchen's hands.

- [ ] **Step 1: Gate the Ready-column button on order type**

In `components/staff/kitchen-board.tsx`, wrap the existing action `<button>` (the one with `onClick={() => onAdvance(order.id)}`) in a conditional:

```typescript
                    {!(column.status === "ready" && order.orderType === "dine-in") && (
                      <button
                        type="button"
                        onClick={() => onAdvance(order.id)}
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-b-xl py-3 text-base font-bold text-white transition-all active:scale-[0.99]",
                          column.status === "paid" && "bg-primary hover:brightness-110",
                          column.status === "preparing" && "bg-amber-600 hover:brightness-110",
                          column.status === "ready" && "bg-green-600 hover:brightness-110"
                        )}
                      >
                        {column.status === "paid" && (
                          <>
                            <Play className="h-4 w-4" /> {t("startPreparing")}
                          </>
                        )}
                        {column.status === "preparing" && (
                          <>
                            <CheckCircle2 className="h-4 w-4" /> {t("markReady")}
                          </>
                        )}
                        {column.status === "ready" && (
                          <>
                            <PackageCheck className="h-4 w-4" /> {t("complete")}
                          </>
                        )}
                      </button>
                    )}
```

- [ ] **Step 2: Fix the stats footer's active-orders count**

In `components/staff/kitchen-stats-footer.tsx`, replace:

```typescript
  const activeOrders = orders.filter((o) => o.status !== "ready")
```

with:

```typescript
  const activeOrders = orders.filter((o) => o.status !== "ready" && o.status !== "served")
```

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-board.tsx components/staff/kitchen-stats-footer.tsx
git commit -m "KDS board: dine-in Served moves to the table card, stats footer excludes served orders"
```

---

### Task 10: KDS Tables column — Served / Awaiting Payment / Confirm Cash Received

**Files:**
- Modify: `components/staff/kitchen-tables-column.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`KitchenDisplay` namespace)

**Interfaces:**
- Consumes: `useKitchenOrders()`'s `orders`, `serveTable`, `confirmCashPayment` (Task 8); `KdsOrderRow.tableId`/`paymentStatus`/`paymentMethod` (Task 2).

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `KitchenDisplay` block, add after `"guestNotified": "Guest notified staff",`:

```json
    "markServed": "Served",
    "tableAwaitingPayment": "Awaiting Payment",
```

In `messages/vi.json`'s `KitchenDisplay` block, add after `"guestNotified": "Khách đã báo nhân viên",`:

```json
    "markServed": "Đã Phục Vụ",
    "tableAwaitingPayment": "Chờ Thanh Toán",
```

- [ ] **Step 2: Rewrite the component**

Replace the full contents of `components/staff/kitchen-tables-column.tsx`:

```typescript
"use client"

import { useLocale, useTranslations } from "next-intl"
import { Bell, CircleCheck, Sparkles, User, Utensils, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTables } from "@/hooks/useTables"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export function KitchenTablesColumn() {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const { tables, setStatus } = useTables()
  const { orders, serveTable, confirmCashPayment } = useKitchenOrders()

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted">
      <header className="flex shrink-0 items-center justify-between bg-zinc-600 p-4 text-white">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {t("columnTables")}
          <span className="rounded bg-white/20 px-2 py-0.5 text-sm">{tables.length}</span>
        </h2>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {tables.map((table) => {
          const location = locale === "vi" ? table.locationVi : table.locationEn
          const tableOrders = orders.filter((o) => o.tableId === table.id)
          const readyOrderIds = tableOrders.filter((o) => o.status === "ready").map((o) => o.id)
          const awaitingPaymentOrder = tableOrders.find((o) => o.status === "served" && o.paymentStatus === "pending")

          return (
            <div
              key={table.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border p-3",
                table.status === "available" && "bg-green-50 dark:bg-green-950/20",
                table.status === "occupied" && "bg-red-50 dark:bg-red-950/20",
                table.status === "cleaning" && "bg-amber-50 dark:bg-amber-950/20"
              )}
            >
              <div>
                <p className="font-bold text-card-foreground">{table.number}</p>
                {location && <p className="text-xs text-muted-foreground">{location}</p>}
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    table.status === "available" && "bg-green-100 text-green-700",
                    table.status === "occupied" && "bg-red-100 text-red-700",
                    table.status === "cleaning" && "bg-amber-100 text-amber-700"
                  )}
                >
                  {table.status === "available" && <CircleCheck className="h-3 w-3" />}
                  {table.status === "occupied" && <User className="h-3 w-3" />}
                  {table.status === "cleaning" && <Sparkles className="h-3 w-3" />}
                  {table.status === "available"
                    ? t("tableAvailable")
                    : table.status === "occupied"
                      ? t("tableOccupied")
                      : t("tableCleaning")}
                </span>
                {table.status === "cleaning" && table.cleaningNotifiedAt && (
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-destructive">
                    <Bell className="h-3 w-3 animate-pulse" />
                    {t("guestNotified")}
                  </span>
                )}
                {awaitingPaymentOrder && (
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-700">
                    <Wallet className="h-3 w-3" />
                    {t("tableAwaitingPayment")}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                {table.status === "cleaning" && (
                  <button
                    type="button"
                    onClick={() => setStatus(table.id, "available")}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:brightness-110"
                  >
                    {t("cleaningDone")}
                  </button>
                )}
                {readyOrderIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => serveTable(readyOrderIds)}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:brightness-110"
                  >
                    <Utensils className="h-3 w-3" />
                    {t("markServed")}
                  </button>
                )}
                {awaitingPaymentOrder?.paymentMethod === "cash" && (
                  <button
                    type="button"
                    onClick={() => confirmCashPayment(awaitingPaymentOrder.id)}
                    className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-secondary-foreground hover:brightness-110"
                  >
                    {t("confirmCashReceived")}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-tables-column.tsx messages/en.json messages/vi.json
git commit -m "KDS Tables column: Served / Awaiting Payment / Confirm Cash Received"
```

---

### Task 11: Checkout — Pay Now / Pay Later toggle

**Files:**
- Modify: `components/customer/checkout-view.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`Checkout` namespace)

**Interfaces:**
- Produces: `payAt: "now" | "later"` included in the `place-order` invoke body.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `Checkout` block, add after `"paymentMethod": "Payment Method",`:

```json
    "payTiming": "When would you like to pay?",
    "payNow": "Pay Now",
    "payLater": "Pay Later",
```

In `messages/vi.json`'s `Checkout` block, add after `"paymentMethod": "Phương Thức Thanh Toán",`:

```json
    "payTiming": "Bạn muốn thanh toán khi nào?",
    "payNow": "Thanh Toán Ngay",
    "payLater": "Thanh Toán Sau",
```

- [ ] **Step 2: Add the `payAt` state and toggle UI**

Add state (alongside the existing `paymentMethod` state):

```typescript
  const [payAt, setPayAt] = useState<"now" | "later">("now")
```

Insert a new section right before the existing `{t("paymentMethod")}` section:

```typescript
      <section className="mb-6 space-y-2">
        <h2 className="font-bold text-card-foreground">{t("payTiming")}</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setPayAt("now")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              payAt === "now" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t("payNow")}
          </button>
          <button
            type="button"
            onClick={() => setPayAt("later")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              payAt === "later" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t("payLater")}
          </button>
        </div>
      </section>
```

- [ ] **Step 3: Pass `payAt` through to the Edge Function call**

In `handlePlaceOrder`'s `supabase.functions.invoke("place-order", { body: { ... } })`, add `payAt,` alongside the existing `paymentMethod,` field.

- [ ] **Step 4: Commit**

```bash
git add components/customer/checkout-view.tsx messages/en.json messages/vi.json
git commit -m "Checkout: add Pay Now / Pay Later toggle"
```

---

### Task 12: Order tracking — Served step, Pay Now button, payment-failed notice

**Files:**
- Modify: `components/customer/order-tracking.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`OrderTracking` namespace)

**Interfaces:**
- Consumes: `OrderForTracking.paymentStatus`/`paymentMethod` (Task 2); `payExistingOrder` (Task 2).

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `OrderTracking` block, add `"stepServed": "Served",` after `"stepReady": "Ready",`, add `"statusServed": "Served",` after `"statusReady": "Ready",`, and add after `"guestPollingNote": "Checking for updates every few seconds…"`:

```json
    ,
    "payNowPrompt": "Your order has been served. Complete payment whenever you're ready.",
    "payNowButton": "Pay Now",
    "payNowLoading": "Redirecting to payment…",
    "paymentRetryNotice": "Payment didn't go through — please try again."
```

In `messages/vi.json`'s `OrderTracking` block, add `"stepServed": "Đã Phục Vụ",` after `"stepReady": "Sẵn Sàng",`, add `"statusServed": "Đã Phục Vụ",` after `"statusReady": "Sẵn Sàng",`, and add after `"guestPollingNote": "Đang kiểm tra cập nhật mỗi vài giây…"`:

```json
    ,
    "payNowPrompt": "Đơn hàng của bạn đã được phục vụ. Hoàn tất thanh toán khi bạn sẵn sàng.",
    "payNowButton": "Thanh Toán Ngay",
    "payNowLoading": "Đang chuyển đến trang thanh toán…",
    "paymentRetryNotice": "Thanh toán không thành công — vui lòng thử lại."
```

- [ ] **Step 2: Add the Served step and update the status maps**

Replace:

```typescript
const STEPS = [
  { key: "stepPaid", icon: Check },
  { key: "stepPreparing", icon: CookingPot },
  { key: "stepReady", icon: PackageCheck },
  { key: "stepCompleted", icon: CircleCheckBig },
] as const

const STATUS_STEP: Record<OrderStatus, number> = {
  pending_payment: -1,
  paid: 0,
  preparing: 1,
  ready: 2,
  completed: 3,
  cancelled: -1,
}

const STATUS_LABEL_KEY: Record<OrderStatus, string> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}
```

with:

```typescript
const STEPS = [
  { key: "stepPaid", icon: Check },
  { key: "stepPreparing", icon: CookingPot },
  { key: "stepReady", icon: PackageCheck },
  { key: "stepServed", icon: Utensils },
  { key: "stepCompleted", icon: CircleCheckBig },
] as const

const STATUS_STEP: Record<OrderStatus, number> = {
  pending_payment: -1,
  paid: 0,
  preparing: 1,
  ready: 2,
  served: 3,
  completed: 4,
  cancelled: -1,
}

const STATUS_LABEL_KEY: Record<OrderStatus, string> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}
```

Update the top import line to add `Utensils` and `useSearchParams`, and add `Button`:

```typescript
"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  CookingPot, Check, PackageCheck, CircleCheckBig, Clock, TableIcon, ShoppingBag, Store, Phone, Utensils,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatOrderId, formatVND } from "@/lib/format"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { payExistingOrder } from "@/lib/supabase/orders-data"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"
```

- [ ] **Step 3: Add Pay Now state, handler, and the payment-failed notice effect**

Add inside `OrderTracking`, alongside the existing `order`/`isGuestPolling` state:

```typescript
  const [isPaying, setIsPaying] = useState(false)
  const [paymentNotice, setPaymentNotice] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    const failed = searchParams.get("paymentFailed") === "1" || searchParams.get("stripeCanceled") === "1"
    if (failed) setPaymentNotice(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePayNow() {
    setIsPaying(true)
    try {
      const { checkoutUrl } = await payExistingOrder(supabase, orderId, locale)
      window.location.href = checkoutUrl
    } catch {
      setPaymentNotice(true)
      setIsPaying(false)
    }
  }
```

- [ ] **Step 4: Render the Pay Now section**

Insert this new `<section>` right after the existing progress-steps `<section>` (before the `<section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">` table/branch info block):

```typescript
      {order.status === "served" &&
        order.paymentStatus === "pending" &&
        (order.paymentMethod === "stripe" || order.paymentMethod === "vnpay") && (
          <section className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="mb-3 text-sm font-medium text-card-foreground">{t("payNowPrompt")}</p>
            {paymentNotice && <p className="mb-3 text-sm text-destructive">{t("paymentRetryNotice")}</p>}
            <Button className="h-11 w-full rounded-xl" disabled={isPaying} onClick={handlePayNow}>
              {isPaying ? t("payNowLoading") : t("payNowButton")}
            </Button>
          </section>
        )}
```

- [ ] **Step 5: Commit**

```bash
git add components/customer/order-tracking.tsx messages/en.json messages/vi.json
git commit -m "Order tracking: Served step, Pay Now button for deferred Stripe/VNPay, payment-failed notice"
```

---

### Task 13: Order history — `served` status support

**Files:**
- Modify: `components/customer/order-history.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`OrderHistory` namespace)

**Interfaces:**
- Consumes: `OrderStatus` widened to include `"served"` (Task 2, re-exported via `hooks/useOrders.tsx`'s `export type OrderStatus = OrderForTracking["status"]` — already automatic, no change needed there).

- [ ] **Step 1: Add the translation key**

In `messages/en.json`'s `OrderHistory` block, add `"statusServed": "Served",` after `"statusReady": "Ready",`.

In `messages/vi.json`'s `OrderHistory` block, add `"statusServed": "Đã Phục Vụ",` after `"statusReady": "Sẵn Sàng",`.

- [ ] **Step 2: Update the status Records and filter**

Replace:

```typescript
const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  paid: "bg-blue-100 text-blue-800",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

const STATUS_KEYS: Record<OrderStatus, "statusPendingPayment" | "statusPaid" | "statusPreparing" | "statusReady" | "statusCompleted" | "statusCancelled"> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}
```

with:

```typescript
const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  paid: "bg-blue-100 text-blue-800",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  served: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

const STATUS_KEYS: Record<
  OrderStatus,
  "statusPendingPayment" | "statusPaid" | "statusPreparing" | "statusReady" | "statusServed" | "statusCompleted" | "statusCancelled"
> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}
```

Replace `matchesFilter`:

```typescript
function matchesFilter(status: OrderStatus, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "active")
    return status === "pending_payment" || status === "paid" || status === "preparing" || status === "ready" || status === "served"
  return status === "completed" || status === "cancelled"
}
```

- [ ] **Step 3: Commit**

```bash
git add components/customer/order-history.tsx messages/en.json messages/vi.json
git commit -m "Order history: support the served status"
```

---

### Task 14: Full verification

- [ ] **Step 1: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds. If either fails on a `Record<OrderStatus, ...>` or similar exhaustiveness error, it means a status-keyed map was missed — grep the repo for `RealOrderStatus`/`OrderStatus` usages and add the missing `served` entry.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the updated `orders-data.test.ts`.

- [ ] **Step 3: Push to `main`**

```bash
git push
```

- [ ] **Step 4: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app`, for each combination:

- **Pay Now, all 3 methods, both order types**: confirm zero behavior change — order only reaches the kitchen after payment, and (for pickup) a single "Complete" tap finishes it once Ready; (for dine-in) tap "Served" on the table card, confirm it completes immediately (payment was already settled) and the table moves straight to Cleaning.
- **Pay Later + Cash, dine-in**: place the order, confirm it's immediately visible in KDS's New column and the table shows Occupied; advance to Ready; tap "Served" on the table card; confirm "Awaiting Payment" + "Confirm Cash Received" appear; tap it; confirm the order completes and the table moves to Cleaning.
- **Pay Later + Stripe/VNPay, dine-in**: same up through "Served"; confirm the customer's tracking page shows the "Pay Now" button; complete that checkout; confirm the order auto-completes and the table moves to Cleaning.
- **Pay Later + Cash, pickup**: confirm it reaches the kitchen immediately; the Ready-column "Complete" tap sets it to Served; confirm it appears in the pending-cash banner for confirmation; confirm it completes after confirming.
- **Pay Later + Stripe/VNPay, pickup**: confirm the tracking page's "Pay Now" button appears once Served and completes the order the same way as dine-in.
- **Failure path**: start a Pay Later Stripe/VNPay payment from the tracking page and back out/let it fail; confirm the order is NOT cancelled (still Served, still unpaid) and the "Pay Now" button is still available to retry.
