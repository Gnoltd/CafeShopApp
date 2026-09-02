# Per-Item Kitchen Status (KDS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let kitchen staff tick each item within an order (a drink, a food item) through `preparing → ready → served` independently, instead of the whole order/round only ever advancing as one block.

**Architecture:** A new `order_items.status` enum column (`preparing/ready/served`, default `preparing`) is the new source of truth for kitchen progress. A Postgres trigger (`sync_order_status_from_items`) recomputes the parent `orders.status` every time an item's status changes — `orders.status` becomes a derived roll-up instead of something staff set directly, so every existing downstream trigger (`complete_order_when_served_and_paid`, `sync_table_occupancy`) and every payment webhook keeps working unmodified. The query layer (`lib/supabase/order-mapping.ts`, `lib/supabase/order-kds.ts`) surfaces each item's `id`/`status` and gains two new direct-update functions (`advanceOrderItemStatus`, `markOrderItemsServed`). `hooks/useKitchenOrders.tsx` replaces its order-level `advance()` with an item-level `advanceItem()`, reworks the table-wide `serveTable()` to bulk-update items instead of orders, and starts watching `order_items` Realtime changes (an item tick that doesn't flip the parent order's own status never shows up as an `orders` change). `components/staff/kitchen-board.tsx` replaces its one full-width per-order button with a per-item tick control on every line item.

**Tech Stack:** Next.js/TypeScript, Supabase Postgres (migrations via the Supabase MCP `apply_migration` tool), Vitest for `lib/supabase/*.ts` and `hooks/*.ts`, next-intl for `en`/`vi` copy (no new keys needed — reuses existing `markReady`/`markServed`).

**Spec:** `docs/superpowers/specs/2026-09-02-per-item-kitchen-status-design.md`

## Global Constraints

