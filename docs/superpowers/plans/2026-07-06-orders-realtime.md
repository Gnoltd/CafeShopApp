# Real Orders + Realtime (Core, Cash-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `hooks/useOrders.tsx` and `hooks/useKitchenOrders.tsx`'s
disconnected local mock systems with one real `orders` schema
(already-applied migrations `0005`-`0007`), unify their incompatible
status vocabularies, make Cash payment fully real end-to-end (order
placement → payment confirmation → kitchen prep → completion), and defer
Stripe/VNPay to their own follow-up specs.

**Architecture:** One migration adding two `security definer` RPCs
(`place_order` for atomic, server-priced order creation;
`get_order_for_tracking` for a leak-free single-order guest/customer/staff
lookup — replacing what a broad RLS policy would unsafely do). One new
query module (`lib/supabase/orders-data.ts`). Both existing hooks
(`useOrders`/`useKitchenOrders`) rewritten to read real data — kept as two
separate hooks, same source table, each scoped to what its consumers
need. The `place-order` Edge Function becomes real (a thin wrapper around
`place_order`, shaped so Stripe/VNPay's specs can wrap gateway calls
around it later). Checkout/Order Tracking/Order History/Kitchen
Display/POS all get updated to the real data flow.

**Tech Stack:** Next.js Client Components, Postgres `plpgsql` functions
(two new `security definer` RPCs), Supabase Edge Functions (Deno),
`@supabase/supabase-js` Realtime, Vitest.

## Global Constraints

- Every new/changed piece of UI text needs keys in **both**
  `messages/en.json` and `messages/vi.json`.
- DI convention: every function in `lib/supabase/orders-data.ts` takes
  `supabase: SupabaseClient` as its first argument, unit-tested with a
  fake/spy client — same style as every other query module.
- Every SQL migration is applied via `mcp__supabase__apply_migration`
  against the live project `qhiypdqnrnzndxdwqxbx`, then verified with
  `mcp__supabase__execute_sql` before moving on.
- `order_type` mapping: DB enum is `pickup | dine_in` (underscore); every
  hook/component-facing type stays `"pickup" | "dine-in"` (hyphen,
  matching existing code) — the query layer is the only place that
  translates between them.
- **No RLS policy changes in this plan.** Every read/write this plan adds
  goes through either an existing correctly-scoped policy
  (`orders_select_own`, `orders_select_staff`, `orders_update_staff`) or
  one of the two new `security definer` RPCs. Do not add a broad
  `customer_id is null` SELECT policy — the design spec found this leaks
  every guest order to every guest.
- **`place_order` always inserts with `payment_status = 'pending'`, never
  `'paid'` directly** — `handle_order_paid` (migration `0007`) is a
  `before update` trigger only; it cannot fire on `insert`. Any
  immediate-payment case (POS) must be a genuine second `update`
  statement inside the same function call.
- Base UI's `Button` has no `asChild` — polymorphic rendering uses
  `render={<Link .../>}` + `nativeButton={false}`.
