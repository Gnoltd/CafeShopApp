# Per-Item Kitchen Status (KDS) — Design

## Problem

`orders.status` is the only place kitchen progress lives today
(`paid → preparing → ready → served`). A single order can hold several
line items — most visibly a shared table round, since
`docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md`
confirmed the table cart itself is already server-shared/live-synced
across every phone at a table (not the thing being changed here). One
tap on the KDS board ("Start Preparing" / "Mark Ready" / "Complete") or
on a table's "Mark Served" button advances *every* item in that order
at once. There is no way for the kitchen to say "this one drink is
ready, the other three aren't yet" — the whole round only ever moves as
a block. That earlier design explicitly parked this
("Per-item KDS ticking... explicitly parked as a future follow-up") as
out of scope; this doc is that follow-up.

## Goals

1. Each `order_items` row gets its own kitchen-stage status —
   `preparing → ready → served` — independently tickable by staff on
   the KDS board, for every order type (dine-in table rounds, pickup,
   POS) — one schema, one board, no per-type branching.
2. `orders.status` stays the single source of truth for the columns the
   KDS board already groups by (`paid`/`preparing`/`ready`) and for
   every downstream trigger that depends on it
   (`complete_order_when_served_and_paid`, `sync_table_occupancy`,
   payment webhooks) — it becomes a **derived roll-up** of its items'
   statuses instead of something staff sets directly, but nothing that
   reads it needs to change.
3. A new item starts at `preparing` the moment its order is
   kitchen-visible (`paid` or later) — no separate "not started yet"
   per-item state, no extra tap to begin each item.
4. The table-level "Mark Served" action in `kitchen-tables-column.tsx`
   keeps its current one-tap-per-table UX; it now marks every item of
   that table's ready orders as served in one action instead of
   updating `orders.status` directly.

## Non-goals

- **Customer-visible per-item status.** `get_order_for_tracking` and the
  customer tracking page keep showing only the order's overall status.
  Nobody asked for this and it's a separate surface.
- **A per-item "start preparing" tap.** Decided in favor of items
  defaulting straight to `preparing` (Goal 3) — no `queued`/`not_started`
  item state.
- **Reordering or skipping stages per item** (e.g., jumping straight to
  `served`). Same trust model as today's order-level `advance()` — a
  staff-authenticated client can call the update with any target value;
  the UI only ever offers the forward-one-stage button, matching how
  `orders_update_staff` already works (no DB-level transition state
  machine exists for orders either).
- **Per-item revenue/prep-time analytics.** Out of scope; this is a KDS
  workflow change, not a reporting change.
- **Any change to how a table's shared cart works** (already shipped,
  see the 2026-08-28 design) or to payment/Check Bill flows.

## Data model

New enum + column, migration `0081`:

```sql
create type public.order_item_status as enum ('preparing', 'ready', 'served');

alter table public.order_items
  add column status order_item_status not null default 'preparing';
```

Existing rows (from before this migration) backfill to `'served'` if
their parent order is already `served`/`completed`, otherwise
`'preparing'` — a one-time `update` in the same migration, not a
default that would misrepresent already-finished orders as freshly
started.

## RLS

`order_items` currently has `order_items_select`/`order_items_insert`
only (migration `0005`) — no UPDATE policy exists at all, so staff
can't touch it yet. Add:

```sql
create policy "order_items_update_staff" on public.order_items for update
  using (public.current_user_role() in ('staff', 'manager', 'admin'))
  with check (public.current_user_role() in ('staff', 'manager', 'admin'));

revoke update on public.order_items from anon, authenticated;
grant update (status) on public.order_items to authenticated;
```

The column-level `grant` is required on top of the RLS policy —
`price`/`quantity`/`menu_item_id` etc. stay write-only through
`place_order`, matching the "`UPDATE` privilege is independent of
`SELECT`" lesson from migration `0049`. Per the live-grant gotcha
(root `CLAUDE.md`), check
`information_schema.role_routine_grants`/column privileges live right
after applying this migration — Supabase's platform auto-grant has
silently widened privileges here before.

## Roll-up trigger

A new trigger recomputes the parent order's status whenever an item's
status changes, reusing every existing downstream trigger unmodified:

```sql
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

create trigger on_order_item_status_change
  after update of status on public.order_items
  for each row
  execute function public.sync_order_status_from_items();
```

Because this issues a normal `update public.orders`, the existing
`complete_order_when_served_and_paid` (auto-completes when
served+paid) and `sync_table_occupancy` (frees the table on completion)
triggers fire exactly as they do today — zero changes needed to either.

The trigger only fires on item **UPDATE**, not INSERT: a fresh order's
items are already `preparing` at insert time (Goal 3), but the parent
order's status is left exactly as `place_order`/the payment webhook set
it (`paid`) until staff actually ticks the first item — preserving the
board's "New" (`paid`) column as "kitchen hasn't touched this order
yet," same meaning it has today.

## Query layer / frontend

- `getKitchenOrders` (`lib/supabase/orders-data.ts`): each `KdsOrderRow`
  item gains a `status: "preparing" | "ready" | "served"` field.
- New `advanceOrderItemStatus(supabase, itemId, nextStatus)` — a direct
  RLS-gated `order_items` update, same shape as the existing
  `advanceOrderStatus`.
- `hooks/useKitchenOrders.tsx`: add `advanceItem(itemId, nextStatus)`
  alongside the existing `advance`/`serveTable`. `serveTable(orderIds)`
  changes internally from looping `advanceOrderStatus(orderId, "served")`
  to bulk-updating every non-served item of those orders to `served`
  (one `.in("order_id", orderIds).neq("status", "served")` update) —
  the roll-up trigger then flips each order to `served` itself. Callers
  of `serveTable` (`kitchen-tables-column.tsx`) don't change at all.
- `components/staff/kitchen-board.tsx`: the single full-width action
  button at the bottom of each order card is removed. Each item row
  (currently plain text, lines 134-153) becomes a tappable control
  showing its own stage — a "Mark Ready" affordance while `preparing`,
  "Mark Served" while `ready`, a static checkmark/strikethrough once
  `served` (reusing the existing `line-through` treatment already used
  for the `ready`-column-wide state). Column grouping (`paid`/
  `preparing`/`ready`) is unchanged — still filters on `order.status`.
- `components/staff/kitchen-tables-column.tsx`: no changes to its own
  logic — `serveTable(readyOrderIds)` keeps the same call shape.

## Edge cases

- **Mixed-progress order card**: an order sits in the `preparing`
  column the whole time any one item is still `preparing`, even if
  three of four items are already `ready` — matches Goal 2 (order
  status = furthest-behind item), and staff can see each item's own tick
  state on the card to know what's actually left.
- **Table's bulk "Mark Served"**: only ever offered when
  `order.status === "ready"` (existing `readyOrderIds` filter,
  unchanged) — by that point every item in that order is already
  `ready` or `served` by definition of the roll-up, so the bulk update
  is a genuine "last mile" action, not a shortcut around unfinished
  items.
- **Order-level statuses this doesn't touch**: `pending_payment`
  (pre-kitchen), `cancelled`, `completed` — all set exactly as they are
  today; the roll-up trigger explicitly ignores orders in those states.

## Testing

No Deno/DB test harness exists in this project (per `supabase/CLAUDE.md`
— Edge Functions/RPCs are verified live). Verification plan:
1. Apply migration `0081` via Supabase MCP, then live-check
   `information_schema` grants on `order_items` (auto-re-grant gotcha).
2. Place a dine-in table round with 2+ items via the shared cart, confirm
   both items appear `preparing` on the KDS board under the "New"
   (`paid`) column.
3. Tick one item to `ready` — confirm the order card stays under
   "Preparing" (the other item still `preparing`) and the ticked item
   shows its own ready state.
4. Tick the remaining item to `ready` — confirm the whole order card
   moves to the "Ready" column automatically (no button tap on the
   card itself).
5. Use the table's bulk "Mark Served" — confirm all items flip to
   `served`, the order completes if already paid, and (for a Pay
   Later round) the order sits `served`/unpaid same as today.
6. Repeat steps 2-5 for a pickup order to confirm no dine-in-only
   branching crept in.
7. Verify at the deployed Vercel URL, per this project's standing
   convention — not just `npm run dev`.