- Query-layer functions in `lib/supabase/*.ts` take `SupabaseClient` as their first argument (DI'd, testable with a mocked client) — matches the existing pattern in `order-kds.ts`.
- Migrations apply live via the Supabase MCP `apply_migration` tool (project `qhiypdqnrnzndxdwqxbx`), verified afterward via `execute_sql`.
- The roll-up trigger only touches `orders.status` while it's currently `paid`, `preparing`, `ready`, or `served` — never `pending_payment`, `cancelled`, or `completed` (spec Data model / Roll-up trigger sections). Do not weaken this guard.
- Do not modify `complete_order_when_served_and_paid` (migration `0022`) or `sync_table_occupancy` (migration `0073`'s redefinition) — this feature works precisely because both keep firing unmodified off a plain `orders.status` UPDATE, regardless of what issues that UPDATE.
- Per this project's documented live-grant gotcha, any `revoke`/`grant` in a migration must be checked live against `information_schema` afterward, not assumed correct from the migration text.
- Applies uniformly to every order type (dine-in, pickup, POS) — no order-type branching anywhere in this plan.
- Customer-facing order tracking (`get_order_for_tracking`, `lib/supabase/order-mapping.ts`'s `mapOrderRow`/`OrderForTracking`) is explicitly out of scope — do not add item status there (spec Non-goals).
- Any code deleted for being newly-unused (e.g. `advanceOrderStatus` once nothing calls it) must be deleted completely, not commented out or left with a `_` prefix — matches this project's stated convention.
- Commit after each task (no feature branch), matching this project's established convention.
- Verification is against the deployed Vercel URL, not `npm run dev` — local `build`/`tsc`/`vitest` are for fast feedback only.

---

### Task 1: Migration — `order_items.status` + roll-up trigger

**Files:**
- Create: `supabase/migrations/0082_order_item_status.sql`

**Interfaces:**
- Produces: enum `public.order_item_status` (`preparing`/`ready`/`served`); `public.order_items.status` column (not null, default `preparing`); RLS policy `order_items_update_staff`; trigger `on_order_item_status_change` calling `public.sync_order_status_from_items()`; `public.order_items` added to the `supabase_realtime` publication.

- [x] **Step 1: Write the migration file**

```sql
-- 0082_order_item_status.sql
-- Per-item kitchen status. Today order_items has no status at all --
-- orders.status is the only place kitchen progress lives, so a whole
-- order (e.g. a table round with several drinks) can only ever advance
-- as one block. This adds order_items.status and makes orders.status a
-- derived roll-up of its items, so every existing downstream trigger
-- (complete_order_when_served_and_paid, sync_table_occupancy) and every
-- payment webhook keeps working off orders.status unmodified. See
-- docs/superpowers/specs/2026-09-02-per-item-kitchen-status-design.md.

create type public.order_item_status as enum ('preparing', 'ready', 'served');

alter table public.order_items
  add column status public.order_item_status not null default 'preparing';

-- Backfill: an item under an order that already reached served/completed
-- before this migration is itself already served -- a fresh 'preparing'
-- default would misrepresent already-finished orders as freshly started.
update public.order_items oi
set status = 'served'
from public.orders o
where o.id = oi.order_id
  and o.status in ('served', 'completed');

-- order_items previously had no UPDATE policy at all (0005 only granted
-- select/insert), so staff could not touch it. This staff-only policy
-- is paired with a column-scoped grant below -- UPDATE privilege is
-- independent of SELECT/RLS (the lesson from migration 0049), so a
-- broad table-level grant inherited from schema defaults would let
-- staff overwrite price/quantity/menu_item_id too if left ungated.
create policy "order_items_update_staff" on public.order_items for update
  using (public.current_user_role() in ('staff', 'manager', 'admin'))
  with check (public.current_user_role() in ('staff', 'manager', 'admin'));

-- Revoke from both anon and authenticated (not just authenticated) --
-- matches this project's established pattern (migration 0047): a
-- column-level grant can't narrow an already-broader table-level grant
-- inherited from Supabase's schema defaults, so the blanket grant must
-- be revoked from every role it was given to before re-granting narrow.
revoke update on public.order_items from anon, authenticated;
grant update (status) on public.order_items to authenticated;

-- Recomputes the parent order's status whenever an item's status
-- changes. Only fires on order_items UPDATE, not INSERT: a fresh
-- order's items already default to 'preparing' at insert time, but the
-- parent order is left exactly as place_order/the payment webhook set
-- it (e.g. 'paid') until staff actually ticks the first item --
-- preserving the KDS board's "New" column as "kitchen hasn't touched
-- this order yet."
create or replace function public.sync_order_status_from_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := new.order_id;
  v_current_status order_status;
  v_new_status order_status;
begin
  select status into v_current_status from public.orders where id = v_order_id;

  -- Only orders actively moving through the kitchen are item-derived.
  -- pending_payment (not kitchen-visible yet), cancelled, and completed
  -- are set by other paths and must not be overwritten here.
  if v_current_status not in ('paid', 'preparing', 'ready', 'served') then
    return new;
  end if;

  select case
    when bool_and(status = 'served') then 'served'
    when bool_or(status = 'preparing') then 'preparing'
    else 'ready'
  end into v_new_status
  from public.order_items
  where order_id = v_order_id;

  update public.orders set status = v_new_status
    where id = v_order_id and status is distinct from v_new_status;

  return new;
end;
$$;

drop trigger if exists on_order_item_status_change on public.order_items;
create trigger on_order_item_status_change
  after update of status on public.order_items
  for each row
  execute function public.sync_order_status_from_items();

alter publication supabase_realtime add table public.order_items;
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `order_item_status` and the SQL above.

- [x] **Step 3: Verify**

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'order_items' and column_name = 'status';
```
Expected: one row, `data_type` = `USER-DEFINED` (enum), `column_default` = `'preparing'::order_item_status`.

```sql
select tablename, policyname, cmd from pg_policies where tablename = 'order_items';
```
Expected: `order_items_select`/`order_items_insert` (existing) plus the new `order_items_update_staff` with `cmd = 'UPDATE'`.

```sql
select grantee, privilege_type, column_name
from information_schema.role_column_grants
where table_name = 'order_items' and privilege_type = 'UPDATE';
```
Expected: exactly one row, `grantee = 'authenticated'`, `column_name = 'status'` — no other column, no `PUBLIC`/`anon`.

```sql
select tgname from pg_trigger where tgrelid = 'public.order_items'::regclass and not tgisinternal;
```
Expected: `on_order_item_status_change` present.

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_items';
```
Expected: one row.

Behavioral check of the roll-up trigger, run inside a transaction so nothing real is left changed — pick any existing row from `public.orders` with `order_type = 'pickup'` and at least 2 `order_items` (or use a `select id from orders where ... limit 1` first to find one):

```sql
begin;

-- substitute a real order id with 2+ items, temporarily forced to 'paid'
-- with both its items forced to 'preparing' so the scenario is known
update public.orders set status = 'paid' where id = '<order-id>';
update public.order_items set status = 'preparing' where order_id = '<order-id>';

-- tick one item to 'ready' -- the trigger fires on this UPDATE and
-- recomputes the parent order
update public.order_items set status = 'ready'
  where order_id = '<order-id>' and id = (select id from order_items where order_id = '<order-id>' limit 1);

select status from public.orders where id = '<order-id>';
-- Expected: 'preparing' if the other item is still 'preparing', else 'ready'

update public.order_items set status = 'served' where order_id = '<order-id>';
select status from public.orders where id = '<order-id>';
-- Expected: 'served'

rollback;
```

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0082_order_item_status.sql
git commit -m "Add order_items.status with a roll-up trigger deriving orders.status"
```

---

### Task 2: Query layer — item id/status + advance/bulk-serve functions

**Files:**
- Modify: `lib/supabase/order-mapping.ts`
- Modify: `lib/supabase/order-kds.ts`
- Modify: `lib/supabase/orders-data.ts`
- Test: `lib/supabase/order-kds.test.ts`

**Interfaces:**
- Consumes: migration `0082`'s `order_items.status` column (Task 1).
- Produces: `OrderItemStatus` type (`"preparing" | "ready" | "served"`); `KdsOrderItemRow` gains `id: string` and `status: OrderItemStatus`; `advanceOrderItemStatus(supabase, itemId, newStatus)`; `markOrderItemsServed(supabase, orderIds)`. `advanceOrderStatus` is removed (dead code once Task 3 rewrites its only caller).

- [x] **Step 1: Write the failing tests**

Replace the full contents of `lib/supabase/order-kds.test.ts` (this keeps the existing `confirmTableCashPayment`/`markTableCashPayment` blocks verbatim and adds the two new ones plus the new imports):

```ts
import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmTableCashPayment, markTableCashPayment, advanceOrderItemStatus, markOrderItemsServed } from "./order-kds"

describe("confirmTableCashPayment", () => {
  it("calls confirm_table_cash_payment with the table id and returns the row count", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: 3, error: null }))
    const supabase = { rpc } as unknown as SupabaseClient

    const result = await confirmTableCashPayment(supabase, "table-1")

    expect(rpc).toHaveBeenCalledWith("confirm_table_cash_payment", { p_table_id: "table-1" })
    expect(result).toBe(3)
  })

  it("throws on error", async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: null, error: new Error("not_authorized") })) } as unknown as SupabaseClient
    await expect(confirmTableCashPayment(supabase, "table-1")).rejects.toThrow("not_authorized")
  })
})

describe("markTableCashPayment", () => {
  it("updates every unset-method pending order on the table to cash", async () => {
    const is = vi.fn(() => Promise.resolve({ error: null }))
    const eq2 = vi.fn(() => ({ is }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const update = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await markTableCashPayment(supabase, "table-1")

    expect(from).toHaveBeenCalledWith("orders")
    expect(update).toHaveBeenCalledWith({ payment_method: "cash" })
    expect(eq1).toHaveBeenCalledWith("table_id", "table-1")
    expect(eq2).toHaveBeenCalledWith("payment_status", "pending")
    expect(is).toHaveBeenCalledWith("payment_method", null)
  })

  it("throws on error", async () => {
    const is = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const eq2 = vi.fn(() => ({ is }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const update = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(markTableCashPayment(supabase, "table-1")).rejects.toThrow("not_authorized")
  })
})

describe("advanceOrderItemStatus", () => {
  it("updates the item's status by id", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await advanceOrderItemStatus(supabase, "item-1", "ready")

    expect(from).toHaveBeenCalledWith("order_items")
    expect(update).toHaveBeenCalledWith({ status: "ready" })
    expect(eq).toHaveBeenCalledWith("id", "item-1")
  })

  it("throws on error", async () => {
    const eq = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(advanceOrderItemStatus(supabase, "item-1", "ready")).rejects.toThrow("not_authorized")
  })
})

describe("markOrderItemsServed", () => {
  it("bulk-updates every non-served item across the given orders", async () => {
    const neq = vi.fn(() => Promise.resolve({ error: null }))
    const inFn = vi.fn(() => ({ neq }))
    const update = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await markOrderItemsServed(supabase, ["order-1", "order-2"])

    expect(from).toHaveBeenCalledWith("order_items")
    expect(update).toHaveBeenCalledWith({ status: "served" })
    expect(inFn).toHaveBeenCalledWith("order_id", ["order-1", "order-2"])
    expect(neq).toHaveBeenCalledWith("status", "served")
  })

  it("does nothing when given no order ids", async () => {
    const from = vi.fn()
    const supabase = { from } as unknown as SupabaseClient

    await markOrderItemsServed(supabase, [])

    expect(from).not.toHaveBeenCalled()
  })

  it("throws on error", async () => {
    const neq = vi.fn(() => Promise.resolve({ error: new Error("not_authorized") }))
    const inFn = vi.fn(() => ({ neq }))
    const update = vi.fn(() => ({ in: inFn }))
    const from = vi.fn(() => ({ update }))
    const supabase = { from } as unknown as SupabaseClient

    await expect(markOrderItemsServed(supabase, ["order-1"])).rejects.toThrow("not_authorized")
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/supabase/order-kds.test.ts`
Expected: FAIL — `advanceOrderItemStatus`/`markOrderItemsServed` are not exported yet.

- [x] **Step 3: Extend `order-mapping.ts` with item id/status**

In `lib/supabase/order-mapping.ts`, add the new type and extend `OrderRow`/`ORDER_SELECT`:

```ts
export type RealOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "served" | "completed" | "cancelled"
export type RealOrderType = "pickup" | "dine_in"
export type OrderType = "pickup" | "dine-in"
export type RealPaymentMethod = "stripe" | "cash" | "vnpay"
export type RealOrderItemStatus = "preparing" | "ready" | "served"
```

Replace the `OrderRow` type's `order_items` field and `ORDER_SELECT`:

```ts
export type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  tax_amount: number
  total: number
  table_id: string | null
  payment_status: string
  payment_method: RealPaymentMethod | null
  tables: { table_number: string } | null
  order_items: {
    id: string
    menu_item_id: string
    menu_items: { name_vi: string; name_en: string }
    quantity: number
    unit_price: number
    note: string | null
    status: RealOrderItemStatus
  }[]
}

export const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, tax_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( id, menu_item_id, quantity, unit_price, note, status, menu_items ( name_vi, name_en ) )
`
```

`mapOrderRow`/`OrderForTracking`/`OrderForTrackingItem` (customer-facing tracking) stay exactly as they are — they simply don't read the new `id`/`status` fields off `order_items`, matching the spec's non-goal of leaving customer tracking untouched.

- [x] **Step 4: Rewrite `order-kds.ts`**

Replace the full contents of `lib/supabase/order-kds.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type OrderType,
  type RealOrderStatus,
  type RealOrderItemStatus,
  type RealPaymentMethod,
  type OrderRow,
  ORDER_SELECT,
  fromRealOrderType,
} from "./order-mapping"

export type OrderItemStatus = RealOrderItemStatus
export type KdsOrderItemRow = { id: string; nameVi: string; nameEn: string; quantity: number; note: string | null; status: OrderItemStatus }
export type KdsOrderRow = {
  id: string
  orderType: OrderType
  table?: string
  tableId?: string
  status: RealOrderStatus
  paymentStatus: string
  paymentMethod: RealPaymentMethod | null
  createdAt: number
  items: KdsOrderItemRow[]
  total: number
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
      id: oi.id,
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      note: oi.note,
      status: oi.status,
    })),
    total: row.total,
  }
}