- Toggle switches must anchor their thumb with `absolute left-0.5
  top-0.5` + `translate-x-0`/`translate-x-5` (none new in this plan, but
  don't copy an old broken example if one comes up).

---

### Task 1: Migration `0014` — `place_order` and `get_order_for_tracking` RPCs

**Files:**
- Create: `supabase/migrations/0014_orders_place_and_track_fns.sql`

**Interfaces:**
- Consumes: `menu_items`/`menu_item_sizes`/`modifiers`/`tables`/
  `loyalty_settings`/`profiles`/`orders`/`order_items`/
  `order_item_modifiers`/`loyalty_transactions` (all already exist).
- Produces: `order_items.note` (new column — the real schema had no way
  to store a customer's free-text per-item note, e.g. "less sugar,"
  which is an already-shipped Cart/Checkout feature; without this column
  `place_order` would silently drop every note on a real order, a real
  regression from the mock's behavior); `public.place_order(p_payload
  jsonb) returns jsonb`; `public.get_order_for_tracking(p_order_id uuid)
  returns jsonb`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0014_orders_place_and_track_fns.sql
-- A missing note column on order_items (found while designing
-- place_order — customers can already attach a free-text per-item note
-- in Cart/Checkout, but the real schema had nowhere to store it), plus
-- two RPCs for real order placement and lookup:
--   place_order — security definer, atomic, server-computed prices/
--     discounts (never trusts client-supplied money values). Always
--     inserts at payment_status='pending', then a genuine second update
--     to 'paid' when payment was already collected (POS) — required
--     because handle_order_paid (migration 0007) is a `before update`
--     trigger and cannot fire on insert.
--   get_order_for_tracking — security definer, single-row lookup only
--     (order id is a required parameter), so a guest's own order (whose
--     customer_id is null) can be read without a broad RLS policy that
--     would let any guest bulk-read every other guest's order.

alter table public.order_items add column note text;

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
  if v_redeem_points > 0 then
    if v_customer_id is null then
      raise exception 'guests cannot redeem loyalty points';
    end if;
    select loyalty_points_balance into v_balance from public.profiles where id = v_customer_id;
    if v_balance is null or v_redeem_points > v_balance then
      raise exception 'insufficient loyalty points balance';
    end if;
  end if;

  -- orders row inserted after item pricing below (needs v_subtotal first),
  -- but we need the id early for order_items' foreign key — insert a
  -- placeholder-free row once totals are known instead of two passes.
  -- Compute item pricing first:
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
    v_customer_id, v_order_type, v_table_id, 'pending_payment', v_payment_method, 'pending',
    v_subtotal, v_promo_discount + v_loyalty_discount,
    greatest(v_subtotal - v_promo_discount - v_loyalty_discount, 0),
    p_payload->>'pickupTime'
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

grant execute on function public.place_order(jsonb) to anon, authenticated;

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

grant execute on function public.get_order_for_tracking(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Use `mcp__supabase__apply_migration` with `name:
"0014_orders_place_and_track_fns"` and the SQL from Step 1 as `query`.

- [ ] **Step 3: Verify with a real end-to-end call**

Use `mcp__supabase__execute_sql` to fetch one real menu item id first:

```sql
select id, base_price from public.menu_items where is_available limit 1;
```

Then, using that id, verify `place_order` end-to-end:

```sql
select public.place_order(jsonb_build_object(
  'orderType', 'pickup',
  'tableId', null,
  'pickupTime', 'asap',
  'paymentMethod', 'cash',
  'promoCode', null,
  'redeemLoyaltyPoints', 0,
  'paymentCollected', true,
  'items', jsonb_build_array(jsonb_build_object(
    'menuItemId', '<the id from above>', 'sizeId', null, 'modifierIds', '[]'::jsonb, 'quantity', 1, 'note', null
  ))
));
```

Expected: returns `{"orderId": "...", "total": <that item's base_price>}`.
Then verify the trigger fired and the row looks right:

```sql
select status, payment_status, subtotal, total from public.orders where id = '<orderId from above>';
select count(*) from public.inventory_logs where reference_order_id = '<orderId from above>';
```

Expected: `status='paid'`, `payment_status='paid'` (since
`paymentCollected: true` was passed); an `inventory_logs` row count ≥ 0
(0 is fine if that menu item has no `menu_item_ingredients` recipe rows
yet — not every seeded item has one, this just confirms no error, not
that a deduction necessarily happened).

Then verify `get_order_for_tracking` as an anonymous-equivalent read
(this SQL session is effectively service-role, so this checks the
function runs and shapes data correctly — the actual "guest can't read
other guests' orders" boundary is verified live with Playwright in
Task 9):

```sql
select public.get_order_for_tracking('<orderId from above>');
```

Expected: a JSON object with `id`/`status`/`items` matching what was
just placed.

- [ ] **Step 4: Clean up the test order**

```sql
delete from public.order_items where order_id = '<orderId from above>';
delete from public.orders where id = '<orderId from above>';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_orders_place_and_track_fns.sql
git commit -m "Add place_order and get_order_for_tracking RPCs"
```

---

### Task 2: Query layer — `lib/supabase/orders-data.ts`

**Files:**
- Create: `lib/supabase/orders-data.ts`
- Create: `lib/supabase/orders-data.test.ts`

**Interfaces:**
- Consumes: the two RPCs from Task 1; `orders`/`order_items`/
  `menu_items`/`tables` tables for the plain staff/customer reads.
- Produces: `RealOrderStatus`, `OrderForTracking`, `PlaceOrderInput`,
  `KdsOrderRow` types and `placeOrder`, `getOrderForTracking`,
  `getMyOrders`, `getKitchenOrders`, `getPendingPaymentOrders`,
  `advanceOrderStatus`, `confirmCashPayment` — used by Task 3
  (`useOrders`) and Task 4 (`useKitchenOrders`).

- [ ] **Step 1: Write the failing test for `getOrderForTracking`**

```ts
// lib/supabase/orders-data.test.ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getOrderForTracking } from "./orders-data"

describe("getOrderForTracking", () => {
  it("calls the RPC and returns its jsonb result directly", async () => {
    const result = {
      id: "ord-1",
      createdAt: 1751800000000,
      orderType: "dine_in",
      table: "3",
      status: "preparing",
      subtotal: 50000,
      discount: 0,
      total: 50000,
      items: [{ nameVi: "Phin Sữa Đá", nameEn: "Iced Milk Coffee", quantity: 1, unitPrice: 50000 }],
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: result, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const order = await getOrderForTracking(supabase, "ord-1")

    expect(rpcSpy).toHaveBeenCalledWith("get_order_for_tracking", { p_order_id: "ord-1" })
    expect(order?.orderType).toBe("dine-in")
    expect(order?.table).toBe("3")
    expect(order?.status).toBe("preparing")
  })

  it("returns null when the RPC returns null (not found or not permitted)", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const order = await getOrderForTracking(supabase, "nonexistent")
    expect(order).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: FAIL — `Cannot find module './orders-data'`.

- [ ] **Step 3: Write `orders-data.ts` (all functions)**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type RealOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "completed" | "cancelled"
export type RealOrderType = "pickup" | "dine_in"
export type OrderType = "pickup" | "dine-in"

export type OrderForTrackingItem = { nameVi: string; nameEn: string; quantity: number; unitPrice: number; note?: string }

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
}

export type PlaceOrderItemInput = {
  menuItemId: string
  sizeId?: string | null
  modifierIds: string[]
  quantity: number
  note?: string | null
}

export type PlaceOrderInput = {
  orderType: OrderType
  tableId?: string | null
  pickupTime?: string | null
  paymentMethod: "cash"
  promoCode?: string | null
  redeemLoyaltyPoints?: number
  paymentCollected?: boolean
  items: PlaceOrderItemInput[]
}

function toRealOrderType(orderType: OrderType): RealOrderType {
  return orderType === "dine-in" ? "dine_in" : "pickup"
}

function fromRealOrderType(orderType: RealOrderType): OrderType {
  return orderType === "dine_in" ? "dine-in" : "pickup"
}

type TrackingJsonItem = { nameVi: string; nameEn: string; quantity: number; unitPrice: number; note: string | null }

type TrackingJson = {
  id: string
  createdAt: number
  orderType: RealOrderType
  table: string | null
  status: RealOrderStatus
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
  }
}

export async function placeOrder(
  supabase: SupabaseClient,
  input: PlaceOrderInput
): Promise<{ orderId: string; total: number }> {
  const { data, error } = await supabase.rpc("place_order", {
    p_payload: {
      orderType: toRealOrderType(input.orderType),
      tableId: input.tableId ?? null,
      pickupTime: input.pickupTime ?? null,
      paymentMethod: input.paymentMethod,
      promoCode: input.promoCode ?? null,
      redeemLoyaltyPoints: input.redeemLoyaltyPoints ?? 0,
      paymentCollected: input.paymentCollected ?? false,
      items: input.items.map((item) => ({
        menuItemId: item.menuItemId,
        sizeId: item.sizeId ?? null,
        modifierIds: item.modifierIds,
        quantity: item.quantity,
        note: item.note ?? null,
      })),
    },
  })
  if (error) throw error
  return data as { orderId: string; total: number }
}

export async function getOrderForTracking(supabase: SupabaseClient, orderId: string): Promise<OrderForTracking | null> {
  const { data, error } = await supabase.rpc("get_order_for_tracking", { p_order_id: orderId })
  if (error) throw error
  return data ? mapTrackingJson(data as TrackingJson) : null
}

type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  total: number
  tables: { table_number: string } | null
  order_items: { menu_items: { name_vi: string; name_en: string }; quantity: number; unit_price: number; note: string | null }[]
}

const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, total,
  tables ( table_number ),
  order_items ( quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`

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
  }
}