export async function getKitchenOrders(supabase: SupabaseClient): Promise<KdsOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("status", ["paid", "preparing", "ready", "served"])
    .order("created_at")
  if (error) throw error
  return ((data ?? []) as unknown as OrderRow[]).map(mapKdsRow)
}

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

// Advances a single item -- the KDS card's per-item tick control.
export async function advanceOrderItemStatus(
  supabase: SupabaseClient,
  itemId: string,
  newStatus: OrderItemStatus
): Promise<void> {
  const { error } = await supabase.from("order_items").update({ status: newStatus }).eq("id", itemId)
  if (error) throw error
}

// Bulk-marks every not-yet-served item across the given orders as
// served in one call -- backs the table's "Mark Served" bulk action.
// The 0082 roll-up trigger then flips each order to 'served' itself.
export async function markOrderItemsServed(supabase: SupabaseClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return
  const { error } = await supabase
    .from("order_items")
    .update({ status: "served" })
    .in("order_id", orderIds)
    .neq("status", "served")
  if (error) throw error
}

export async function confirmCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: "paid", payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

export async function confirmServedCashPayment(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ payment_status: "paid" }).eq("id", orderId)
  if (error) throw error
}

export async function confirmTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<number> {
  const { data, error } = await supabase.rpc("confirm_table_cash_payment", { p_table_id: tableId })
  if (error) throw error
  return data as number
}

// I-3: a table round placed via the shared-table-ordering flow starts
// with payment_method null and only gets one once someone taps Check
// Bill. If guests never tap it, staff had no way to settle the table
// from KDS at all. Plain multi-row update, not an RPC -- verified live
// that orders_update_staff RLS already allows staff/manager/admin to
// UPDATE orders directly, matching the existing single-order
// setOrderPaymentMethodCash (order-tracking.ts) which does exactly
// this pattern for one order.
export async function markTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ payment_method: "cash" })
    .eq("table_id", tableId)
    .eq("payment_status", "pending")
    .is("payment_method", null)
  if (error) throw error
}
```

This drops `advanceOrderStatus` — after Task 3 rewrites `hooks/useKitchenOrders.tsx`, nothing calls it any more.

- [x] **Step 5: Update `orders-data.ts`'s re-exports**

In `lib/supabase/orders-data.ts`, replace these two lines:

```ts
export type { KdsOrderItemRow, KdsOrderRow } from "./order-kds"
export {
  getKitchenOrders,
  getPendingPaymentOrders,
  advanceOrderStatus,
  confirmCashPayment,
  confirmServedCashPayment,
  confirmTableCashPayment,
  markTableCashPayment,
} from "./order-kds"
```

with:

```ts
export type { KdsOrderItemRow, KdsOrderRow, OrderItemStatus } from "./order-kds"
export {
  getKitchenOrders,
  getPendingPaymentOrders,
  advanceOrderItemStatus,
  markOrderItemsServed,
  confirmCashPayment,
  confirmServedCashPayment,
  confirmTableCashPayment,
  markTableCashPayment,
} from "./order-kds"
```

(`advanceOrderStatus` is dropped from both the type and value export lists since Task 3 stops importing it.)

- [x] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/order-kds.test.ts`
Expected: PASS, all describe blocks.