export async function getMyOrders(supabase: SupabaseClient): Promise<OrderForTracking[]> {
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapOrderRow)
}

export type KdsOrderItemRow = { nameVi: string; nameEn: string; quantity: number; note: string | null }
export type KdsOrderRow = {
  id: string
  orderType: OrderType
  table?: string
  status: RealOrderStatus
  createdAt: number
  items: KdsOrderItemRow[]
}

function mapKdsRow(row: OrderRow): KdsOrderRow {
  return {
    id: row.id,
    orderType: fromRealOrderType(row.order_type),
    table: row.tables?.table_number,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    items: row.order_items.map((oi) => ({
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      note: oi.note,
    })),
  }
}

export async function getKitchenOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("status", ["paid", "preparing", "ready"])
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}

export async function getPendingPaymentOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", "pending_payment")
    .eq("payment_method", "cash")
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}

export async function advanceOrderStatus(
  supabase: SupabaseClient,
  orderId: string,
  newStatus: RealOrderStatus
): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId)
  if (error) throw error
}

export async function confirmCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: "paid", payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the remaining tests**

Append to `lib/supabase/orders-data.test.ts`:

```ts
import { placeOrder, getMyOrders, getKitchenOrders, advanceOrderStatus, confirmCashPayment } from "./orders-data"

describe("placeOrder", () => {
  it("maps camelCase input to the RPC's payload shape, translating order type", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { orderId: "ord-new", total: 29000 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await placeOrder(supabase, {
      orderType: "dine-in",
      tableId: "tbl-1",
      pickupTime: null,
      paymentMethod: "cash",
      promoCode: "WELCOME10",
      redeemLoyaltyPoints: 0,
      paymentCollected: false,
      items: [{ menuItemId: "item-1", sizeId: null, modifierIds: [], quantity: 2, note: "less sugar" }],
    })

    expect(rpcSpy).toHaveBeenCalledWith("place_order", {
      p_payload: {
        orderType: "dine_in",
        tableId: "tbl-1",
        pickupTime: null,
        paymentMethod: "cash",
        promoCode: "WELCOME10",
        redeemLoyaltyPoints: 0,
        paymentCollected: false,
        items: [{ menuItemId: "item-1", sizeId: null, modifierIds: [], quantity: 2, note: "less sugar" }],
      },
    })
    expect(result).toEqual({ orderId: "ord-new", total: 29000 })
  })
})

describe("getMyOrders", () => {
  it("maps nested rows, translating order_type back to hyphenated form", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "dine_in",
      status: "completed",
      subtotal: 29000,
      discount_amount: 0,
      total: 29000,
      tables: { table_number: "2" },
      order_items: [{ quantity: 1, unit_price: 29000, menu_items: { name_vi: "a", name_en: "b" } }],
    }
    const supabase = {
      from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }) }),
    } as unknown as SupabaseClient

    const result = await getMyOrders(supabase)
    expect(result[0].orderType).toBe("dine-in")
    expect(result[0].table).toBe("2")
  })
})

describe("getKitchenOrders", () => {
  it("filters to paid/preparing/ready statuses", async () => {
    const inSpy = vi.fn(() => ({ order: () => Promise.resolve({ data: [], error: null }) }))
    const supabase = {
      from: () => ({ select: () => ({ in: inSpy }) }),
    } as unknown as SupabaseClient

    await getKitchenOrders(supabase)
    expect(inSpy).toHaveBeenCalledWith("status", ["paid", "preparing", "ready"])
  })
})

describe("advanceOrderStatus", () => {
  it("updates only the status column", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await advanceOrderStatus(supabase, "ord-1", "ready")
    expect(updateSpy).toHaveBeenCalledWith({ status: "ready" })
    expect(eqSpy).toHaveBeenCalledWith("id", "ord-1")
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
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "Add orders-data query layer for real order placement/tracking/KDS"
```

---

### Task 3: Rewrite `hooks/useOrders.tsx` (customer side)

**Files:**
- Modify: `hooks/useOrders.tsx` (full rewrite)

**Interfaces:**
- Consumes: `orders-data.ts` from Task 2.
- Produces: `useOrders()` now exposes `myOrders` (Order History, real,
  logged-in only), `getOrder(orderId)` (async, real, works for guest/
  customer/staff), and no longer exposes a synchronous local `orders`
  array or `addOrder` — Checkout (Task 6) now places orders directly via
  `placeOrder`, not through this hook.

- [ ] **Step 1: Rewrite `hooks/useOrders.tsx`**

```tsx
"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { getMyOrders, getOrderForTracking, type OrderForTracking } from "@/lib/supabase/orders-data"

export type { OrderForTracking }
export type OrderStatus = OrderForTracking["status"]

type OrdersContextValue = {
  myOrders: OrderForTracking[]
  isLoadingMyOrders: boolean
  getOrder: (orderId: string) => Promise<OrderForTracking | null>
}

const OrdersContext = createContext<OrdersContextValue | null>(null)

export function OrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [myOrders, setMyOrders] = useState<OrderForTracking[]>([])
  const [isLoadingMyOrders, setIsLoadingMyOrders] = useState(true)

  useEffect(() => {
    let cancelled = false

    getMyOrders(supabase)
      .then((rows) => {
        if (!cancelled) setMyOrders(rows)
      })
      .catch(() => {
        // Order History is gated to logged-in customers already; an
        // error here (e.g. no session) just leaves the list empty.
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMyOrders(false)
      })

    const channel = supabase
      .channel("my-orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        // Realtime confirms *that* a row visible to this session changed;
        // re-fetching the small "my orders" list is simpler and cheap
        // enough than hand-merging a partial payload against joined
        // table/menu_item names this component doesn't have inline.
        getMyOrders(supabase).then((rows) => {
          if (!cancelled) setMyOrders(rows)
        })
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`My-orders realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function getOrder(orderId: string): Promise<OrderForTracking | null> {
    return getOrderForTracking(supabase, orderId)
  }

  return (
    <OrdersContext.Provider value={{ myOrders, isLoadingMyOrders, getOrder }}>{children}</OrdersContext.Provider>
  )
}

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext)
  if (!ctx) throw new Error("useOrders must be used within an OrdersProvider")
  return ctx
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "useOrders|checkout-view|order-tracking|order-history"`
Expected: errors in all three consumer files (removed `addOrder`, changed
`orders` to `myOrders`, `OrderRecord` renamed) — fixed in Tasks 6-8.

- [ ] **Step 3: Commit**

```bash
git add hooks/useOrders.tsx
git commit -m "Rewrite useOrders for real order tracking/history with Realtime"
```

---

### Task 4: Rewrite `hooks/useKitchenOrders.tsx` (staff side)

**Files:**
- Modify: `hooks/useKitchenOrders.tsx` (full rewrite)

**Interfaces:**
- Consumes: `orders-data.ts` from Task 2.
- Produces: `useKitchenOrders()` now exposes `orders` (real, `paid|
  preparing|ready`), `pendingPaymentOrders` (real, `pending_payment` +
  cash), `isLoading`, `advance(orderId)` (real status update), and new
  `confirmCashPayment(orderId)`. `addOrder` is removed — POS's "Charge"
  now calls `placeOrder` directly (Task 10), same as Checkout.

- [ ] **Step 1: Rewrite `hooks/useKitchenOrders.tsx`**

```tsx
"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
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

type KitchenOrdersContextValue = {
  orders: KdsOrderRow[]
  pendingPaymentOrders: KdsOrderRow[]
  isLoading: boolean
  advance: (orderId: string) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
}

const KitchenOrdersContext = createContext<KitchenOrdersContextValue | null>(null)

export function KitchenOrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [orders, setOrders] = useState<KdsOrderRow[]>([])
  const [pendingPaymentOrders, setPendingPaymentOrders] = useState<KdsOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function refetch() {
    const [active, pending] = await Promise.all([getKitchenOrders(supabase), getPendingPaymentOrders(supabase)])
    setOrders(active)
    setPendingPaymentOrders(pending)
  }

  useEffect(() => {
    let cancelled = false

    refetch().finally(() => {
      if (!cancelled) setIsLoading(false)
    })

    const channel = supabase
      .channel("kitchen-orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        // Staff sees every order (orders_select_staff has no per-row
        // filtering concerns), so a plain refetch on any change is both
        // correct and simple — the board is small enough this is cheap.
        if (!cancelled) refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Kitchen orders realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function advance(orderId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const next = NEXT_STATUS[order.status as KdsStatus]
    if (!next) return
    await advanceOrderStatus(supabase, orderId, next)
  }

  async function confirmCashPayment(orderId: string) {
    await confirmCashPaymentQuery(supabase, orderId)
  }

  return (
    <KitchenOrdersContext.Provider value={{ orders, pendingPaymentOrders, isLoading, advance, confirmCashPayment }}>
      {children}
    </KitchenOrdersContext.Provider>
  )
}

export function useKitchenOrders(): KitchenOrdersContextValue {
  const ctx = useContext(KitchenOrdersContext)
  if (!ctx) throw new Error("useKitchenOrders must be used within a KitchenOrdersProvider")
  return ctx
}
```

Note: `orders` now only ever contains `paid|preparing|ready` rows (per
`getKitchenOrders`'s filter), so `KdsStatus` no longer includes `"new"` —
Task 9 renames the board's "New" column to filter on `status === "paid"`
instead of the old mock's `"new"` literal.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "useKitchenOrders|kitchen-board|kitchen-display|pos-terminal"`
Expected: errors in the KDS components and `pos-terminal.tsx` (removed
`addOrder`, `KdsStatus` no longer has `"new"`) — fixed in Tasks 9-10.

- [ ] **Step 3: Commit**

```bash
git add hooks/useKitchenOrders.tsx
git commit -m "Rewrite useKitchenOrders for real order data with Realtime"
```

---

### Task 5: Real `place-order` Edge Function

**Files:**
- Modify: `supabase/functions/place-order/index.ts`

**Interfaces:**
- Consumes: `place_order` RPC from Task 1.
- Produces: a real, deployed Edge Function POST endpoint accepting the
  same payload shape `placeOrder` (Task 2) sends, forwarding the caller's
  identity and calling `place_order` with the service role client (so the
  RPC's own `security definer` logic — not this function's request
  context — is the actual authorization boundary).

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/place-order/index.ts
// place-order: validates cart, computes price server-side, applies
// loyalty redemption, creates order (Stripe/VNPay/cash).
//
// For this pass, only "cash" is a real end-to-end path — Stripe/VNPay
// stay disabled in Checkout until their own specs land (see
// docs/superpowers/specs/2026-07-06-orders-realtime-design.md). This
// function is a thin wrapper around the place_order RPC, shaped so a
// future Stripe/VNPay pass can wrap a gateway call around this same
// call without re-architecting anything here.

import { createClient } from "jsr:@supabase/supabase-js@2"

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  const payload = await req.json()

  const authHeader = req.headers.get("Authorization")
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: authHeader ? { Authorization: authHeader } : {} } }
  )
  const { data: userData } = await userClient.auth.getUser()

  // The service-role client's own calls bypass RLS — place_order itself
  // re-derives auth.uid() internally via the forwarded Authorization
  // header on this same request, so a guest's null identity is handled
  // correctly by the RPC, not by any check in this function.
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY")!,
    { global: { headers: authHeader ? { Authorization: authHeader } : {} } }
  )

  const { data, error } = await serviceClient.rpc("place_order", { p_payload: payload })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
```

Note: `userClient`/`userData` are read here for a future Stripe/VNPay
pass (which will need the resolved user for receipt emails, etc.) but
`place_order` itself relies on `auth.uid()` resolving from the forwarded
`Authorization` header on the `serviceClient`'s own request — Postgres's
`auth.uid()` reads the JWT claims of the connection's role, which
Supabase's `service_role` + forwarded user JWT combination resolves
correctly (the same pattern Supabase's own docs use for Edge Functions
needing both elevated privileges and the calling user's identity).

- [ ] **Step 2: Deploy the function**

Use `mcp__supabase__deploy_edge_function` with `name: "place-order"` and
the file content from Step 1.

- [ ] **Step 3: Verify deployment**

Use `mcp__supabase__list_edge_functions` and confirm `place-order` shows
status `ACTIVE`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/place-order/index.ts
git commit -m "Deploy real place-order Edge Function (cash path)"
```

---

### Task 6: Checkout — real order placement, Stripe/VNPay disabled

**Files:**
- Modify: `components/customer/checkout-view.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `placeOrder` isn't called directly — Checkout calls the
  `place-order` Edge Function via `supabase.functions.invoke("place-order",
  {...})`, matching the input shape `PlaceOrderInput` (Task 2) describes.

- [ ] **Step 1: Add real loyalty data and disable Stripe/VNPay**

```tsx
"use client"

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