- [x] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `order-mapping.ts`/`order-kds.ts`/`orders-data.ts`. (`hooks/useKitchenOrders.tsx`/`kitchen-board.tsx` will still show errors referencing `advanceOrderStatus`/`NEXT_STATUS`/`onAdvance` until Tasks 3–4 land — that's expected at this point in the plan.)

- [x] **Step 8: Commit**

```bash
git add lib/supabase/order-mapping.ts lib/supabase/order-kds.ts lib/supabase/orders-data.ts lib/supabase/order-kds.test.ts
git commit -m "Add per-item status to the KDS query layer"
```

---

### Task 3: Hook — `advanceItem`/reworked `serveTable` + Realtime on `order_items`

**Files:**
- Modify: `hooks/useKitchenOrders.tsx`
- Test: `hooks/useKitchenOrders.test.ts` (new)

**Interfaces:**
- Consumes: `advanceOrderItemStatus`, `markOrderItemsServed`, `OrderItemStatus`, `KdsOrderRow` (Task 2).
- Produces: `willCompleteOrderOnAdvance(order: KdsOrderRow, itemId: string): boolean` (pure, exported, tested); `KitchenOrdersContextValue.advanceItem(orderId: string, itemId: string): Promise<void>` (replaces `advance`); `serveTable` keeps its existing signature (`orderIds: string[]`) but now bulk-updates items.

- [x] **Step 1: Write the failing test**

Create `hooks/useKitchenOrders.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { willCompleteOrderOnAdvance } from "./useKitchenOrders"
import type { KdsOrderRow, OrderItemStatus } from "@/lib/supabase/order-kds"

function makeOrder(itemStatuses: OrderItemStatus[]): KdsOrderRow {
  return {
    id: "order-1",
    orderType: "pickup",
    status: "ready",
    paymentStatus: "paid",
    paymentMethod: "cash",
    createdAt: 0,
    total: 0,
    items: itemStatuses.map((status, i) => ({
      id: `item-${i}`,
      nameVi: "x",
      nameEn: "x",
      quantity: 1,
      note: null,
      status,
    })),
  }
}

describe("willCompleteOrderOnAdvance", () => {
  it("returns true when every other item is already served", () => {
    const order = makeOrder(["served", "ready"])
    expect(willCompleteOrderOnAdvance(order, "item-1")).toBe(true)
  })

  it("returns false when another item is still preparing", () => {
    const order = makeOrder(["preparing", "ready"])
    expect(willCompleteOrderOnAdvance(order, "item-1")).toBe(false)
  })

  it("returns true for a single-item order", () => {
    const order = makeOrder(["ready"])
    expect(willCompleteOrderOnAdvance(order, "item-0")).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run hooks/useKitchenOrders.test.ts`
Expected: FAIL — `willCompleteOrderOnAdvance` is not exported yet (and `hooks/useKitchenOrders.tsx` itself won't compile yet either, since Task 2 already removed `advanceOrderStatus` from `orders-data.ts`).

- [x] **Step 3: Rewrite `hooks/useKitchenOrders.tsx`**

Replace the full file contents:

```tsx
"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  advanceOrderItemStatus,
  markOrderItemsServed,
  confirmCashPayment as confirmCashPaymentQuery,
  confirmServedCashPayment as confirmServedCashPaymentQuery,
  confirmTableCashPayment as confirmTableCashPaymentQuery,
  markTableCashPayment as markTableCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type OrderItemStatus,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"

// Derived from the real order_status enum (not hand-typed) so it can never
// silently drift from it -- was a second, independently-declared status
// vocabulary until this refactor.
export type KdsStatus = Extract<RealOrderStatus, "paid" | "preparing" | "ready">
export type { KdsOrderRow as KdsOrder }

const NEXT_ITEM_STATUS: Record<OrderItemStatus, OrderItemStatus | null> = {
  preparing: "ready",
  ready: "served",
  served: null,
}

// Pure so it's directly testable: given the order this item belongs to,
// would advancing this one item to "served" leave every item in the
// order served? Order completion (and the completedCount/avgTimeLabel
// stats below) is a derived side effect of the *last* item being
// ticked -- it can happen from either a single advanceItem call or a
// table-wide serveTable bulk call, so both consult this.
export function willCompleteOrderOnAdvance(order: KdsOrderRow, itemId: string): boolean {
  return order.items.every((item) => item.id === itemId || item.status === "served")
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

type KitchenOrdersContextValue = {
  orders: KdsOrderRow[]
  pendingPaymentOrders: KdsOrderRow[]
  isLoading: boolean
  isRealtimeConnected: boolean
  advanceItem: (orderId: string, itemId: string) => Promise<void>
  serveTable: (orderIds: string[]) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
  confirmTableCashPayment: (tableId: string) => Promise<void>
  markTableCashPayment: (tableId: string) => Promise<void>
  markCashPayment: (orderId: string) => Promise<void>
  undoCashPayment: (orderId: string) => Promise<void>
  completedCount: number
  avgTimeLabel: string
}

const KitchenOrdersContext = createContext<KitchenOrdersContextValue | null>(null)

export function KitchenOrdersProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [orders, setOrders] = useState<KdsOrderRow[]>([])
  const [pendingPaymentOrders, setPendingPaymentOrders] = useState<KdsOrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [completedDurations, setCompletedDurations] = useState<number[]>([])

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

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // Staff sees every order (orders_select_staff has no per-row filtering
  // concerns), so a plain refetch on any change is both correct and
  // simple -- the board is small enough this is cheap. order_items is
  // also watched now: an item tick that doesn't flip the parent order's
  // own status (e.g. one of four drinks going ready) only ever shows up
  // as an order_items change, never an orders change.
  useRealtimeChannel(
    supabase,
    "kitchen-orders-changes",
    [
      { table: "orders", event: "*", onChange: () => refetch() },
      { table: "order_items", event: "*", onChange: () => refetch() },
    ],
    { onStatusChange: (status) => setIsRealtimeConnected(status === "SUBSCRIBED") }
  )

  async function advanceItem(orderId: string, itemId: string) {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const item = order.items.find((i) => i.id === itemId)
    if (!item) return
    const next = NEXT_ITEM_STATUS[item.status]
    if (!next) return
    if (next === "served" && willCompleteOrderOnAdvance(order, itemId)) {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await advanceOrderItemStatus(supabase, itemId, next)
  }

  async function serveTable(orderIds: string[]) {
    const ordersToServe = orders.filter((o) => orderIds.includes(o.id) && o.status === "ready")
    for (const order of ordersToServe) {
      setCompletedCount((count) => count + 1)
      setCompletedDurations((durations) => [...durations, Date.now() - order.createdAt])
    }
    await markOrderItemsServed(
      supabase,
      ordersToServe.map((o) => o.id)
    )
  }

  async function confirmCashPayment(orderId: string) {
    const order = orders.find((o) => o.id === orderId) ?? pendingPaymentOrders.find((o) => o.id === orderId)
    if (order?.status === "served") {
      await confirmServedCashPaymentQuery(supabase, orderId)
    } else {
      await confirmCashPaymentQuery(supabase, orderId)
    }
  }

  async function confirmTableCashPayment(tableId: string) {
    await confirmTableCashPaymentQuery(supabase, tableId)
  }

  async function markTableCashPayment(tableId: string) {
    await markTableCashPaymentQuery(supabase, tableId)
  }

  async function markCashPayment(orderId: string) {
    await setOrderPaymentMethodCash(supabase, orderId)
  }

  async function undoCashPayment(orderId: string) {
    await changeOrderPaymentMethod(supabase, orderId, null)
  }

  const avgTimeLabel =
    completedDurations.length === 0
      ? "--:--"
      : formatDuration(completedDurations.reduce((sum, d) => sum + d, 0) / completedDurations.length)

  return (
    <KitchenOrdersContext.Provider
      value={{
        orders,
        pendingPaymentOrders,
        isLoading,
        isRealtimeConnected,
        advanceItem,
        serveTable,
        confirmCashPayment,
        confirmTableCashPayment,
        markTableCashPayment,
        markCashPayment,
        undoCashPayment,
        completedCount,
        avgTimeLabel,
      }}
    >
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

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run hooks/useKitchenOrders.test.ts`
Expected: PASS, all 3 cases.

- [x] **Step 5: Commit**

```bash
git add hooks/useKitchenOrders.tsx hooks/useKitchenOrders.test.ts
git commit -m "Replace order-level advance() with per-item advanceItem() in useKitchenOrders"
```

---

### Task 4: KDS board UI — per-item tick controls

**Files:**
- Modify: `components/staff/kitchen-board.tsx`
- Modify: `components/staff/kitchen-display.tsx`

**Interfaces:**
- Consumes: `useKitchenOrders().advanceItem` (Task 3), `KdsOrder.items[].id`/`.status` (Task 2).
- Produces: `KitchenBoard`'s prop changes from `onAdvance: (orderId: string) => void` to `onAdvanceItem: (orderId: string, itemId: string) => void`.

- [x] **Step 1: Rewrite `components/staff/kitchen-board.tsx`**

Replace the full file contents:

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, PackageCheck, Utensils, ShoppingBag, ListTodo, RefreshCw, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatOrderId } from "@/lib/format"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { KitchenTablesColumn } from "@/components/staff/kitchen-tables-column"
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

type BoardColumnKey = "paid" | "preparing" | "ready" | "tables"

export function formatElapsed(createdAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function KitchenBoard({
  orders,
  now,
  onAdvanceItem,
}: {
  orders: KdsOrder[]
  now: number
  onAdvanceItem: (orderId: string, itemId: string) => void
}) {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const [activeColumn, setActiveColumn] = useState<BoardColumnKey>("paid")

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 md:grid md:grid-cols-2 lg:grid-cols-4">
      <SegmentedControl
        variant="tabs"
        layoutId="kds-column-pill"
        className="shrink-0 md:hidden"
        value={activeColumn}
        onChange={setActiveColumn}
        options={[
          { value: "paid", label: t("columnNew") },
          { value: "preparing", label: t("columnPreparing") },
          { value: "ready", label: t("columnReady") },
          { value: "tables", label: t("columnTables") },
        ]}
      />
      {COLUMNS.map((column) => {
        const columnOrders = orders.filter((o) => o.status === column.status)
        const Icon = column.icon
        return (
          <section
            key={column.status}
            className={cn(
              "nb-border-sm min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-muted",
              activeColumn === column.status ? "flex" : "hidden",
              "md:h-full md:flex"
            )}
          >
            <header className={cn("flex shrink-0 items-center justify-between p-4 text-white", column.headerClass)}>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                {t(column.labelKey)}
                <span className="rounded bg-white/20 px-2 py-0.5 text-sm">{columnOrders.length}</span>
              </h2>
              <Icon className={cn("h-5 w-5", column.iconClass)} />
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {columnOrders.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
              )}
              {columnOrders.map((order) => {
                const isReady = column.status === "ready"
                return (
                  <div key={order.id} className="nb-border-sm nb-shadow-sm rounded-xl bg-card">
                    <div
                      className={cn(
                        "flex items-start justify-between border-b p-3",
                        isReady && "bg-green-50 dark:bg-green-950/20"
                      )}
                    >
                      <div>
                        <h3 className="text-xl font-black text-card-foreground">#{formatOrderId(order.id)}</h3>
                        <span
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
                            order.orderType === "pickup"
                              ? "bg-primary text-primary-foreground"
                              : "border bg-muted text-card-foreground"
                          )}
                        >
                          {order.orderType === "pickup" ? (
                            <ShoppingBag className="h-3 w-3" />
                          ) : (
                            <Utensils className="h-3 w-3" />
                          )}
                          {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
                        </span>
                      </div>
                      <div className="text-right">
                        {isReady ? (
                          <div className="text-xl font-bold text-green-600">{t("doneLabel")}</div>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "text-xl font-bold",
                                column.status === "paid" && "text-primary",
                                column.status === "preparing" && "text-amber-600"
                              )}
                            >
                              {formatElapsed(order.createdAt, now)}
                            </div>
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              {column.status === "paid" ? t("elapsedTimeCaption") : t("preparingTimeCaption")}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 p-3">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="nb-border-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chip text-sm font-bold text-card-foreground">
                              {item.quantity}x
                            </div>
                            <div>
                              <p
                                className={cn(
                                  "font-bold text-card-foreground",
                                  item.status === "served" && "text-muted-foreground line-through decoration-muted-foreground"
                                )}
                              >
                                {locale === "vi" ? item.nameVi : item.nameEn}
                              </p>
                              {item.note && (
                                <p className="text-sm font-medium italic text-secondary">{item.note}</p>
                              )}
                            </div>
                          </div>
                          {item.status === "served" ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onAdvanceItem(order.id, item.id)}
                              className={cn(
                                "nb-press-sm nb-border-sm nb-shadow-sm flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-white",
                                item.status === "preparing" && "bg-amber-600",
                                item.status === "ready" && "bg-green-600"
                              )}
                            >
                              {item.status === "preparing" ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <PackageCheck className="h-3.5 w-3.5" />
                              )}
                              {item.status === "preparing" ? t("markReady") : t("markServed")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      <KitchenTablesColumn active={activeColumn === "tables"} />
    </div>
  )
}
```

This removes the old single full-width per-order button (was: "Start Preparing"/"Mark Ready"/"Complete" at the bottom of each card, gated off column status and hidden for dine-in orders in the Ready column) — replaced by a control on every line item, on every card, in every column. "Start Preparing" specifically is gone with no replacement: items already default to `preparing` at insert time (Task 1), so there's nothing left to "start." The dine-in-in-Ready-column special case is also gone: per-item ticking and the table's own bulk "Mark Served" button (`kitchen-tables-column.tsx`, unchanged) are two independent, coexisting ways to reach the same end state now.

- [x] **Step 2: Update `components/staff/kitchen-display.tsx`**

Replace the full file contents:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { KitchenStatsFooter } from "@/components/staff/kitchen-stats-footer"
import { KitchenBoard } from "@/components/staff/kitchen-board"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export function KitchenDisplay() {
  const { orders, pendingPaymentOrders, advanceItem, confirmCashPayment } = useKitchenOrders()
  const t = useTranslations("KitchenDisplay")
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  function handleAdvanceItem(orderId: string, itemId: string) {
    setError(null)
    advanceItem(orderId, itemId).catch(() => setError(t("updateError")))
  }

  function handleConfirmCashPayment(orderId: string) {
    setError(null)
    return confirmCashPayment(orderId).catch(() => setError(t("updateError")))
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      {error && (
        <p className="shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {pendingPaymentOrders.length > 0 && (
        <KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={handleConfirmCashPayment} />
      )}
      <div className="flex-1 overflow-hidden">
        <KitchenBoard orders={orders} now={now} onAdvanceItem={handleAdvanceItem} />
      </div>
      <KitchenStatsFooter orders={orders} now={now} />
    </div>
  )
}
```

- [x] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in `components/staff/`, `hooks/`, or `lib/supabase/`.

- [x] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new ones from Tasks 2–3 and every pre-existing test (nothing else in the suite touches `order_items`/KDS shapes).

- [x] **Step 5: Commit**

```bash
git add components/staff/kitchen-board.tsx components/staff/kitchen-display.tsx
git commit -m "Add per-item tick controls to the KDS board"
```

---

### Task 5: Live verification + close out the daily.md entry

**Files:**
- Modify: `daily.md`

**Interfaces:**
- Consumes: the deployed app at `https://phadincafe.vercel.app` (per this project's standing verification convention).

- [ ] **Step 1: Place a real dine-in table round with 2+ items**

Scan a table's QR (or use `/table/[qrToken]` directly with a known token from `test-accounts.md`), add 2 different items to the shared cart, place the round. Confirm it appears on `/staff/pos`'s KDS board.

- [ ] **Step 2: Confirm items start `preparing` under the "New" column**

On the KDS board, the new order's card should sit in the "New" (`paid`) column with both items showing a "Mark Ready" control (not a static checkmark) — confirms the migration's `preparing` default (Task 1) and the board's per-item rendering (Task 4).

- [ ] **Step 3: Tick one item and confirm partial progress**

Tap "Mark Ready" on one item only. Confirm: that item now shows a "Mark Served" control (or a checkmark, depending on whether you continue), the *other* item is unchanged, and the order card has moved to the "Preparing" column (the roll-up trigger fired because at least one item left `preparing`, but not every item is `ready` yet). Confirm this shows up on a **second browser/device** logged into the same KDS within a few seconds — this is the `order_items` Realtime subscription (Task 3) actually earning its keep, since the order's own `status` value only just changed once (paid→preparing), not on every tick.

- [ ] **Step 4: Tick the remaining item and confirm the column moves again**

Tick the second item to "Mark Ready". Confirm the whole order card moves to the "Ready" column with no button tap on the card itself — this is Goal 2 (order status = furthest-behind item) plus Goal 4 (all items ready → order ready) both holding.

- [ ] **Step 5: Use the table's bulk "Mark Served" and confirm completion**

From the KDS Tables column, tap "Mark Served" for that table. Confirm: both items flip to a served checkmark, the order disappears from the "Ready" column (moved to `served`), and — since this was a Pay Later round — it now sits `served`/unpaid exactly as it would have before this feature (Check Bill / cash confirm still work unchanged).

- [ ] **Step 6: Repeat for a pickup order**

Place a pickup order (any payment method), confirm the same preparing→ready→served per-item flow works identically with no table/dine-in-specific behavior, and that it still auto-completes correctly once served+paid.

- [ ] **Step 7: Update `daily.md`**

Open `daily.md`, find item 8 ("Per-item KDS ticking — design only, not yet planned or built."). Replace its text with:

```markdown
8. **Per-item KDS ticking — shipped and live-verified.** Design:
   `docs/superpowers/specs/2026-09-02-per-item-kitchen-status-design.md`;
   plan: `docs/superpowers/plans/2026-09-02-per-item-kitchen-status.md`.
   `order_items.status` (`preparing/ready/served`, migration `0082`) with
   a roll-up trigger deriving `orders.status` from its items — every
   existing completion/table-cleaning trigger needed zero changes. KDS
   board (`kitchen-board.tsx`) now shows a per-item tick control on every
   line item instead of one button per order; the table's bulk "Mark
   Served" (`kitchen-tables-column.tsx`) bulk-updates items instead of
   orders. Applies uniformly to dine-in/pickup/POS. Live-verified: partial
   item progress within an order, cross-device Realtime delivery of a
   tick that doesn't flip the order's own status, the "Ready" column
   auto-advancing once every item is ready, the table bulk-serve action,
   and a pickup order following the identical path.
```

- [ ] **Step 8: Commit**

```bash
git add daily.md
git commit -m "Close out per-item KDS ticking in daily.md after live verification"
```