/** Fallback shown only when Dine-in is picked manually without scanning a table's QR code first. */
const FALLBACK_TABLE_NUMBER = "04"

type OrderType = "pickup" | "dine-in"
type PaymentMethod = "stripe" | "cash" | "vnpay"

const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: false },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
]

export function CheckoutView() {
  const locale = useLocale()
  const t = useTranslations("Checkout")
  const router = useRouter()
  const supabase = createClient()
  const { items, subtotal, promoCode, promoDiscount, clear } = useCart()
  const { activeTable } = useTables()

  const [orderType, setOrderType] = useState<OrderType>(activeTable ? "dine-in" : "pickup")
  const [pickupTime, setPickupTime] = useState("asap")
  const [redeemLoyalty, setRedeemLoyalty] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [pointsBalance, setPointsBalance] = useState(0)
  const [redeemValuePerPoint, setRedeemValuePerPoint] = useState(0)
  const [isPlacing, setIsPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One fixed redemption chunk per toggle-on, same UX as the old mock's
  // single "50 points for X đ" option — only the VND-per-point conversion
  // becomes real (loyalty_settings.redeem_value_vnd_per_point), not a
  // hardcoded 10,000đ.
  const REDEEM_CHUNK_POINTS = 50

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setIsLoggedIn(true)
      const { data: profile } = await supabase.from("profiles").select("loyalty_points_balance").eq("id", user.id).single()
      if (profile) setPointsBalance(profile.loyalty_points_balance)
    })
    supabase.from("loyalty_settings").select("redeem_value_vnd_per_point").eq("id", 1).single().then(({ data }) => {
      if (data) setRedeemValuePerPoint(data.redeem_value_vnd_per_point)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tableNumber = activeTable?.number ?? FALLBACK_TABLE_NUMBER
  const canRedeem = pointsBalance >= REDEEM_CHUNK_POINTS
  const loyaltyDiscount = redeemLoyalty && canRedeem ? REDEEM_CHUNK_POINTS * redeemValuePerPoint : 0
  const discount = promoDiscount + loyaltyDiscount
  const total = Math.max(subtotal - discount, 0)

  async function handlePlaceOrder() {
    if (items.length === 0 || !paymentMethod) return
    setError(null)
    setIsPlacing(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType,
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
    } catch {
      setError(t("placeOrderError"))
      setIsPlacing(false)
    }
  }

  // ... rest of the component's JSX is unchanged except the two edits below
```

- [ ] **Step 2: Update the Payment Method section's rendering**

Replace the Stripe/Cash `.map` loop's button to reflect `enabled`, and
add `disabled`/`title` to the VNPay button too:

```tsx
<section className="mb-6 space-y-2">
  <h2 className="font-bold text-card-foreground">{t("paymentMethod")}</h2>
  <div className="grid grid-cols-3 gap-2">
    {PAYMENT_OPTIONS.map(({ id, icon: Icon, labelKey, enabled }) => (
      <button
        key={id}
        type="button"
        disabled={!enabled}
        title={enabled ? undefined : t("paymentMethodComingSoon")}
        onClick={() => setPaymentMethod(id)}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors",
          paymentMethod === id
            ? "border-primary bg-primary/5 text-primary"
            : "border-transparent bg-muted text-muted-foreground",
          !enabled && "opacity-50"
        )}
      >
        <Icon className="h-7 w-7" />
        <span className="text-xs font-bold">{t(labelKey)}</span>
      </button>
    ))}
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
  </div>
</section>
```

- [ ] **Step 3: Update the Loyalty section for real data**

```tsx
<section className="mb-6 space-y-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
  <div className="flex items-center justify-between">
    <h2 className="font-bold text-card-foreground">{t("loyaltyPoints")}</h2>
    <Sparkles className="h-6 w-6 text-accent-foreground/70" />
  </div>
  {isLoggedIn ? (
    <>
      <p className="text-sm text-muted-foreground">{t("pointsBalance", { points: pointsBalance })}</p>
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <span className="text-sm font-medium text-card-foreground">
          {t("redeemLabel", { points: REDEEM_CHUNK_POINTS, amount: formatVND(REDEEM_CHUNK_POINTS * redeemValuePerPoint) })}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={redeemLoyalty}
          disabled={!canRedeem}
          onClick={() => setRedeemLoyalty((prev) => !prev)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
            redeemLoyalty ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              redeemLoyalty ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>
    </>
  ) : (
    <p className="text-sm text-muted-foreground" title={t("loyaltyGuestTooltip")}>
      {t("loyaltyGuestTooltip")}
    </p>
  )}
</section>
```

- [ ] **Step 4: Update the bottom action bar for the error state and async placing**

```tsx
{error && (
  <p className="mx-auto mb-2 max-w-2xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
)}
<div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t bg-card px-6 py-4 shadow-[0_-4px_12px_-1px_rgba(0,0,0,0.1)]">
  <div className="flex flex-col">
    <span className="text-xs text-muted-foreground">{t("total")}</span>
    <span className="text-xl font-bold text-primary">{formatVND(total)}</span>
    {redeemLoyalty && (
      <span className="text-[11px] text-accent-foreground/80">
        {t("discountApplied", { amount: formatVND(discount) })}
      </span>
    )}
  </div>
  <Button
    onClick={handlePlaceOrder}
    disabled={!paymentMethod || isPlacing}
    className="h-12 rounded-xl px-8 text-base font-bold"
  >
    {t("placeOrder")}
  </Button>
</div>
```

- [ ] **Step 5: Add new translation keys**

`messages/en.json`, inside `"Checkout"`:

```json
"paymentMethodComingSoon": "Coming soon — not available yet",
"loyaltyGuestTooltip": "Log in to earn and redeem loyalty points",
"placeOrderError": "Failed to place order. Try again."
```

`messages/vi.json`, inside `"Checkout"`:

```json
"paymentMethodComingSoon": "Sắp có — chưa khả dụng",
"loyaltyGuestTooltip": "Đăng nhập để tích và đổi điểm thưởng",
"placeOrderError": "Đặt hàng thất bại. Vui lòng thử lại."
```

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i checkout-view`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/customer/checkout-view.tsx messages/en.json messages/vi.json
git commit -m "Wire Checkout to real order placement; disable Stripe/VNPay until their own specs"
```

---

### Task 7: Order Tracking — real data, guest polling

**Files:**
- Modify: `components/customer/order-tracking.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `useOrders().getOrder` (Task 3).
- Produces: real order lookup replacing the local-array `.find` +
  `FALLBACK_ORDER` mock; a real 4-status-plus-pending mapping; guest
  polling every 10 seconds (no session → no Realtime visibility, per the
  design spec).

- [ ] **Step 1: Replace the status mapping and fallback logic**

```tsx
"use client"

import { useEffect, useState } from "react"
import {
  CookingPot, Check, PackageCheck, CircleCheckBig, Clock, TableIcon, ShoppingBag, Store, Phone,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatVND } from "@/lib/format"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"

const MOCK_SHOP_PHONE = "+84281234567"
const GUEST_POLL_INTERVAL_MS = 10000

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

export function OrderTracking({ orderId, table }: { orderId: string; table?: string }) {
  const locale = useLocale()
  const t = useTranslations("OrderTracking")
  const { getOrder } = useOrders()
  const [supabase] = useState(() => createClient())

  const [order, setOrder] = useState<OrderForTracking | null | undefined>(undefined)
  const [isGuestPolling, setIsGuestPolling] = useState(false)

  useEffect(() => {
    let cancelled = false
    let pollInterval: ReturnType<typeof setInterval> | undefined
    let channel: ReturnType<typeof supabase.channel> | undefined

    async function load() {
      const found = await getOrder(orderId)
      if (cancelled) return
      setOrder(found)
      if (!found) return

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // No session at all — this can only be a guest's own order (the
        // RPC already refused anything else). Realtime's authorization
        // is gated by the same RLS a direct SELECT would need, which a
        // guest never satisfies, so there is no live-push option here —
        // poll instead. See the design spec's "What's missing" point 4.
        setIsGuestPolling(true)
        pollInterval = setInterval(async () => {
          const refreshed = await getOrder(orderId)
          if (!cancelled) setOrder(refreshed)
        }, GUEST_POLL_INTERVAL_MS)
        return
      }

      // Logged-in customer (own order, matches orders_select_own) or
      // staff (matches orders_select_staff) — both are genuinely visible
      // to Realtime under existing RLS, so subscribe for real.
      channel = supabase
        .channel(`order-tracking-${orderId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
          async () => {
            const refreshed = await getOrder(orderId)
            if (!cancelled) setOrder(refreshed)
          }
        )
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" && status !== "CLOSED") {
            console.warn(`Order tracking realtime subscription status: ${status}`)
          }
        })
    }
    load()

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  if (order === undefined) return null

  if (order === null) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-bold text-card-foreground">{t("notFoundTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("notFoundMessage")}</p>
      </div>
    )
  }

  const currentStep = STATUS_STEP[order.status]
  const progressPercent = currentStep < 0 ? 0 : (currentStep / (STEPS.length - 1)) * 100

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4 sm:px-6">
      <section className="relative overflow-hidden rounded-xl border bg-muted p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary">{t("orderId")}</p>
        <h2 className="mb-4 text-3xl font-bold text-primary">#{order.id}</h2>
        <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-primary/15">
          <CookingPot className="h-12 w-12 text-primary" />
        </div>
        <h3 className="mb-1 text-xl font-semibold text-card-foreground">{t(STATUS_LABEL_KEY[order.status])}</h3>
        {order.status === "preparing" && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 text-primary" />
            {t("etaLabel")}
          </p>
        )}
        {isGuestPolling && <p className="mt-2 text-[11px] text-muted-foreground">{t("guestPollingNote")}</p>}
      </section>

      {/* ... progress bar / STEPS.map / order type card / branch card / items / totals / contact-shop
           sections are unchanged from before this task, still reading `order.*` the same way */}
    </div>
  )
}
```

(The steps/details/totals/contact-shop JSX below the status card is
unchanged — it already reads `order.items`/`order.subtotal`/
`order.discount`/`order.total`/`order.orderType`/`order.table`, all of
which the real `OrderForTracking` shape (Task 2) still provides under
the same names.)

- [ ] **Step 2: Add new translation keys**

`messages/en.json`, inside `"OrderTracking"`:

```json
"statusPendingPayment": "Awaiting Payment",
"statusPaid": "Order Confirmed",
"notFoundTitle": "Order Not Found",
"notFoundMessage": "We couldn't find this order, or you don't have access to view it.",
"guestPollingNote": "Checking for updates every few seconds…"
```

`messages/vi.json`, inside `"OrderTracking"`:

```json
"statusPendingPayment": "Đang Chờ Thanh Toán",
"statusPaid": "Đã Xác Nhận Đơn",
"notFoundTitle": "Không Tìm Thấy Đơn Hàng",
"notFoundMessage": "Không thể tìm thấy đơn hàng này, hoặc bạn không có quyền xem.",
"guestPollingNote": "Đang kiểm tra cập nhật mỗi vài giây…"
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i order-tracking`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/customer/order-tracking.tsx messages/en.json messages/vi.json
git commit -m "Wire Order Tracking to real order lookup, remove mock fallback"
```

---

### Task 8: Order History — real data

**Files:**
- Modify: `components/customer/order-history.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `useOrders().myOrders`/`isLoadingMyOrders` (Task 3).
- Produces: real order list, replacing the local mock array — already
  auth-gated to logged-in customers, so no new gating logic needed.

- [ ] **Step 1: Swap the data source and add a loading state**

```tsx
const { myOrders, isLoadingMyOrders } = useOrders()
const sorted = useMemo(() => [...myOrders].sort((a, b) => b.createdAt - a.createdAt), [myOrders])
const filtered = sorted.filter((order) => matchesFilter(order.status, filter))
```

Update `matchesFilter`/`STATUS_STYLES`/`STATUS_KEYS` to cover the real
6-state `OrderStatus` (adding `pending_payment`/`paid` entries):

```tsx
const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  paid: "bg-blue-100 text-blue-800",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

const STATUS_KEYS: Record<OrderStatus, string> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}

function matchesFilter(status: OrderStatus, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "active") return status === "pending_payment" || status === "paid" || status === "preparing" || status === "ready"
  return status === "completed" || status === "cancelled"
}
```

Add a loading branch before the existing `filtered.length === 0` check:

```tsx
{isLoadingMyOrders ? (
  <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
) : filtered.length === 0 ? (
  <p className="py-16 text-center text-muted-foreground">{t("empty")}</p>
) : (
  // ... unchanged existing filtered.map(...) JSX
)}
```

- [ ] **Step 2: Add new translation keys**

`messages/en.json`, inside `"OrderHistory"`: `"loading": "Loading your orders…"`
`messages/vi.json`, inside `"OrderHistory"`: `"loading": "Đang tải đơn hàng của bạn…"`

(`statusPendingPayment`/`statusPaid` keys already added to `OrderTracking`
in Task 7 — `OrderHistory` is a separate namespace, so add the same two
keys there too, matching the English/Vietnamese text used in Task 7.)

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i order-history`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/customer/order-history.tsx messages/en.json messages/vi.json
git commit -m "Wire Order History to real order list"
```

---

### Task 9: Kitchen Display — real statuses, Awaiting Payment list, real completion

**Files:**
- Modify: `components/staff/kitchen-board.tsx`
- Modify: `components/staff/kitchen-display.tsx`
- Create: `components/staff/kitchen-pending-payment.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `useKitchenOrders()`'s new `pendingPaymentOrders`/
  `confirmCashPayment` (Task 4).
- Produces: the board's "New" column now filters on `status === "paid"`
  instead of the old mock's `"new"`; a new small Awaiting Payment list;
  "Ready → advance" now performs a real `completed` transition instead
  of only removing the order from local state.

- [ ] **Step 1: Update `kitchen-board.tsx`'s column definitions**

```tsx
import type { KdsStatus, KdsOrder } from "@/hooks/useKitchenOrders"

const COLUMNS: {
  status: KdsStatus
  headerClass: string
  labelKey: "columnNew" | "columnPreparing" | "columnReady"
  icon: typeof ListTodo
  iconClass?: string
}[] = [
  { status: "paid", headerClass: "bg-zinc-500", labelKey: "columnNew", icon: ListTodo },
  { status: "preparing", headerClass: "bg-amber-600", labelKey: "columnPreparing", icon: RefreshCw, iconClass: "animate-spin [animation-duration:3s]" },
  { status: "ready", headerClass: "bg-green-600", labelKey: "columnReady", icon: CheckCheck },
]
```

Everywhere else in this file that compared `column.status === "new"`
(the elapsed-time-caption logic, the button color logic) becomes
`column.status === "paid"` — same conditions, matching the renamed
status literal.

- [ ] **Step 2: Update `kitchen-display.tsx` to render the Awaiting Payment list and treat "ready → advance" as real completion**

```tsx
"use client"

import { useEffect, useState } from "react"
import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { KitchenStatsFooter } from "@/components/staff/kitchen-stats-footer"
import { KitchenBoard } from "@/components/staff/kitchen-board"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function KitchenDisplay() {
  const { orders, pendingPaymentOrders, advance: advanceShared, confirmCashPayment } = useKitchenOrders()
  const [now, setNow] = useState(() => Date.now())
  const [completedCount, setCompletedCount] = useState(0)
  const [completedDurations, setCompletedDurations] = useState<number[]>([])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  async function advance(orderId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (order && order.status === "ready") {
      const duration = Date.now() - order.createdAt
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, duration])
    }
    await advanceShared(orderId)
  }

  const avgTimeLabel =
    completedDurations.length === 0
      ? "--:--"
      : formatDuration(completedDurations.reduce((sum, d) => sum + d, 0) / completedDurations.length)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KitchenTopBar />
      <div className="flex flex-1 overflow-hidden">
        <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} />
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
          {pendingPaymentOrders.length > 0 && (
            <KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={confirmCashPayment} />
          )}
          <div className="flex-1 overflow-hidden">
            <KitchenBoard orders={orders} now={now} onAdvance={advance} />
          </div>
          <KitchenStatsFooter orders={orders} now={now} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `components/staff/kitchen-pending-payment.tsx`**

```tsx
"use client"

import { useLocale, useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

export function KitchenPendingPayment({
  orders,
  onConfirm,
}: {
  orders: KdsOrder[]
  onConfirm: (orderId: string) => Promise<void>
}) {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")

  return (
    <div className="shrink-0 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/20">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
        <Banknote className="h-4 w-4" />
        {t("awaitingPaymentTitle", { count: orders.length })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="font-bold">#{order.id}</span>
            <span className="text-muted-foreground">
              {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
            </span>
            <Button size="sm" className="h-7" onClick={() => onConfirm(order.id)}>
              {t("confirmCashReceived")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add new translation keys**

`messages/en.json`, inside `"KitchenDisplay"`:

```json
"awaitingPaymentTitle": "Awaiting Cash Payment ({count})",
"confirmCashReceived": "Confirm Cash Received"
```

`messages/vi.json`, inside `"KitchenDisplay"`:

```json
"awaitingPaymentTitle": "Chờ Thanh Toán Tiền Mặt ({count})",
"confirmCashReceived": "Xác Nhận Đã Nhận Tiền"
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "kitchen-board|kitchen-display|kitchen-pending-payment"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/staff/kitchen-board.tsx components/staff/kitchen-display.tsx components/staff/kitchen-pending-payment.tsx messages/en.json messages/vi.json
git commit -m "Wire Kitchen Display to real statuses, add Awaiting Payment list"
```

---

### Task 10: POS — real order placement, own Awaiting Payment section

**Files:**
- Modify: `components/staff/pos-terminal.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `place-order` Edge Function (Task 5) via `supabase.functions.invoke`;
  `useKitchenOrders()`'s `pendingPaymentOrders`/`confirmCashPayment`.
- Produces: "Charge" places a real order with `paymentCollected: true`;
  a small Awaiting Payment section (self-checkout cash orders staff can
  confirm from POS, per the design spec's reasoning that payment
  collection is POS's job, not KDS's).

- [ ] **Step 1: Replace `handleCharge` with a real, async call**

```tsx
import { createClient } from "@/lib/supabase/client"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"

// ... inside PosTerminal:
const supabase = createClient()
const { pendingPaymentOrders, confirmCashPayment } = useKitchenOrders()
const [isCharging, setIsCharging] = useState(false)
const [chargeError, setChargeError] = useState<string | null>(null)

async function handleCharge() {
  if (order.length === 0) return
  setChargeError(null)
  setIsCharging(true)
  try {
    const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
      body: {
        orderType: orderType === "dine-in" ? "dine-in" : "pickup",
        tableId: orderType === "dine-in" ? (selectedTable?.id ?? null) : null,
        pickupTime: null,
        paymentMethod: "cash",
        promoCode: null,
        redeemLoyaltyPoints: 0,
        paymentCollected: true,
        items: order.map((line) => ({
          menuItemId: line.menuItemId,
          sizeId: null,
          modifierIds: [],
          quantity: line.quantity,
          note: null,
        })),
      },
    })
    if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
    setOrder([])
  } catch {
    setChargeError(t("chargeError"))
  } finally {
    setIsCharging(false)
  }
}
```

(POS's ticket has no size/modifier picker yet — a known, documented gap
predating this plan — so `sizeId`/`modifierIds` stay empty here, matching
what POS already actually offers today.)

- [ ] **Step 2: Render the error and Awaiting Payment section, disable Charge while placing**

Find the existing "Charge" button and add `disabled={isCharging}`.
Add an error banner near the order summary (matching every other admin/
staff page's inline-error convention), and render
`<KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={confirmCashPayment} />`
above the item grid when `pendingPaymentOrders.length > 0`, reusing the
same component Task 9 created (no staff-facing duplication).

- [ ] **Step 3: Add new translation key**

`messages/en.json`, inside `"Pos"`: `"chargeError": "Failed to charge order. Try again."`
`messages/vi.json`, inside `"Pos"`: `"chargeError": "Thanh toán thất bại. Vui lòng thử lại."`

- [ ] **Step 4: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors anywhere now (Tasks 3-10 together resolve every
consumer), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/staff/pos-terminal.tsx messages/en.json messages/vi.json
git commit -m "Wire POS Charge to real order placement, add Awaiting Payment section"
```

---

### Task 11: Live verification, docs, and finishing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `daily.md`

**Interfaces:**
- Consumes: the fully wired feature from Tasks 1-10.
- Produces: updated project docs; confirmation of a green
  build/test/lint pipeline; a decision on merge/PR/discard.

- [ ] **Step 1: Run the full local verification pipeline**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Expected: no type errors; lint clean (same pre-existing baseline
documented in the Inventory/Tables plans — do not let this task's
changes add a *new* one); all tests pass; build succeeds.

- [ ] **Step 2: Push and wait for the Vercel deployment**

```bash
git push
```

Confirm the resulting deployment on `https://phadincafe.vercel.app`
reaches `Ready`.

- [ ] **Step 3: Live verification with Playwright**

1. As a fresh **guest** (no login): add an item to cart, go to Checkout,
   confirm Stripe/VNPay are disabled with a tooltip, place a Cash order.
   Confirm the resulting Order Tracking page shows "Awaiting Payment" and
   the guest-polling note.
2. As **staff** (admin test account), open POS: confirm the guest's order
   appears in POS's Awaiting Payment section. Click "Confirm Cash
   Received."
3. Back on the guest's tracking tab (no manual reload — polling should
   pick it up within ~10s): confirm the status advances to "Order
   Confirmed" and the 4-step bar shows step 1 done.
4. On staff's Kitchen Display: confirm the same order now appears in the
   "New" column. Click "Start Preparing," then "Mark Ready," then
   "Complete." Confirm the guest's tracking tab picks up each transition
   (polling) and the 4-step bar reaches step 4.
5. Via `mcp__supabase__execute_sql`: confirm `orders.status = 'completed'`
   for that order, and that `inventory_logs` gained `order_deduction` rows
   if that menu item has real `menu_item_ingredients` recipe rows
   (Inventory sub-project) — if the tested item has none seeded, this is
   expected to show zero rows, not a failure.
6. As staff, open POS again: build a walk-in ticket, select Cash, click
   "Charge." Confirm it appears **directly** in Kitchen Display's "New"
   column with **no** Awaiting Payment step (payment already collected
   at the counter).
7. As a **logged-in customer** (test customer account): place a Cash
   order with loyalty redemption toggled on (if their seeded balance
   supports it). Confirm the redeemed points deduct from
   `profiles.loyalty_points_balance` (`execute_sql`) and a
   `loyalty_transactions` row with `type = 'redeem'` exists. Confirm this
   customer's Order Tracking page updates via true Realtime (not
   polling) — e.g. by advancing the order's status as staff and watching
   it change without the ~10s polling delay.
8. Confirm Order History (as the logged-in customer) shows the real
   order, correctly filtered by the Active/Completed pills.

If any check fails, treat it as a real bug per
`superpowers:systematic-debugging` — do not proceed to Step 4 with a
known-broken feature.

- [ ] **Step 4: Clean up test data**

Via `mcp__supabase__execute_sql`, delete every order created during
Step 3's verification (and their `order_items`/`order_item_modifiers`,
which cascade on order delete per the schema's `on delete cascade`):

```sql
delete from public.orders where id in ('<order id 1>', '<order id 2>', '<order id 3>');
```

If any loyalty points were redeemed during testing, restore the test
customer's `profiles.loyalty_points_balance` to its pre-test value and
delete the test `loyalty_transactions` row(s), so the account is clean
for future sessions.

- [ ] **Step 5: Update `CLAUDE.md`**

Add a new section (or extend "Customer ordering flow"/"Staff pages")
documenting: Orders are now real Supabase data (migrations `0014` +
the already-existing `0005`-`0007`) with Realtime for logged-in
customers/staff and polling for guests (with the reasoning — RLS/
Realtime visibility, not a missed feature); the `place_order`/
`get_order_for_tracking` RPCs and why each needed to be a narrowly-scoped
function rather than a broad RLS policy; the real Cash payment flow
(self-checkout "Awaiting Payment" vs. POS "collected immediately");
Stripe/VNPay now disabled+tooltip in Checkout pending their own specs.
Update "Building the rest" to reflect Orders-core as done, Staff accounts
next, and Stripe/VNPay as the two follow-up specs to this one.

- [ ] **Step 6: Update `daily.md`**

Summarize this session's Orders work; set "Next session starts here" to
either sub-project #4 (Staff accounts) or the Stripe follow-up spec,
whichever the user wants to do next — note both are valid next steps per
the agreed sequencing, don't assume which one without asking.

- [ ] **Step 7: Commit the docs**

```bash
git add CLAUDE.md daily.md
git commit -m "Document real orders + realtime (core, cash-only) as shipped"
```

- [ ] **Step 8: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete
this work." Follow `superpowers:finishing-a-development-branch` — verify
tests, detect environment (normal repo, direct `main` work, same as
every prior feature this session), and since there's nothing to
merge/PR (already on `main`, already pushed), report that directly.
