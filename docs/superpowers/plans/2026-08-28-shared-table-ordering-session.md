# Shared Table Ordering Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live, multi-device shared cart per dine-in table, a persistent running tab across however many rounds a table orders, and one aggregate "Check Bill" payment (Cash/Stripe/VNPay) that settles every unpaid round at once.

**Architecture:** Two new tables (`table_sessions`, `table_cart_items`) back a live-synced draft cart, read/written exclusively through guest-safe `security definer` RPCs (never direct PostgREST access — both tables carry RLS with no write policies). A table's `occupied` status now also flips on the *first cart item*, not just the first order — handled inside `add_cart_item`, with zero changes to the existing `sync_table_occupancy` order-insert trigger except a small addition that closes the `table_sessions` row when a table's last active order completes. Round submission (`place_table_round`) is a thin wrapper around the existing `place_order` RPC (now accepting an optional `tableSessionId`), always `payAt: 'later'`, so payment never happens per round. Aggregate payment (`checkout_table_session`) reuses the existing three-way Cash/Stripe/VNPay machinery, extended so one gateway session can cover every unpaid order under a session — `stripe-webhook`/`vnpay-ipn`/`vnpay-return` each gain an additive branch keyed on a `table_session_id` (Stripe: session metadata; VNPay: a `session:`-prefixed `vnp_TxnRef`) alongside their existing single-order logic, which is untouched. The customer-facing `/table/[qrToken]` screen is rebuilt into the whole ordering surface (menu + live cart + running tab + Check Bill); `/cart`/`/checkout` become pickup-only. The KDS table card gains an aggregate cash-confirm action.

**Tech Stack:** Next.js/TypeScript, Supabase Postgres (migrations via the Supabase MCP `apply_migration` tool), Supabase Edge Functions (Deno, raw `fetch`/Web Crypto, no SDKs), Vitest for `lib/supabase/*.ts`, next-intl for `en`/`vi` copy.

**Spec:** `docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md`

## Global Constraints

- Every new/changed translation key goes into **both** `messages/en.json` and `messages/vi.json` in the same task that introduces it.
- Query-layer functions in `lib/supabase/*.ts` take `SupabaseClient` as their first argument (DI'd, testable with a mocked client) — matches the existing pattern in `lib/supabase/order-tracking.ts`/`order-kds.ts`/`tables-data.ts`.
- Every new `security definer` function gets `revoke all on function ... from public;` followed by an explicit `grant execute ... to <roles>;` — and per this project's documented live-grant gotcha, Supabase's platform-level auto-grant on `CREATE FUNCTION` does **not** reliably respect that revoke. Task 6 is a mandatory live audit (`information_schema.role_routine_grants`) of every function this plan creates, with a follow-up migration if the platform over- or under-granted.
- Migrations apply live via the Supabase MCP `apply_migration` tool (project `qhiypdqnrnzndxdwqxbx`), verified afterward via `execute_sql`.
- Edge Functions deploy via the Supabase MCP `deploy_edge_function` tool, `verify_jwt: false` for every guest-callable function in this plan (matches `place-order`/`pay-order`).
- Commit after each task (no feature branch), matching this project's established convention.
- Verification is against the deployed Vercel URL, not `npm run dev` — local `build`/`tsc`/`vitest` are for fast feedback only. No Deno test harness exists in this project — Edge Function changes are verified live.
- Do not modify `handle_order_paid` (migration `0007`) or `complete_order_when_served_and_paid` (migration `0022`) — every new payment-status flip in this plan is a plain `UPDATE ... SET payment_status = 'paid'`, which both existing triggers already react to correctly per row.
- `place_order`'s full current body (migration `0068`) is the base every migration in Phase 1 builds on — do not reintroduce or diverge from its existing promo/loyalty/redemption/tax logic; Task 3 only adds one new field to it.
- New round submission (`place_table_round`) never passes `promoCode`, `redeemLoyaltyPoints`, or `redemptionIds` to `place_order` — those only ever apply once, at Check Bill, against the aggregate total (design doc Non-goals).

---

### Task 1: Migration — `table_sessions` + `table_cart_items` schema

**Files:**
- Create: `supabase/migrations/0070_table_sessions_schema.sql`

**Interfaces:**
- Produces: tables `public.table_sessions` (`id`, `table_id`, `status` — `active`/`abandoned`/`closed`, `payment_pending`, `checkout_promo_code`, `checkout_discount_amount`, `started_at`, `ended_at`) and `public.table_cart_items` (`id`, `table_session_id`, `menu_item_id`, `size_id`, `modifier_ids uuid[]`, `note`, `unit_price`, `quantity`, `updated_at`); `public.orders` gains nullable `table_session_id uuid references table_sessions(id)`. Both new tables have RLS enabled with a public **SELECT-only** policy (required for Realtime delivery — see the Step 1 comment) and no write policies at all (every write goes through the `security definer` RPCs added in Tasks 2–3, 5).

- [ ] **Step 1: Write the migration file**

```sql
-- 0070_table_sessions_schema.sql
-- Schema for the live shared table cart / running tab / aggregate
-- payment feature. See
-- docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md.
--
-- Both new tables get a public SELECT policy (using (true)) and
-- deliberately NO insert/update/delete policy. This differs from this
-- project's usual guest-safe pattern of "RPC only, zero direct
-- PostgREST access" -- that pattern alone is not enough here because
-- Supabase Realtime's postgres_changes delivery is itself RLS-gated: a
-- table with RLS enabled and zero SELECT policy delivers no change
-- events to ANY client, guest or not, which would silently break the
-- live-sync requirement this feature exists for. A public SELECT
-- policy is an acceptable trust level for this data (menu items,
-- quantities, notes for an active table's own order -- comparable
-- sensitivity to orders/order_items, which already have broad SELECT
-- policies); writes still only ever happen through the RPCs below, so
-- prices/quantities can never be client-forged the way orders/
-- order_items were before migration 0046.

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id),
  status text not null default 'active' check (status in ('active', 'abandoned', 'closed')),
  payment_pending boolean not null default false,
  checkout_promo_code text,
  checkout_discount_amount integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index table_sessions_table_id_idx on public.table_sessions (table_id);
-- Partial index: the only lookup this feature ever does is "the active
-- session for this table" -- at most one row can match by construction
-- (add_cart_item only creates a new session when none is active).
create unique index table_sessions_one_active_per_table_idx
  on public.table_sessions (table_id) where status = 'active';

alter table public.table_sessions enable row level security;

create policy "table_sessions_select_all" on public.table_sessions
  for select
  using (true);

create table public.table_cart_items (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  size_id uuid references public.menu_item_sizes(id),
  modifier_ids uuid[] not null default array[]::uuid[],
  note text,
  unit_price integer not null,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now()
);

create index table_cart_items_session_idx on public.table_cart_items (table_session_id);

alter table public.table_cart_items enable row level security;

create policy "table_cart_items_select_all" on public.table_cart_items
  for select
  using (true);

alter table public.orders add column table_session_id uuid references public.table_sessions(id);
create index orders_table_session_id_idx on public.orders (table_session_id) where table_session_id is not null;

alter publication supabase_realtime add table public.table_sessions;
alter publication supabase_realtime add table public.table_cart_items;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `table_sessions_schema` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select table_name from information_schema.tables where table_name in ('table_sessions', 'table_cart_items');
```
Expected: both rows present.

```sql
select tablename, policyname, cmd from pg_policies where tablename in ('table_sessions', 'table_cart_items');
```
Expected: exactly one `SELECT` policy per table, no `INSERT`/`UPDATE`/`DELETE` policies.

```sql
select column_name from information_schema.columns where table_name = 'orders' and column_name = 'table_session_id';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0070_table_sessions_schema.sql
git commit -m "Add table_sessions/table_cart_items schema for shared table ordering"
```

---

### Task 2: Migration — cart RPCs (`get_table_session`, `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`, `abandon_table_session`)

**Files:**
- Create: `supabase/migrations/0071_table_session_cart_rpcs.sql`

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: `get_table_session(p_table_id uuid) returns jsonb`; `add_cart_item(p_table_id uuid, p_menu_item_id uuid, p_size_id uuid, p_modifier_ids uuid[], p_note text, p_quantity integer) returns uuid`; `update_cart_item_quantity(p_cart_item_id uuid, p_quantity integer) returns void`; `remove_cart_item(p_cart_item_id uuid) returns void`; `abandon_table_session(p_table_id uuid) returns boolean`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0071_table_session_cart_rpcs.sql
-- Guest-safe RPCs for the live shared table cart. Every write goes
-- through these -- table_cart_items/table_sessions have no write RLS
-- policy at all (migration 0070). Prices are always server-computed
-- from menu_item_id/size_id/modifier_ids here, mirroring place_order's
-- existing pricing block -- a client-supplied price is never trusted,
-- even for a still-draft cart line.
--
-- add_cart_item's same-item-merges-quantity identity check requires
-- p_modifier_ids to already be sorted by the caller (mirrors
-- hooks/useCart.tsx's buildCartItemId, which also sorts before
-- building its identity key).

create or replace function public.get_table_session(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_result jsonb;
begin
  select * into v_session from public.table_sessions
    where table_id = p_table_id and status = 'active';

  if v_session.id is null then
    return jsonb_build_object('session', null, 'cartItems', '[]'::jsonb, 'rounds', '[]'::jsonb, 'unpaidTotal', 0);
  end if;

  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'paymentPending', v_session.payment_pending,
      'checkoutPromoCode', v_session.checkout_promo_code,
      'checkoutDiscountAmount', v_session.checkout_discount_amount
    ),
    'cartItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'menuItemId', ci.menu_item_id,
        'nameVi', mi.name_vi,
        'nameEn', mi.name_en,
        'sizeId', ci.size_id,
        'modifierIds', to_jsonb(ci.modifier_ids),
        'note', ci.note,
        'unitPrice', ci.unit_price,
        'quantity', ci.quantity
      ) order by ci.updated_at)
      from public.table_cart_items ci
      join public.menu_items mi on mi.id = ci.menu_item_id
      where ci.table_session_id = v_session.id
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'createdAt', extract(epoch from o.created_at) * 1000,
        'status', o.status,
        'paymentStatus', o.payment_status,
        'paymentMethod', o.payment_method,
        'subtotal', o.subtotal,
        'taxAmount', o.tax_amount,
        'total', o.total,
        'items', (
          select jsonb_agg(jsonb_build_object(
            'nameVi', mi2.name_vi, 'nameEn', mi2.name_en,
            'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'note', oi.note
          ))
          from public.order_items oi
          join public.menu_items mi2 on mi2.id = oi.menu_item_id
          where oi.order_id = o.id
        )
      ) order by o.created_at)
      from public.orders o
      where o.table_session_id = v_session.id
    ), '[]'::jsonb),
    'unpaidTotal', coalesce((
      select sum(total) from public.orders
      where table_session_id = v_session.id and payment_status = 'pending'
    ), 0)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_table_session(uuid) from public;
grant execute on function public.get_table_session(uuid) to anon, authenticated;

create or replace function public.add_cart_item(
  p_table_id uuid,
  p_menu_item_id uuid,
  p_size_id uuid,
  p_modifier_ids uuid[],
  p_note text,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_status public.table_occupancy_status;
  v_session_id uuid;
  v_menu_item record;
  v_size_delta integer := 0;
  v_modifier_delta integer := 0;
  v_unit_price integer;
  v_existing_id uuid;
  v_new_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select status into v_table_status from public.tables where id = p_table_id;
  if v_table_status is null then
    raise exception 'table_not_found';
  end if;
  if v_table_status = 'cleaning' then
    raise exception 'table_is_cleaning';
  end if;

  select id into v_session_id from public.table_sessions
    where table_id = p_table_id and status = 'active';

  if v_session_id is null then
    insert into public.table_sessions (table_id) values (p_table_id) returning id into v_session_id;
    update public.tables set status = 'occupied' where id = p_table_id and status = 'available';
  else
    if exists (select 1 from public.table_sessions where id = v_session_id and payment_pending) then
      raise exception 'payment_in_progress';
    end if;
  end if;

  select id, base_price, is_available into v_menu_item
    from public.menu_items where id = p_menu_item_id;
  if v_menu_item.id is null then
    raise exception 'menu item % not found', p_menu_item_id;
  end if;
  if not v_menu_item.is_available then
    raise exception 'menu item % is not available', p_menu_item_id;
  end if;

  if p_size_id is not null then
    select price_delta into v_size_delta from public.menu_item_sizes where id = p_size_id;
    if v_size_delta is null then
      raise exception 'size % not found', p_size_id;
    end if;
  end if;

  if p_modifier_ids is not null and array_length(p_modifier_ids, 1) > 0 then
    select coalesce(sum(price_delta), 0) into v_modifier_delta
      from public.modifiers where id = any(p_modifier_ids);
  end if;

  v_unit_price := v_menu_item.base_price + v_size_delta + v_modifier_delta;

  select id into v_existing_id from public.table_cart_items
    where table_session_id = v_session_id
      and menu_item_id = p_menu_item_id
      and size_id is not distinct from p_size_id
      and modifier_ids = coalesce(p_modifier_ids, array[]::uuid[])
      and note is not distinct from p_note;

  if v_existing_id is not null then
    update public.table_cart_items set quantity = quantity + p_quantity, updated_at = now()
      where id = v_existing_id;
    return v_existing_id;
  end if;

  insert into public.table_cart_items (table_session_id, menu_item_id, size_id, modifier_ids, note, unit_price, quantity)
  values (v_session_id, p_menu_item_id, p_size_id, coalesce(p_modifier_ids, array[]::uuid[]), p_note, v_unit_price, p_quantity)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.add_cart_item(uuid, uuid, uuid, uuid[], text, integer) from public;
grant execute on function public.add_cart_item(uuid, uuid, uuid, uuid[], text, integer) to anon, authenticated;

create or replace function public.update_cart_item_quantity(p_cart_item_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    delete from public.table_cart_items where id = p_cart_item_id;
  else
    update public.table_cart_items set quantity = p_quantity, updated_at = now() where id = p_cart_item_id;
  end if;
end;
$$;

revoke all on function public.update_cart_item_quantity(uuid, integer) from public;
grant execute on function public.update_cart_item_quantity(uuid, integer) to anon, authenticated;

create or replace function public.remove_cart_item(p_cart_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.table_cart_items where id = p_cart_item_id;
end;
$$;

revoke all on function public.remove_cart_item(uuid) from public;
grant execute on function public.remove_cart_item(uuid) to anon, authenticated;

create or replace function public.abandon_table_session(p_table_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_has_orders boolean;
begin
  select id into v_session_id from public.table_sessions
    where table_id = p_table_id and status = 'active';
  if v_session_id is null then
    return false;
  end if;

  select exists(select 1 from public.orders where table_session_id = v_session_id) into v_has_orders;
  if v_has_orders then
    return false;
  end if;

  delete from public.table_cart_items where table_session_id = v_session_id;
  update public.table_sessions set status = 'abandoned', ended_at = now() where id = v_session_id;
  update public.tables set status = 'available' where id = p_table_id and status = 'occupied';
  return true;
end;
$$;

revoke all on function public.abandon_table_session(uuid) from public;
grant execute on function public.abandon_table_session(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `table_session_cart_rpcs` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select get_table_session('00000000-0000-0000-0000-000000000000'::uuid);
```
Expected: `{"session": null, "cartItems": [], "rounds": [], "unpaidTotal": 0}` (no error on an unknown table id).

```sql
select proname from pg_proc where proname in ('add_cart_item', 'update_cart_item_quantity', 'remove_cart_item', 'abandon_table_session', 'get_table_session');
```
Expected: 5 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0071_table_session_cart_rpcs.sql
git commit -m "Add guest-safe RPCs for the live shared table cart"
```

---

### Task 3: Migration — `place_order` gains `tableSessionId`, new `place_table_round` RPC

**Files:**
- Create: `supabase/migrations/0072_place_table_round.sql`

**Interfaces:**
- Consumes: `place_order` (full current body, migration `0068`); `table_cart_items`/`table_sessions` from Tasks 1–2.
- Produces: `place_order(p_payload jsonb)` — unchanged behavior, plus reads an optional `tableSessionId` field and stamps it onto the inserted order; `place_table_round(p_table_id uuid) returns jsonb` (same return shape as `place_order`: `{orderId, taxAmount, total}`).

- [ ] **Step 1: Write the migration file**

```sql
-- 0072_place_table_round.sql
-- Full redefinition of place_order (unchanged body from migration 0068
-- except: reads an optional tableSessionId field and stamps it onto
-- the inserted order). New place_table_round wraps it: reads the
-- table's active session's draft cart, calls place_order with
-- payAt: 'later' (a table round is never paid individually -- see
-- docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md,
-- Goal 4) and no promo/loyalty/redemption fields (those only ever
-- apply once, at Check Bill), then clears the draft.

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
  v_table_session_id uuid := (p_payload->>'tableSessionId')::uuid;
  v_payment_method payment_method := (p_payload->>'paymentMethod')::payment_method;
  v_promo_code text := upper(trim(coalesce(p_payload->>'promoCode', '')));
  v_promo public.promotions%rowtype;
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
  v_redemption_discount integer := 0;
  v_redeem_value integer;
  v_balance integer;
  v_loyalty_enabled boolean;
  v_tax_rate numeric(5,4);
  v_taxable integer;
  v_tax integer;
  v_total integer;
  v_order_id uuid;
  v_order_item_id uuid;
  v_modifier_id uuid;
  v_redemption_ids uuid[];
  v_redemption_id uuid;
  v_redemption record;
begin
  if not exists (select 1 from public.shifts where closed_at is null) then
    raise exception 'no_open_shift';
  end if;

  if v_pay_at = 'now' and v_payment_method is null then
    raise exception 'paymentMethod is required when payAt is now';
  end if;

  if v_payment_collected and (public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin')) then
    raise exception 'not_authorized';
  end if;

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
    select loyalty_points_balance into v_balance
      from public.profiles where id = v_customer_id
      for update;
    if v_balance is null or v_redeem_points > v_balance then
      raise exception 'insufficient loyalty points balance';
    end if;
    select enabled into v_loyalty_enabled from public.loyalty_settings where id = 1;
    if not coalesce(v_loyalty_enabled, true) then
      raise exception 'loyalty_program_disabled';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_payload->'redemptionIds', '[]'::jsonb)) > 0 then
    if v_customer_id is null then
      raise exception 'guests cannot apply reward redemptions';
    end if;
    select array_agg((x)::uuid) into v_redemption_ids
      from jsonb_array_elements_text(p_payload->'redemptionIds') x;

    foreach v_redemption_id in array v_redemption_ids
    loop
      select rr.id, rr.customer_id, rr.applied_order_id, rr.fulfilled_at, r.discount_value_vnd
        into v_redemption
        from public.reward_redemptions rr
        join public.rewards r on r.id = rr.reward_id
        where rr.id = v_redemption_id;

      if v_redemption.id is null or v_redemption.customer_id <> v_customer_id then
        raise exception 'invalid_redemption_code';
      end if;
      if v_redemption.applied_order_id is not null or v_redemption.fulfilled_at is not null then
        raise exception 'redemption_already_used';
      end if;
      if now() > public.get_redemption_expiry(v_redemption_id) then
        raise exception 'redemption_expired';
      end if;

      v_redemption_discount := v_redemption_discount + v_redemption.discount_value_vnd;
    end loop;
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

  if v_promo_code <> '' then
    select * into v_promo from public.promotions where code = v_promo_code for update;

    if v_promo.id is null then
      raise exception 'invalid_promo_code';
    end if;
    if not v_promo.active then
      raise exception 'promo_code_inactive';
    end if;
    if v_promo.starts_at is not null and now() < v_promo.starts_at then
      raise exception 'promo_code_not_started';
    end if;
    if v_promo.ends_at is not null and now() > v_promo.ends_at then
      raise exception 'promo_code_expired';
    end if;
    if v_promo.max_redemptions is not null and v_promo.times_used >= v_promo.max_redemptions then
      raise exception 'promo_code_limit_reached';
    end if;
    if v_promo.min_subtotal_vnd is not null and v_subtotal < v_promo.min_subtotal_vnd then
      raise exception 'promo_code_below_minimum';
    end if;

    v_promo_discount := case v_promo.discount_type
      when 'percent' then round(v_subtotal * v_promo.discount_value / 100.0)
      else v_promo.discount_value
    end;
    v_promo_discount := least(v_promo_discount, greatest(v_subtotal, 0));
  end if;

  if v_redeem_points > 0 then
    select redeem_value_vnd_per_point into v_redeem_value from public.loyalty_settings where id = 1;
    v_loyalty_discount := v_redeem_points * v_redeem_value;
  end if;

  select tax_rate into v_tax_rate from public.shop_settings where id = 1;
  v_taxable := greatest(v_subtotal - v_promo_discount - v_loyalty_discount - v_redemption_discount, 0);
  v_tax := round(v_taxable * coalesce(v_tax_rate, 0));
  v_total := v_taxable + v_tax;

  insert into public.orders (
    customer_id, order_type, table_id, table_session_id, status, payment_method, payment_status,
    subtotal, discount_amount, tax_amount, total, pickup_time, promo_code
  ) values (
    v_customer_id, v_order_type, v_table_id, v_table_session_id, v_initial_status, v_payment_method, 'pending',
    v_subtotal, v_promo_discount + v_loyalty_discount + v_redemption_discount, v_tax, v_total,
    v_pickup_time, nullif(v_promo_code, '')
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

  if v_redemption_ids is not null and array_length(v_redemption_ids, 1) > 0 then
    update public.reward_redemptions set applied_order_id = v_order_id
      where id = any(v_redemption_ids);
  end if;

  if v_promo.id is not null then
    update public.promotions set times_used = times_used + 1 where id = v_promo.id;
  end if;

  if v_payment_collected then
    update public.orders set status = 'paid', payment_status = 'paid' where id = v_order_id;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'taxAmount', v_tax, 'total', v_total);
end;
$$;

create or replace function public.place_table_round(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_items jsonb;
  v_result jsonb;
begin
  select * into v_session from public.table_sessions
    where table_id = p_table_id and status = 'active';
  if v_session.id is null then
    raise exception 'no_active_session';
  end if;
  if v_session.payment_pending then
    raise exception 'payment_in_progress';
  end if;

  select jsonb_agg(jsonb_build_object(
    'menuItemId', ci.menu_item_id,
    'sizeId', ci.size_id,
    'modifierIds', to_jsonb(ci.modifier_ids),
    'quantity', ci.quantity,
    'note', ci.note
  )) into v_items
  from public.table_cart_items ci
  where ci.table_session_id = v_session.id;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_cart';
  end if;

  v_result := public.place_order(jsonb_build_object(
    'orderType', 'dine_in',
    'tableId', p_table_id,
    'tableSessionId', v_session.id,
    'payAt', 'later',
    'items', v_items
  ));

  delete from public.table_cart_items where table_session_id = v_session.id;

  return v_result;
end;
$$;

revoke all on function public.place_table_round(uuid) from public;
grant execute on function public.place_table_round(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `place_table_round` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select column_name from information_schema.columns
  where table_name = 'orders' and column_name = 'table_session_id';
```
Expected: one row (already added in Task 1 — confirms the redefinition didn't drop it).

```sql
select proname from pg_proc where proname = 'place_table_round';
```
Expected: one row.

Manually exercise the full path once via `execute_sql` against a real table id: call `add_cart_item` for a real `menu_items` row, then `place_table_round`, then confirm an `orders` row exists with `table_session_id` set and `table_cart_items` for that session is empty.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0072_place_table_round.sql
git commit -m "place_order gains tableSessionId; add place_table_round RPC"
```

---

### Task 4: Migration — `sync_table_occupancy` closes the table session on completion

**Files:**
- Create: `supabase/migrations/0073_close_table_session_on_complete.sql`

**Interfaces:**
- Consumes: `sync_table_occupancy` (current full body, migration `0021`; trigger scope from `0024`).
- Produces: `sync_table_occupancy()` — same behavior as today, plus closes the table's active `table_sessions` row in the same branch that already flips the table to `cleaning`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0073_close_table_session_on_complete.sql
-- Full redefinition of sync_table_occupancy (unchanged body from
-- migration 0021 except: the existing "no other active order for this
-- table -> cleaning" branch also closes the table's active
-- table_sessions row). No trigger definition change needed -- the
-- existing unscoped `after insert or update` trigger (migration 0024)
-- already fires on every relevant transition.

create or replace function public.sync_table_occupancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.order_type = 'dine_in' and new.table_id is not null then
      update public.tables
      set status = 'occupied', cleaning_notified_at = null
      where id = new.table_id;
    end if;
    return new;
  end if;

  if new.table_id is not null
     and new.status in ('completed', 'cancelled')
     and old.status not in ('completed', 'cancelled') then
    if not exists (
      select 1 from public.orders
      where table_id = new.table_id
        and status not in ('completed', 'cancelled')
        and id <> new.id
    ) then
      update public.tables set status = 'cleaning' where id = new.table_id;
      update public.table_sessions set status = 'closed', ended_at = now()
        where table_id = new.table_id and status = 'active';
    end if;
  end if;

  return new;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `close_table_session_on_complete` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select pg_get_functiondef('public.sync_table_occupancy'::regproc);
```
Expected: body includes the new `update public.table_sessions set status = 'closed' ...` line.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0073_close_table_session_on_complete.sql
git commit -m "sync_table_occupancy closes the table session when the table's last order completes"
```

---

### Task 5: Migration — `checkout_table_session` + `confirm_table_cash_payment`

**Files:**
- Create: `supabase/migrations/0074_checkout_table_session.sql`

**Interfaces:**
- Consumes: `promotions` table (migration `0068`); `table_sessions`/`orders.table_session_id` from earlier tasks.
- Produces: `checkout_table_session(p_table_id uuid, p_method payment_method, p_promo_code text default null) returns jsonb` — `{tableSessionId, orderIds, chargeTotal}`; `confirm_table_cash_payment(p_table_id uuid) returns integer` (row count updated).

- [ ] **Step 1: Write the migration file**

```sql
-- 0074_checkout_table_session.sql
-- Aggregate Check Bill payment. checkout_table_session sets the
-- payment method on every currently-unpaid order under a table's
-- active session, applies at most one promo code against the
-- aggregate total (mirrors place_order's own promo block, inlined
-- here rather than calling validate_promo_code because this needs
-- FOR UPDATE + a times_used increment, which that guest-safe read-only
-- RPC deliberately doesn't do), and -- for Stripe/VNPay -- sets
-- payment_pending so a new round can't be placed mid-flight (design
-- doc Section 6 / Q27). confirm_table_cash_payment is the staff-side
-- aggregate counterpart to the existing single-order "Confirm Cash
-- Received" action.

create or replace function public.checkout_table_session(
  p_table_id uuid,
  p_method payment_method,
  p_promo_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_order_ids uuid[];
  v_aggregate_total integer;
  v_promo public.promotions%rowtype;
  v_promo_code text := upper(trim(coalesce(p_promo_code, '')));
  v_discount integer := 0;
  v_charge_total integer;
begin
  select * into v_session from public.table_sessions
    where table_id = p_table_id and status = 'active'
    for update;
  if v_session.id is null then
    raise exception 'no_active_session';
  end if;
  if v_session.payment_pending then
    raise exception 'payment_in_progress';
  end if;

  select array_agg(id), coalesce(sum(total), 0) into v_order_ids, v_aggregate_total
    from public.orders
    where table_session_id = v_session.id and payment_status = 'pending'
    for update of orders;

  if v_order_ids is null or array_length(v_order_ids, 1) = 0 then
    raise exception 'nothing_to_pay';
  end if;

  if v_promo_code <> '' then
    select * into v_promo from public.promotions where code = v_promo_code for update;
    if v_promo.id is null then
      raise exception 'invalid_promo_code';
    end if;
    if not v_promo.active then
      raise exception 'promo_code_inactive';
    end if;
    if v_promo.starts_at is not null and now() < v_promo.starts_at then
      raise exception 'promo_code_not_started';
    end if;
    if v_promo.ends_at is not null and now() > v_promo.ends_at then
      raise exception 'promo_code_expired';
    end if;
    if v_promo.max_redemptions is not null and v_promo.times_used >= v_promo.max_redemptions then
      raise exception 'promo_code_limit_reached';
    end if;
    if v_promo.min_subtotal_vnd is not null and v_aggregate_total < v_promo.min_subtotal_vnd then
      raise exception 'promo_code_below_minimum';
    end if;

    v_discount := case v_promo.discount_type
      when 'percent' then round(v_aggregate_total * v_promo.discount_value / 100.0)
      else v_promo.discount_value
    end;
    v_discount := least(v_discount, greatest(v_aggregate_total, 0));

    update public.promotions set times_used = times_used + 1 where id = v_promo.id;
  end if;

  v_charge_total := greatest(v_aggregate_total - v_discount, 0);

  update public.orders set payment_method = p_method where id = any(v_order_ids);

  update public.table_sessions set
    checkout_promo_code = nullif(v_promo_code, ''),
    checkout_discount_amount = v_discount,
    payment_pending = (p_method in ('stripe', 'vnpay'))
  where id = v_session.id;

  return jsonb_build_object(
    'tableSessionId', v_session.id,
    'orderIds', to_jsonb(v_order_ids),
    'chargeTotal', v_charge_total
  );
end;
$$;

revoke all on function public.checkout_table_session(uuid, payment_method, text) from public;
grant execute on function public.checkout_table_session(uuid, payment_method, text) to anon, authenticated;

create or replace function public.confirm_table_cash_payment(p_table_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_updated integer;
begin
  if public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  select id into v_session_id from public.table_sessions
    where table_id = p_table_id and status = 'active';
  if v_session_id is null then
    return 0;
  end if;

  update public.orders set payment_status = 'paid'
    where table_session_id = v_session_id
      and payment_status = 'pending'
      and payment_method = 'cash';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.confirm_table_cash_payment(uuid) from public;
grant execute on function public.confirm_table_cash_payment(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `checkout_table_session` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select proname from pg_proc where proname in ('checkout_table_session', 'confirm_table_cash_payment');
```
Expected: 2 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0074_checkout_table_session.sql
git commit -m "Add checkout_table_session and confirm_table_cash_payment RPCs"
```

---

### Task 6: Live-grant audit for every new function

**Files:**
- Create (only if needed): `supabase/migrations/0075_fix_table_session_grants.sql`

**Why:** documented, repeatedly-bitten gotcha in this project — a migration's own `revoke all ... from public; grant execute ... to X;` does not reliably survive Supabase's platform-level auto-grant on `CREATE FUNCTION`. Every function from Tasks 2, 3, and 5 must be checked live, not assumed correct from the migration text.

- [ ] **Step 1: Check live grants**

```sql
select r.routine_name, g.grantee, g.privilege_type
from information_schema.role_routine_grants g
join information_schema.routines r on r.specific_name = g.specific_name
where r.routine_name in (
  'get_table_session', 'add_cart_item', 'update_cart_item_quantity', 'remove_cart_item',
  'abandon_table_session', 'place_table_round', 'checkout_table_session', 'confirm_table_cash_payment'
)
order by r.routine_name, g.grantee;
```

Expected: every function except `confirm_table_cash_payment` shows exactly `anon` and `authenticated` as grantees; `confirm_table_cash_payment` shows exactly `authenticated`. `public`/`PUBLIC` must not appear as a grantee for any of them.

- [ ] **Step 2: If the platform over- or under-granted, write and apply a follow-up migration**

If Step 1 shows an unexpected grantee (e.g. `PUBLIC` re-added, or `anon` missing from a function that needs it), write `0075_fix_table_session_grants.sql` re-issuing the exact `revoke all ... from public; grant execute ... to <correct roles>;` pair for each affected function signature, apply it via `apply_migration`, then re-run Step 1's query to confirm the fix.

- [ ] **Step 3: Commit (only if Step 2 was needed)**

```bash
git add supabase/migrations/0075_fix_table_session_grants.sql
git commit -m "Fix live grants on table-session RPCs (platform auto-grant gotcha)"
```

---

### Task 7: Query layer — `lib/supabase/table-session-data.ts`

**Files:**
- Create: `lib/supabase/table-session-data.ts`
- Create: `lib/supabase/table-session-data.test.ts`

**Interfaces:**
- Consumes: RPCs from Tasks 2, 3, 5.
- Produces: types `TableSessionCartItem`, `TableSessionRoundItem`, `TableSessionRound`, `TableSession`, `AddCartItemInput`; functions `getTableSession(supabase, tableId): Promise<TableSession>`, `addCartItem(supabase, tableId, input): Promise<void>`, `updateCartItemQuantity(supabase, cartItemId, quantity): Promise<void>`, `removeCartItem(supabase, cartItemId): Promise<void>`, `placeTableRound(supabase, tableId): Promise<{orderId: string; total: number}>`, `abandonTableSession(supabase, tableId): Promise<boolean>`, `checkoutTableSession(supabase, tableId, method, locale, promoCode?): Promise<{checkoutUrl?: string}>`.

- [ ] **Step 1: Write the module**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"

export type TableSessionCartItem = {
  id: string
  menuItemId: string
  nameVi: string
  nameEn: string
  sizeId: string | null
  modifierIds: string[]
  note: string | null
  unitPrice: number
  quantity: number
}

export type TableSessionRoundItem = { nameVi: string; nameEn: string; quantity: number; unitPrice: number; note: string | null }

export type TableSessionRound = {
  id: string
  createdAt: number
  status: string
  paymentStatus: string
  paymentMethod: "stripe" | "cash" | "vnpay" | null
  subtotal: number
  taxAmount: number
  total: number
  items: TableSessionRoundItem[]
}

export type TableSession = {
  hasSession: boolean
  paymentPending: boolean
  checkoutPromoCode: string | null
  checkoutDiscountAmount: number
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
}

export type AddCartItemInput = {
  menuItemId: string
  sizeId?: string | null
  modifierIds: string[]
  note?: string | null
  quantity?: number
}

type GetTableSessionJson = {
  session: { id: string; paymentPending: boolean; checkoutPromoCode: string | null; checkoutDiscountAmount: number } | null
  cartItems: {
    id: string; menuItemId: string; nameVi: string; nameEn: string
    sizeId: string | null; modifierIds: string[]; note: string | null
    unitPrice: number; quantity: number
  }[]
  rounds: {
    id: string; createdAt: number; status: string; paymentStatus: string
    paymentMethod: "stripe" | "cash" | "vnpay" | null
    subtotal: number; taxAmount: number; total: number
    items: TableSessionRoundItem[]
  }[]
  unpaidTotal: number
}

export async function getTableSession(supabase: SupabaseClient, tableId: string): Promise<TableSession> {
  const { data, error } = await supabase.rpc("get_table_session", { p_table_id: tableId })
  if (error) throw error
  const json = data as GetTableSessionJson
  return {
    hasSession: json.session !== null,
    paymentPending: json.session?.paymentPending ?? false,
    checkoutPromoCode: json.session?.checkoutPromoCode ?? null,
    checkoutDiscountAmount: json.session?.checkoutDiscountAmount ?? 0,
    cartItems: json.cartItems,
    rounds: json.rounds,
    unpaidTotal: json.unpaidTotal,
  }
}

export async function addCartItem(supabase: SupabaseClient, tableId: string, input: AddCartItemInput): Promise<void> {
  const { error } = await supabase.rpc("add_cart_item", {
    p_table_id: tableId,
    p_menu_item_id: input.menuItemId,
    p_size_id: input.sizeId ?? null,
    p_modifier_ids: [...input.modifierIds].sort(),
    p_note: input.note ?? null,
    p_quantity: input.quantity ?? 1,
  })
  if (error) throw error
}

export async function updateCartItemQuantity(supabase: SupabaseClient, cartItemId: string, quantity: number): Promise<void> {
  const { error } = await supabase.rpc("update_cart_item_quantity", { p_cart_item_id: cartItemId, p_quantity: quantity })
  if (error) throw error
}

export async function removeCartItem(supabase: SupabaseClient, cartItemId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_cart_item", { p_cart_item_id: cartItemId })
  if (error) throw error
}

export async function placeTableRound(supabase: SupabaseClient, tableId: string): Promise<{ orderId: string; total: number }> {
  const { data, error } = await supabase.rpc("place_table_round", { p_table_id: tableId })
  if (error) throw error
  return data as { orderId: string; total: number }
}

export async function abandonTableSession(supabase: SupabaseClient, tableId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("abandon_table_session", { p_table_id: tableId })
  if (error) throw error
  return data as boolean
}

export async function checkoutTableSession(
  supabase: SupabaseClient,
  tableId: string,
  method: "cash" | "stripe" | "vnpay",
  locale: string,
  promoCode?: string | null
): Promise<{ checkoutUrl?: string }> {
  const { data, error } = await supabase.functions.invoke("checkout-table-session", {
    body: { tableId, method, locale, promoCode: promoCode ?? null },
  })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { checkoutUrl?: string }
}
```

- [ ] **Step 2: Write the tests**

```typescript
import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getTableSession,
  addCartItem,
  updateCartItemQuantity,
  removeCartItem,
  placeTableRound,
  abandonTableSession,
  checkoutTableSession,
} from "./table-session-data"

function mockRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  return { rpc, supabase: { rpc } as unknown as SupabaseClient }
}

describe("getTableSession", () => {
  it("maps a null session to hasSession: false with defaults", async () => {
    const { supabase } = mockRpc({
      data: { session: null, cartItems: [], rounds: [], unpaidTotal: 0 },
      error: null,
    })
    const result = await getTableSession(supabase, "table-1")
    expect(result).toEqual({
      hasSession: false,
      paymentPending: false,
      checkoutPromoCode: null,
      checkoutDiscountAmount: 0,
      cartItems: [],
      rounds: [],
      unpaidTotal: 0,
    })
  })

  it("maps an active session", async () => {
    const { supabase } = mockRpc({
      data: {
        session: { id: "session-1", paymentPending: true, checkoutPromoCode: "SAVE10", checkoutDiscountAmount: 5000 },
        cartItems: [{ id: "ci-1", menuItemId: "mi-1", nameVi: "Cà phê", nameEn: "Coffee", sizeId: null, modifierIds: [], note: null, unitPrice: 30000, quantity: 2 }],
        rounds: [],
        unpaidTotal: 60000,
      },
      error: null,
    })
    const result = await getTableSession(supabase, "table-1")
    expect(result.hasSession).toBe(true)
    expect(result.paymentPending).toBe(true)
    expect(result.checkoutPromoCode).toBe("SAVE10")
    expect(result.cartItems).toHaveLength(1)
    expect(result.unpaidTotal).toBe(60000)
  })

  it("throws on error", async () => {
    const { supabase } = mockRpc({ data: null, error: new Error("boom") })
    await expect(getTableSession(supabase, "table-1")).rejects.toThrow("boom")
  })
})

describe("addCartItem", () => {
  it("sorts modifierIds before calling the RPC", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await addCartItem(supabase, "table-1", {
      menuItemId: "mi-1",
      sizeId: "size-1",
      modifierIds: ["mod-b", "mod-a"],
      note: "less ice",
      quantity: 2,
    })
    expect(rpc).toHaveBeenCalledWith("add_cart_item", {
      p_table_id: "table-1",
      p_menu_item_id: "mi-1",
      p_size_id: "size-1",
      p_modifier_ids: ["mod-a", "mod-b"],
      p_note: "less ice",
      p_quantity: 2,
    })
  })

  it("defaults sizeId/note to null and quantity to 1", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await addCartItem(supabase, "table-1", { menuItemId: "mi-1", modifierIds: [] })
    expect(rpc).toHaveBeenCalledWith("add_cart_item", {
      p_table_id: "table-1",
      p_menu_item_id: "mi-1",
      p_size_id: null,
      p_modifier_ids: [],
      p_note: null,
      p_quantity: 1,
    })
  })
})

describe("updateCartItemQuantity", () => {
  it("calls the RPC with cartItemId and quantity", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await updateCartItemQuantity(supabase, "ci-1", 3)
    expect(rpc).toHaveBeenCalledWith("update_cart_item_quantity", { p_cart_item_id: "ci-1", p_quantity: 3 })
  })
})

describe("removeCartItem", () => {
  it("calls the RPC with cartItemId", async () => {
    const { rpc, supabase } = mockRpc({ data: null, error: null })
    await removeCartItem(supabase, "ci-1")
    expect(rpc).toHaveBeenCalledWith("remove_cart_item", { p_cart_item_id: "ci-1" })
  })
})

describe("placeTableRound", () => {
  it("returns the RPC's orderId/total", async () => {
    const { supabase } = mockRpc({ data: { orderId: "order-1", total: 90000 }, error: null })
    const result = await placeTableRound(supabase, "table-1")
    expect(result).toEqual({ orderId: "order-1", total: 90000 })
  })
})

describe("abandonTableSession", () => {
  it("returns the RPC's boolean", async () => {
    const { supabase } = mockRpc({ data: true, error: null })
    const result = await abandonTableSession(supabase, "table-1")
    expect(result).toBe(true)
  })
})

describe("checkoutTableSession", () => {
  it("invokes checkout-table-session with tableId/method/locale/promoCode", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { checkoutUrl: "https://example.com/pay" }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient

    const result = await checkoutTableSession(supabase, "table-1", "vnpay", "vi", "SAVE10")

    expect(invoke).toHaveBeenCalledWith("checkout-table-session", {
      body: { tableId: "table-1", method: "vnpay", locale: "vi", promoCode: "SAVE10" },
    })
    expect(result.checkoutUrl).toBe("https://example.com/pay")
  })

  it("defaults promoCode to null", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient

    await checkoutTableSession(supabase, "table-1", "cash", "en")

    expect(invoke).toHaveBeenCalledWith("checkout-table-session", {
      body: { tableId: "table-1", method: "cash", locale: "en", promoCode: null },
    })
  })

  it("throws when the invoke response carries an error field", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { error: "no_active_session" }, error: null }))
    const supabase = { functions: { invoke } } as unknown as SupabaseClient
    await expect(checkoutTableSession(supabase, "table-1", "cash", "vi")).rejects.toThrow("no_active_session")
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/supabase/table-session-data.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/table-session-data.ts lib/supabase/table-session-data.test.ts
git commit -m "Add table-session-data query layer for the shared table cart"
```

---

### Task 8: `_shared/stripe.ts` — sibling function for a table-session charge

**Files:**
- Modify: `supabase/functions/_shared/stripe.ts`

**Interfaces:**
- Produces: `createStripeCheckoutSessionForTableSession(params: { tableSessionId: string; total: number; successUrl: string; cancelUrl: string }): Promise<{ url: string } | { error: string }>`.
- Existing `createStripeCheckoutSession` and its two call sites (`place-order`, `pay-order`) are untouched.

- [ ] **Step 1: Add the sibling function**

Add after the existing `createStripeCheckoutSession` function:

```typescript
// Sibling of createStripeCheckoutSession for the aggregate "Check Bill"
// charge (docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md,
// Section 6) -- a separate function rather than widening the existing
// one's params, so place-order/pay-order's call sites need no changes
// at all. metadata carries table_session_id instead of order_id;
// stripe-webhook branches on which key is present.
export async function createStripeCheckoutSessionForTableSession(params: {
  tableSessionId: string
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
      metadata: { table_session_id: params.tableSessionId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "vnd",
            unit_amount: params.total,
            product_data: { name: "PhaDinCafe Table Bill" },
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/stripe.ts
git commit -m "Add createStripeCheckoutSessionForTableSession for the aggregate Check Bill charge"
```

---

### Task 9: `_shared/vnpay.ts` — sibling functions for a table-session charge

**Files:**
- Modify: `supabase/functions/_shared/vnpay.ts`

**Interfaces:**
- Produces: `buildVnpayCheckoutUrlForTableSession(params: { tableSessionId: string; total: number; ipAddr: string; locale: string; returnUrl: string }): Promise<string>`; `buildVnpayReturnUrlForTableSession(locale: string): string`.
- Existing `buildVnpayCheckoutUrl`/`buildVnpayReturnUrl` and their call sites (`place-order`, `pay-order`) are untouched.

- [ ] **Step 1: Add the sibling functions**

Add after the existing `buildVnpayReturnUrl` function:

```typescript
/** Sibling of buildVnpayReturnUrl for the aggregate Check Bill charge -- carries no orderId, since the trusted identity travels in vnp_TxnRef's "session:" prefix, not this URL's query params. */
export function buildVnpayReturnUrlForTableSession(locale: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?locale=${locale}`
}
```

Add after the existing `buildVnpayCheckoutUrl` function:

```typescript
// Sibling of buildVnpayCheckoutUrl for the aggregate "Check Bill" charge
// (docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md,
// Section 6) -- a separate function rather than widening the existing
// one's params, so place-order/pay-order's call sites need no changes.
// vnp_TxnRef gets a "session:" prefix so vnpay-ipn/vnpay-return can
// tell an aggregate charge apart from a plain order id (both are raw
// UUIDs otherwise) -- see those functions' own comments for the parse
// side of this convention.
export async function buildVnpayCheckoutUrlForTableSession(params: {
  tableSessionId: string
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
    vnp_TxnRef: `session:${params.tableSessionId}`,
    vnp_OrderInfo: `Thanh toan ban ${params.tableSessionId}`,
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
```

`toVnpayDateString` and `VNPAY_GATEWAY_URL` are module-private in this file already (used by the existing `buildVnpayCheckoutUrl`) — no new export needed, this function is in the same module.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/vnpay.ts
git commit -m "Add VNPay table-session checkout URL/return URL builders"
```

---

### Task 10: New `checkout-table-session` Edge Function

**Files:**
- Create: `supabase/functions/checkout-table-session/index.ts`

**Interfaces:**
- Consumes: `checkout_table_session` RPC (Task 5); `createStripeCheckoutSessionForTableSession` (Task 8); `buildVnpayCheckoutUrlForTableSession`/`buildVnpayReturnUrlForTableSession` (Task 9); `rateLimitOrNull` (`_shared/rate-limit.ts`, unchanged).
- Produces: `POST { tableId: string; method: "cash"|"stripe"|"vnpay"; locale: "vi"|"en"; promoCode: string|null }` → `{ ok: true }` (cash) or `{ checkoutUrl: string }` (stripe/vnpay) or `{ error: string }`.

- [ ] **Step 1: Write the function**

```typescript
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
    const tableId = payload.tableId as string | undefined
    const method = payload.method as string | undefined
    const promoCode = (payload.promoCode as string | null | undefined) ?? null
    const locale = VALID_LOCALES.includes(payload.locale) ? payload.locale : "vi"
    if (!tableId) {
      return new Response(JSON.stringify({ error: "tableId is required" }), { status: 400, headers: corsHeaders })
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
      p_table_id: tableId,
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

    const { data: table } = await serviceClient.from("tables").select("qr_code_token").eq("id", tableId).maybeSingle()
    const qrToken = table?.qr_code_token as string | undefined
    const siteUrl = Deno.env.get("SITE_URL")!
    const tableUrl = qrToken ? `${siteUrl}/${locale}/table/${qrToken}` : `${siteUrl}/${locale}/menu`

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
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "checkout-table-session"`, `entrypoint_path: "index.ts"`, `verify_jwt: false`, `files: [{ name: "index.ts", content: <the file above> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/checkout-table-session/index.ts
git commit -m "Add checkout-table-session Edge Function for aggregate Check Bill payment"
```

---

### Task 11: `stripe-webhook` — aggregate table-session branch

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

**Why:** a Check Bill Stripe session's `metadata` carries `table_session_id` instead of `order_id` (Task 8). This branch marks every unpaid order under that session paid in one event, then clears `payment_pending` — additive, the existing single-order branch is untouched.

- [ ] **Step 1: Add the aggregate branch**

Replace:

```typescript
  const event = JSON.parse(rawBody)
  const orderId = event.data?.object?.metadata?.order_id
  const amountTotal = event.data?.object?.amount_total

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.expired") && orderId) {
    const { data: order } = await serviceClient.from("orders").select("status, total").eq("id", orderId).maybeSingle()

    // VND is a Stripe zero-decimal currency, so amount_total compares
    // directly to orders.total (no /100, unlike vnpay-ipn's check).
    // Sessions are only ever created server-side with the server-computed
    // total, so a mismatch here would mean the Stripe secret key itself
    // was compromised -- belt-and-suspenders, matching vnpay-ipn's
    // existing check (2026-07-29 review, L-2).
    if (event.type === "checkout.session.completed" && order && amountTotal !== order.total) {
      return new Response(JSON.stringify({ received: true, error: "amount_mismatch" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

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
```

with:

```typescript
  const event = JSON.parse(rawBody)
  const orderId = event.data?.object?.metadata?.order_id
  const tableSessionId = event.data?.object?.metadata?.table_session_id
  const amountTotal = event.data?.object?.amount_total

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.expired") && tableSessionId) {
    // Aggregate Check Bill charge (docs/superpowers/specs/
    // 2026-08-28-shared-table-ordering-session-design.md, Section 6).
    // Every order this covers was inserted via payAt: 'later', so
    // status is already kitchen-visible ('paid'/'preparing'/'ready'/
    // 'served') -- never 'pending_payment' -- so unlike the single-order
    // branch below, only payment_status ever needs to change here; no
    // buildPaidUpdate/status-flip and no cancellation-on-expiry (a
    // failed aggregate charge just leaves every covered round unpaid
    // for a retry, matching the single-order served-order behavior).
    const { data: pendingOrders } = await serviceClient
      .from("orders")
      .select("id, total")
      .eq("table_session_id", tableSessionId)
      .eq("payment_status", "pending")
    const { data: session } = await serviceClient
      .from("table_sessions")
      .select("checkout_discount_amount")
      .eq("id", tableSessionId)
      .maybeSingle()

    const aggregateTotal = (pendingOrders ?? []).reduce((sum, o) => sum + o.total, 0)
    const expectedCharge = aggregateTotal - (session?.checkout_discount_amount ?? 0)

    if (event.type === "checkout.session.completed" && amountTotal !== expectedCharge) {
      return new Response(JSON.stringify({ received: true, error: "amount_mismatch" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (event.type === "checkout.session.completed") {
      await serviceClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("table_session_id", tableSessionId)
        .eq("payment_status", "pending")
    }

    await serviceClient.from("table_sessions").update({ payment_pending: false }).eq("id", tableSessionId)

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.expired") && orderId) {
    const { data: order } = await serviceClient.from("orders").select("status, total").eq("id", orderId).maybeSingle()

    // VND is a Stripe zero-decimal currency, so amount_total compares
    // directly to orders.total (no /100, unlike vnpay-ipn's check).
    // Sessions are only ever created server-side with the server-computed
    // total, so a mismatch here would mean the Stripe secret key itself
    // was compromised -- belt-and-suspenders, matching vnpay-ipn's
    // existing check (2026-07-29 review, L-2).
    if (event.type === "checkout.session.completed" && order && amountTotal !== order.total) {
      return new Response(JSON.stringify({ received: true, error: "amount_mismatch" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

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
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "stripe-webhook"`, `entrypoint_path: "index.ts"`, `verify_jwt: false`, `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "stripe-webhook: aggregate table-session branch for Check Bill charges"
```

---

### Task 12: `vnpay-ipn` — aggregate table-session branch

**Files:**
- Modify: `supabase/functions/vnpay-ipn/index.ts`

**Why:** a Check Bill VNPay charge's `vnp_TxnRef` is `session:<table_session_id>` (Task 9), not a raw order id. This branch marks every unpaid order under that session paid, then clears `payment_pending` — additive, the existing single-order branch is untouched.

- [ ] **Step 1: Add the aggregate branch**

Replace:

```typescript
  const orderId = params.get("vnp_TxnRef")
  const vnpAmount = Number(params.get("vnp_Amount") ?? "0")
  const responseCode = params.get("vnp_ResponseCode")

  if (!orderId) {
    return ipnResponse("01", "Order not found")
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const { data: order } = await serviceClient
    .from("orders")
    .select("id, total, status, payment_status")
    .eq("id", orderId)
    .maybeSingle()
```

with:

```typescript
  const txnRef = params.get("vnp_TxnRef")
  const vnpAmount = Number(params.get("vnp_Amount") ?? "0")
  const responseCode = params.get("vnp_ResponseCode")

  if (!txnRef) {
    return ipnResponse("01", "Order not found")
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  // Aggregate Check Bill charge (docs/superpowers/specs/
  // 2026-08-28-shared-table-ordering-session-design.md, Section 6) --
  // vnp_TxnRef carries a "session:" prefix instead of a raw order id.
  if (txnRef.startsWith("session:")) {
    const tableSessionId = txnRef.slice("session:".length)
    const { data: session } = await serviceClient
      .from("table_sessions")
      .select("id, checkout_discount_amount")
      .eq("id", tableSessionId)
      .maybeSingle()
    if (!session) {
      return ipnResponse("01", "Order not found")
    }

    const { data: pendingOrders } = await serviceClient
      .from("orders")
      .select("id, total")
      .eq("table_session_id", tableSessionId)
      .eq("payment_status", "pending")

    const aggregateTotal = (pendingOrders ?? []).reduce((sum, o) => sum + o.total, 0)
    const expectedCharge = aggregateTotal - session.checkout_discount_amount

    if (!pendingOrders || pendingOrders.length === 0) {
      return ipnResponse("02", "Order already confirmed")
    }
    if (vnpAmount / 100 !== expectedCharge) {
      return ipnResponse("04", "Invalid amount")
    }

    if (responseCode === "00") {
      await serviceClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("table_session_id", tableSessionId)
        .eq("payment_status", "pending")
    }
    await serviceClient.from("table_sessions").update({ payment_pending: false }).eq("id", tableSessionId)

    return ipnResponse("00", "Confirm Success")
  }

  const orderId = txnRef
  const { data: order } = await serviceClient
    .from("orders")
    .select("id, total, status, payment_status")
    .eq("id", orderId)
    .maybeSingle()
```

The rest of the function (the existing single-order `if (!order) {...}` block onward) is unchanged.

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "vnpay-ipn"`, `entrypoint_path: "index.ts"`, `verify_jwt: false`, `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/vnpay-ipn/index.ts
git commit -m "vnpay-ipn: aggregate table-session branch for Check Bill charges"
```

---

### Task 13: `vnpay-return` — aggregate table-session branch

**Files:**
- Modify: `supabase/functions/vnpay-return/index.ts`

**Why:** the browser-facing return needs to send the customer back to `/table/[qrToken]` (not `/orders/[id]` or `/checkout`) for an aggregate charge, and clear `payment_pending` on failure instead of calling `cancel_pending_order` (nothing to cancel — every covered round is already kitchen-visible).

- [ ] **Step 1: Add the aggregate branch**

Replace:

```typescript
  // Use vnp_TxnRef (signed, tamper-evident) as the order id, not the
  // separate `orderId` query param -- that one is excluded from the
  // signature (see RETURN_URL_EXTRA_PARAMS above) purely because it's
  // our own return-URL bookkeeping, which means it's NOT tamper-evident:
  // an attacker could keep a genuinely-signed VNPay callback for their
  // own trivial order but swap `orderId` to point at a victim's order,
  // and the signature would still verify. vnp_TxnRef is set to the real
  // order id at checkout-URL creation time (buildVnpayCheckoutUrl) and
  // is part of the signed vnp_* field set, so it can't be substituted
  // without invalidating vnp_SecureHash. vnpay-ipn already used this
  // field correctly; this brings vnpay-return in line with it.
  const orderId = params.get("vnp_TxnRef")

  if (!orderId || !hashSecret || !(await verifyVnpaySignature(params, hashSecret, RETURN_URL_EXTRA_PARAMS))) {
    return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
  }

  const responseCode = params.get("vnp_ResponseCode")

  if (responseCode === "00") {
    return Response.redirect(`${siteUrl}/${locale}/orders/${orderId}`, 302)
  }

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
})
```

with:

```typescript
  // Use vnp_TxnRef (signed, tamper-evident) as the trusted identity, not
  // the separate `orderId` query param -- that one is excluded from the
  // signature (see RETURN_URL_EXTRA_PARAMS above) purely because it's
  // our own return-URL bookkeeping, which means it's NOT tamper-evident.
  // vnp_TxnRef is set at checkout-URL creation time and is part of the
  // signed vnp_* field set, so it can't be substituted without
  // invalidating vnp_SecureHash. A "session:" prefix marks an aggregate
  // Check Bill charge (docs/superpowers/specs/
  // 2026-08-28-shared-table-ordering-session-design.md, Section 6)
  // rather than a plain order id -- see vnpay-ipn's matching branch.
  const txnRef = params.get("vnp_TxnRef")

  if (!txnRef || !hashSecret || !(await verifyVnpaySignature(params, hashSecret, RETURN_URL_EXTRA_PARAMS))) {
    return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
  }

  const responseCode = params.get("vnp_ResponseCode")
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if (txnRef.startsWith("session:")) {
    const tableSessionId = txnRef.slice("session:".length)
    const { data: session } = await serviceClient
      .from("table_sessions")
      .select("table_id")
      .eq("id", tableSessionId)
      .maybeSingle()
    const { data: table } = session
      ? await serviceClient.from("tables").select("qr_code_token").eq("id", session.table_id).maybeSingle()
      : { data: null }
    const qrToken = table?.qr_code_token as string | undefined
    const tableUrl = qrToken ? `${siteUrl}/${locale}/table/${qrToken}` : `${siteUrl}/${locale}/menu`

    if (responseCode === "00") {
      return Response.redirect(tableUrl, 302)
    }
    // Nothing to cancel -- every round an aggregate charge covers is
    // already kitchen-visible (payAt: 'later'), unlike a pre-kitchen
    // pending_payment order. Just release the ordering lock.
    await serviceClient.from("table_sessions").update({ payment_pending: false }).eq("id", tableSessionId)
    return Response.redirect(`${tableUrl}?paymentFailed=1`, 302)
  }

  const orderId = txnRef

  if (responseCode === "00") {
    return Response.redirect(`${siteUrl}/${locale}/orders/${orderId}`, 302)
  }

  const { data: wasCancelled } = await serviceClient.rpc("cancel_pending_order", { p_order_id: orderId })

  // cancel_pending_order only ever cancels a still-pre-kitchen order and
  // returns false as a no-op otherwise (e.g. a served Pay Later order
  // whose deferred payment attempt just failed) -- send that case back
  // to its own tracking page instead of an empty Checkout.
  if (wasCancelled) {
    return Response.redirect(`${siteUrl}/${locale}/checkout?paymentFailed=1`, 302)
  }
  return Response.redirect(`${siteUrl}/${locale}/orders/${orderId}?paymentFailed=1`, 302)
})
```

- [ ] **Step 2: Deploy**

Use the Supabase MCP `deploy_edge_function` tool: `name: "vnpay-return"`, `entrypoint_path: "index.ts"`, `verify_jwt: false`, `files: [{ name: "index.ts", content: <full updated file content> }]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/vnpay-return/index.ts
git commit -m "vnpay-return: aggregate table-session branch for Check Bill charges"
```

---

### Task 14: `MenuBrowser`/`QuickAddPopup` — optional add-to-cart override

**Files:**
- Modify: `components/customer/menu-browser.tsx`
- Modify: `components/customer/quick-add-popup.tsx`

**Why:** the table ordering screen (Task 16) reuses the exact same grid/search/category-filter/quick-add UI as `/menu`, but items must go into the live shared table cart (`add_cart_item` RPC) instead of `useCart`'s `localStorage` cart. Both components call `useCart()` directly today — this task adds optional override props, defaulting to the exact current behavior when omitted, so `/menu` itself needs zero behavior change.

**Interfaces:**
- Produces: `AddToCartInput` (`hooks/useCart.tsx`) becomes exported. `MenuBrowser`'s props gain `onAddItem?: (item: AddToCartInput, quantity?: number) => void`, `cartItemCount?: number`, `cartSubtotal?: number`, `cartHref?: string` (all optional, default to `useCart()`'s `addItem`/`itemCount`/`subtotal`/`"/cart"`). `QuickAddPopup`'s props gain `onAdd?: (input: AddToCartInput) => void` (optional, defaults to `useCart().addItem`).

- [ ] **Step 1: Export `AddToCartInput`**

In `hooks/useCart.tsx`, `AddToCartInput` is currently a module-private type (no `export` keyword) — Tasks 15/16 need to import it. Replace:

```typescript
type AddToCartInput = Omit<CartItem, "cartItemId" | "quantity">
```

with:

```typescript
export type AddToCartInput = Omit<CartItem, "cartItemId" | "quantity">
```

- [ ] **Step 2: Add override props to `QuickAddPopup`**

Replace the full contents of `components/customer/quick-add-popup.tsx`:

```typescript
"use client"

import { useCart, type AddToCartInput } from "@/hooks/useCart"
import { SizeExtrasSheet, type SizeModifierSelection } from "@/components/shared/size-extras-sheet"
import type { MenuItem } from "@/lib/supabase/menu-data"

/**
 * Quick-add path for an item with a size decision and/or extras to make —
 * lets a customer configure and add without leaving the Menu grid for the
 * full Product Detail Page. Tapping the item itself (not this "+" popup)
 * still opens the full page (for reviews, notes, etc).
 *
 * onAdd defaults to the personal useCart() cart (unchanged /menu
 * behavior) — the table ordering screen (table-ordering-session.tsx)
 * passes its own handler routing into the live shared table cart instead.
 */
export function QuickAddPopup({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem
  onClose: () => void
  onAdd?: (input: AddToCartInput) => void
}) {
  const { addItem } = useCart()
  const add = onAdd ?? addItem

  function handleAdd(selection: SizeModifierSelection) {
    add({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      size: selection.size ? { id: selection.size.id, label: selection.size.name, priceDelta: selection.size.priceDelta } : undefined,
      modifiers: selection.cartModifiers,
      unitPrice: selection.unitPrice,
    })
  }

  return <SizeExtrasSheet item={item} onAdd={handleAdd} onClose={onClose} />
}
```

- [ ] **Step 3: Add override props to `MenuBrowser`**

In `components/customer/menu-browser.tsx`, replace the import line and function signature:

```typescript
import { useCart, type AddToCartInput } from "@/hooks/useCart"
```

```typescript
export function MenuBrowser({
  categories,
  items,
  onAddItem,
  cartItemCount,
  cartSubtotal,
  cartHref = "/cart",
}: {
  categories: MenuCategory[]
  items: MenuItem[]
  onAddItem?: (item: AddToCartInput, quantity?: number) => void
  cartItemCount?: number
  cartSubtotal?: number
  cartHref?: string
}) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const router = useRouter()
  const { addItem, itemCount, subtotal } = useCart()
  const addToCart = onAddItem ?? addItem
  const displayItemCount = cartItemCount ?? itemCount
  const displaySubtotal = cartSubtotal ?? subtotal
```

Replace the two remaining `useCart`-derived reads later in the file — `quickAdd`'s `addItem({...})` call becomes `addToCart({...})`, and the bottom cart-summary bar's `itemCount > 0` / `formatVND(subtotal)` become `displayItemCount > 0` / `formatVND(displaySubtotal)`, and its `href="/cart"` becomes `href={cartHref}`:

```typescript
  function quickAdd(item: MenuItem) {
    if (!item.isAvailable) return
    const needsChoice = (item.hasSizeOptions && item.sizes.length > 0) || item.modifierGroups.length > 0
    if (needsChoice) {
      setQuickAddItem(item)
      return
    }
    addToCart({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      modifiers: [],
      unitPrice: item.basePrice,
    })
  }
```

```typescript
      {displayItemCount > 0 && (
        <Link
          href={cartHref}
          className="nb-border nb-shadow nb-press fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center justify-between rounded-2xl bg-secondary px-5 py-4 text-secondary-foreground transition-colors hover:opacity-95 md:bottom-6 md:max-w-lg md:px-6"
        >
          <span className="font-semibold">
            {t("viewCart")} · {t("itemCount", { count: displayItemCount })}
          </span>
          <span className="text-lg font-bold">{formatVND(displaySubtotal)}</span>
        </Link>
      )}
```

Finally, thread `onAdd={onAddItem}` into the `QuickAddPopup` render:

```typescript
      <AnimatePresence>
        {quickAddItem && (
          <QuickAddPopup key="quick-add-popup" item={quickAddItem} onClose={() => setQuickAddItem(null)} onAdd={onAddItem} />
        )}
      </AnimatePresence>
```

`cartHref`'s type is `Link`'s locale-aware `href` — since `Link` here is imported from `@/i18n/navigation` and typed against known app routes, passing a non-literal string may need a local cast; if `tsc` complains at this call site, cast with `href={cartHref as Parameters<typeof Link>[0]["href"]}` rather than widening `Link`'s own type.

- [ ] **Step 4: Verify `/menu` is unchanged**

Run: `npm run build`
Expected: no new type errors. Then manually visit `/menu` on the deployed Vercel URL — confirm quick-add, the full-page item flow, and the bottom cart bar all behave exactly as before (they receive no override props, so every new parameter falls back to `useCart()`).

- [ ] **Step 5: Commit**

```bash
git add hooks/useCart.tsx components/customer/menu-browser.tsx components/customer/quick-add-popup.tsx
git commit -m "MenuBrowser/QuickAddPopup: optional add-to-cart override for the table ordering screen"
```

---

### Task 15: `hooks/useTableSession.tsx` — live shared cart/running tab state

**Files:**
- Create: `hooks/useTableSession.tsx`

**Interfaces:**
- Consumes: `table-session-data.ts` (Task 7); `useRealtimeChannel` (unchanged).
- Produces: `useTableSession(tableId: string | undefined)` returning `{ hasSession, cartItems, rounds, unpaidTotal, paymentPending, isLoading, showIdlePrompt, addItem, updateQuantity, removeItem, placeRound, confirmStillHere, dismissAndAbandon, refetch }`.

- [ ] **Step 1: Write the hook**

```typescript
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  getTableSession,
  addCartItem as addCartItemQuery,
  updateCartItemQuantity as updateCartItemQuantityQuery,
  removeCartItem as removeCartItemQuery,
  placeTableRound as placeTableRoundQuery,
  abandonTableSession as abandonTableSessionQuery,
  type AddCartItemInput,
  type TableSessionCartItem,
  type TableSessionRound,
} from "@/lib/supabase/table-session-data"

// Design doc Section 5 / Q9, Q18: the "still there?" idle-clear only
// ever applies to an unsubmitted draft cart, and stops entirely once
// the session has at least one placed round.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const IDLE_PROMPT_RESPONSE_MS = 60 * 1000

type TableSessionState = {
  hasSession: boolean
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isLoading: boolean
  showIdlePrompt: boolean
  addItem: (input: AddCartItemInput) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  placeRound: () => Promise<{ orderId: string; total: number }>
  confirmStillHere: () => void
  dismissAndAbandon: () => Promise<void>
  refetch: () => Promise<void>
}

export function useTableSession(tableId: string | undefined): TableSessionState {
  const [supabase] = useState(() => createClient())
  const [hasSession, setHasSession] = useState(false)
  const [cartItems, setCartItems] = useState<TableSessionCartItem[]>([])
  const [rounds, setRounds] = useState<TableSessionRound[]>([])
  const [unpaidTotal, setUnpaidTotal] = useState(0)
  const [paymentPending, setPaymentPending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>()
  const promptTimer = useRef<ReturnType<typeof setTimeout>>()

  const refetch = useCallback(async () => {
    if (!tableId) return
    const session = await getTableSession(supabase, tableId)
    setHasSession(session.hasSession)
    setCartItems(session.cartItems)
    setRounds(session.rounds)
    setUnpaidTotal(session.unpaidTotal)
    setPaymentPending(session.paymentPending)
  }, [supabase, tableId])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    refetch().finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refetch])

  // Unfiltered subscribe + refetch on any change, matching this
  // project's established Realtime convention (a server-side `filter`
  // doesn't reliably combine with RLS-gated Realtime).
  useRealtimeChannel(
    supabase,
    `table-session-${tableId ?? "none"}`,
    [
      { table: "table_cart_items", event: "*", onChange: () => refetch() },
      { table: "orders", event: "*", onChange: () => refetch() },
      { table: "table_sessions", event: "*", onChange: () => refetch() },
    ],
    { deps: [tableId] }
  )

  async function dismissAndAbandon() {
    if (!tableId) return
    setShowIdlePrompt(false)
    await abandonTableSessionQuery(supabase, tableId)
  }

  // Idle-draft timeout: only while the session has no placed rounds
  // yet. Re-arms on any cart/round change -- one shared session, so
  // the clock tracks the session's liveness, not any one device's.
  useEffect(() => {
    clearTimeout(idleTimer.current)
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)

    if (!hasSession || rounds.length > 0) return

    idleTimer.current = setTimeout(() => {
      setShowIdlePrompt(true)
      promptTimer.current = setTimeout(() => {
        dismissAndAbandon()
      }, IDLE_PROMPT_RESPONSE_MS)
    }, IDLE_TIMEOUT_MS)

    return () => {
      clearTimeout(idleTimer.current)
      clearTimeout(promptTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession, rounds.length, cartItems])

  async function addItem(input: AddCartItemInput) {
    if (!tableId) return
    await addCartItemQuery(supabase, tableId, input)
  }

  async function updateQuantity(cartItemId: string, quantity: number) {
    await updateCartItemQuantityQuery(supabase, cartItemId, quantity)
  }

  async function removeItem(cartItemId: string) {
    await removeCartItemQuery(supabase, cartItemId)
  }

  async function placeRound() {
    if (!tableId) throw new Error("no table id")
    return placeTableRoundQuery(supabase, tableId)
  }

  function confirmStillHere() {
    clearTimeout(promptTimer.current)
    setShowIdlePrompt(false)
    // The next cart/round-change effect run re-arms the 5-minute timer.
  }

  return {
    hasSession,
    cartItems,
    rounds,
    unpaidTotal,
    paymentPending,
    isLoading,
    showIdlePrompt,
    addItem,
    updateQuantity,
    removeItem,
    placeRound,
    confirmStillHere,
    dismissAndAbandon,
    refetch,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useTableSession.tsx
git commit -m "Add useTableSession: live shared cart, running tab, idle-timeout state"
```

---

### Task 16: `table-cart-panel.tsx` + `table-ordering-session.tsx` — the table ordering screen

**Files:**
- Create: `components/customer/table-cart-panel.tsx`
- Create: `components/customer/table-ordering-session.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (new `TableSession` namespace)

**Interfaces:**
- Consumes: `useTableSession` (Task 15); `MenuBrowser` (Task 14); `TableRecord` (`hooks/useTables.tsx`); `MenuCategory`/`MenuItem` (`lib/supabase/menu-data.ts`).
- Produces: `TableCartPanel` (presentational, all state via props); `TableOrderingSession({ table, categories, items }: { table: TableRecord; categories: MenuCategory[]; items: MenuItem[] })` — the component `table-landing.tsx` (Task 18) renders once a table is resolved and not `cleaning`.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`, add a new top-level `TableSession` block (after the existing `TableLanding` block, before `Loyalty`):

```json
  "TableSession": {
    "menuTabLabel": "Menu",
    "orderTabLabel": "Your Order",
    "draftCartTitle": "Current Round",
    "emptyDraftCart": "Add items from the menu to start this round.",
    "placeOrderButton": "Place Order",
    "placingOrder": "Placing…",
    "roundLabel": "Round {number}",
    "statusPaid": "Order Confirmed",
    "statusPreparing": "Preparing",
    "statusReady": "Ready",
    "statusServed": "Served",
    "statusCompleted": "Completed",
    "runningTabTitle": "Running Tab",
    "noRoundsYet": "No rounds ordered yet.",
    "unpaidTotalLabel": "Unpaid total",
    "checkBillButton": "Check Bill",
    "paymentInProgressNote": "A payment is in progress for this table — ordering is paused until it finishes.",
    "idlePromptTitle": "Still there?",
    "idlePromptBody": "This table's order hasn't changed in a while. Keep this round open?",
    "idlePromptYes": "Yes, keep it open",
    "idlePromptNo": "No, clear it",
    "checkBillTitle": "Check Bill",
    "checkBillSubtotal": "Unpaid total",
    "checkBillDiscount": "Discount",
    "checkBillTotal": "Total to pay",
    "checkBillPromoPlaceholder": "Promo code",
    "checkBillApplyPromo": "Apply",
    "checkBillPayCash": "Cash",
    "checkBillPayCard": "Card",
    "checkBillPayVNPay": "VNPay",
    "checkBillConfirm": "Confirm",
    "checkBillLoading": "Processing…",
    "checkBillError": "Couldn't process payment — please try again.",
    "checkBillClose": "Close",
    "checkBillNothingToPay": "Nothing to pay right now.",
    "addItemError": "Couldn't add that item — please try again."
  },
```

In `messages/vi.json`, add the matching block in the same position:

```json
  "TableSession": {
    "menuTabLabel": "Thực Đơn",
    "orderTabLabel": "Đơn Của Bạn",
    "draftCartTitle": "Lượt Gọi Hiện Tại",
    "emptyDraftCart": "Thêm món từ thực đơn để bắt đầu lượt gọi này.",
    "placeOrderButton": "Đặt Món",
    "placingOrder": "Đang đặt…",
    "roundLabel": "Lượt {number}",
    "statusPaid": "Đã Xác Nhận",
    "statusPreparing": "Đang Pha Chế",
    "statusReady": "Sẵn Sàng",
    "statusServed": "Đã Phục Vụ",
    "statusCompleted": "Hoàn Tất",
    "runningTabTitle": "Sổ Gọi Món",
    "noRoundsYet": "Chưa có lượt gọi món nào.",
    "unpaidTotalLabel": "Tổng chưa thanh toán",
    "checkBillButton": "Xem Hoá Đơn",
    "paymentInProgressNote": "Bàn này đang thanh toán — vui lòng chờ đến khi hoàn tất mới gọi thêm món.",
    "idlePromptTitle": "Bạn vẫn còn đó chứ?",
    "idlePromptBody": "Lượt gọi món này chưa có thay đổi trong một lúc. Giữ lượt gọi này chứ?",
    "idlePromptYes": "Có, giữ lại",
    "idlePromptNo": "Không, xoá đi",
    "checkBillTitle": "Xem Hoá Đơn",
    "checkBillSubtotal": "Tổng chưa thanh toán",
    "checkBillDiscount": "Giảm giá",
    "checkBillTotal": "Số tiền cần thanh toán",
    "checkBillPromoPlaceholder": "Mã khuyến mãi",
    "checkBillApplyPromo": "Áp dụng",
    "checkBillPayCash": "Tiền mặt",
    "checkBillPayCard": "Thẻ",
    "checkBillPayVNPay": "VNPay",
    "checkBillConfirm": "Xác Nhận",
    "checkBillLoading": "Đang xử lý…",
    "checkBillError": "Không thể xử lý thanh toán — vui lòng thử lại.",
    "checkBillClose": "Đóng",
    "checkBillNothingToPay": "Hiện chưa có gì cần thanh toán.",
    "addItemError": "Không thể thêm món này — vui lòng thử lại."
  },
```

- [ ] **Step 2: Write `table-cart-panel.tsx`**

```typescript
"use client"

import { useLocale, useTranslations } from "next-intl"
import { Minus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatVND } from "@/lib/format"
import type { TableSessionCartItem, TableSessionRound } from "@/lib/supabase/table-session-data"

const STATUS_LABEL_KEY: Record<string, string> = {
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
}

export function TableCartPanel({
  cartItems,
  rounds,
  unpaidTotal,
  paymentPending,
  isPlacingRound,
  placeOrderError,
  onUpdateQuantity,
  onRemoveItem,
  onPlaceOrder,
  onOpenCheckBill,
}: {
  cartItems: TableSessionCartItem[]
  rounds: TableSessionRound[]
  unpaidTotal: number
  paymentPending: boolean
  isPlacingRound: boolean
  placeOrderError: string | null
  onUpdateQuantity: (cartItemId: string, quantity: number) => void
  onRemoveItem: (cartItemId: string) => void
  onPlaceOrder: () => void
  onOpenCheckBill: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("TableSession")

  const draftSubtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

  return (
    <div className="flex flex-col gap-6 px-4 pb-32 pt-4 sm:px-6">
      {paymentPending && (
        <p className="nb-border-sm rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">
          {t("paymentInProgressNote")}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-bold text-card-foreground">{t("draftCartTitle")}</h2>
        {cartItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyDraftCart")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cartItems.map((item) => (
              <div key={item.id} className="nb-border-sm flex items-center justify-between gap-3 rounded-xl bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-card-foreground">
                    {locale === "vi" ? item.nameVi : item.nameEn}
                  </p>
                  {item.note && <p className="truncate text-xs italic text-muted-foreground">{item.note}</p>}
                  <span className="text-xs font-bold text-price">{formatVND(item.unitPrice * item.quantity)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1 py-1">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-background"
                    aria-label="decrease"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-background"
                    aria-label="increase"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {placeOrderError && <p className="text-xs text-destructive">{placeOrderError}</p>}
        <Button
          variant="neubrutal"
          className="h-11 w-full"
          disabled={cartItems.length === 0 || paymentPending || isPlacingRound}
          onClick={onPlaceOrder}
        >
          {isPlacingRound ? t("placingOrder") : `${t("placeOrderButton")} · ${formatVND(draftSubtotal)}`}
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold text-card-foreground">{t("runningTabTitle")}</h2>
        {rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRoundsYet")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rounds.map((round, index) => (
              <div key={round.id} className="nb-border-sm rounded-xl bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-card-foreground">{t("roundLabel", { number: index + 1 })}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-secondary">
                    {t(STATUS_LABEL_KEY[round.status] ?? "statusPaid")}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {round.items.map((item, itemIndex) => (
                    <p key={itemIndex} className="text-xs text-muted-foreground">
                      {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                    </p>
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={round.paymentStatus === "paid" ? "text-xs text-muted-foreground" : "text-xs font-bold text-amber-700"}>
                    {round.paymentStatus === "paid" ? "" : ""}
                  </span>
                  <span className="text-sm font-extrabold text-price">{formatVND(round.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card px-6 py-4 shadow-[0_-4px_12px_-1px_rgba(0,0,0,0.1)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("unpaidTotalLabel")}</span>
            <span className="text-xl font-bold text-primary">{formatVND(unpaidTotal)}</span>
          </div>
          <Button
            variant="neubrutal"
            className="h-12 px-8 text-base"
            disabled={unpaidTotal === 0 || paymentPending}
            onClick={onOpenCheckBill}
          >
            {t("checkBillButton")}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `table-ordering-session.tsx`**

```typescript
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { MenuBrowser } from "@/components/customer/menu-browser"
import { TableCartPanel } from "@/components/customer/table-cart-panel"
import { CheckBillSheet } from "@/components/customer/check-bill-sheet"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { useTableSession } from "@/hooks/useTableSession"
import type { TableRecord } from "@/hooks/useTables"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import type { AddToCartInput } from "@/hooks/useCart"

export function TableOrderingSession({
  table,
  categories,
  items,
}: {
  table: TableRecord
  categories: MenuCategory[]
  items: MenuItem[]
}) {
  const t = useTranslations("TableSession")
  const session = useTableSession(table.id)
  const [tab, setTab] = useState<"menu" | "order">("menu")
  const [isPlacingRound, setIsPlacingRound] = useState(false)
  const [placeOrderError, setPlaceOrderError] = useState<string | null>(null)
  const [addItemError, setAddItemError] = useState<string | null>(null)
  const [isCheckBillOpen, setIsCheckBillOpen] = useState(false)

  function handleAddItem(item: AddToCartInput) {
    setAddItemError(null)
    session
      .addItem({
        menuItemId: item.menuItemId,
        sizeId: item.size?.id ?? null,
        modifierIds: item.modifiers.map((m) => m.optionId),
        note: item.note ?? null,
      })
      .catch(() => setAddItemError(t("addItemError")))
  }

  async function handlePlaceOrder() {
    setPlaceOrderError(null)
    setIsPlacingRound(true)
    try {
      await session.placeRound()
      setTab("order")
    } catch {
      setPlaceOrderError(t("checkBillError"))
    } finally {
      setIsPlacingRound(false)
    }
  }

  if (session.isLoading) return null

  return (
    <div className="mx-auto w-full max-w-2xl md:max-w-6xl">
      <div className="px-4 pt-4 sm:px-6">
        <SegmentedControl
          layoutId="table-session-tab-pill"
          value={tab}
          onChange={setTab}
          options={[
            { value: "menu" as const, label: t("menuTabLabel") },
            { value: "order" as const, label: `${t("orderTabLabel")}${session.cartItems.length > 0 ? ` (${session.cartItems.length})` : ""}` },
          ]}
        />
      </div>

      {addItemError && (
        <p className="mx-4 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive sm:mx-6">{addItemError}</p>
      )}

      {tab === "menu" ? (
        <MenuBrowser
          categories={categories}
          items={items}
          onAddItem={handleAddItem}
          cartItemCount={session.cartItems.reduce((sum, i) => sum + i.quantity, 0)}
          cartSubtotal={session.cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)}
        />
      ) : (
        <TableCartPanel
          cartItems={session.cartItems}
          rounds={session.rounds}
          unpaidTotal={session.unpaidTotal}
          paymentPending={session.paymentPending}
          isPlacingRound={isPlacingRound}
          placeOrderError={placeOrderError}
          onUpdateQuantity={session.updateQuantity}
          onRemoveItem={session.removeItem}
          onPlaceOrder={handlePlaceOrder}
          onOpenCheckBill={() => setIsCheckBillOpen(true)}
        />
      )}

      {session.showIdlePrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="nb-border nb-shadow w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl">
            <h2 className="mb-2 text-lg font-bold text-card-foreground">{t("idlePromptTitle")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t("idlePromptBody")}</p>
            <div className="flex flex-col gap-2">
              <Button variant="neubrutal" className="h-11 w-full" onClick={session.confirmStillHere}>
                {t("idlePromptYes")}
              </Button>
              <Button variant="ghost" className="h-11 w-full" onClick={session.dismissAndAbandon}>
                {t("idlePromptNo")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isCheckBillOpen && (
        <CheckBillSheet
          tableId={table.id}
          unpaidTotal={session.unpaidTotal}
          onClose={() => setIsCheckBillOpen(false)}
          onSuccess={() => {
            setIsCheckBillOpen(false)
            session.refetch()
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/customer/table-cart-panel.tsx components/customer/table-ordering-session.tsx messages/en.json messages/vi.json
git commit -m "Add the table ordering screen: draft cart, running tab, idle prompt"
```

---

### Task 17: `check-bill-sheet.tsx` — aggregate payment picker

**Files:**
- Create: `components/customer/check-bill-sheet.tsx`

**Interfaces:**
- Consumes: `checkoutTableSession` (Task 7); translation keys added in Task 16 (`TableSession.checkBill*`).
- Produces: `CheckBillSheet({ tableId, unpaidTotal, onClose, onSuccess }: { tableId: string; unpaidTotal: number; onClose: () => void; onSuccess: () => void })`.

- [ ] **Step 1: Write the component**

```typescript
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CreditCard, QrCode, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { checkoutTableSession } from "@/lib/supabase/table-session-data"

type Method = "cash" | "stripe" | "vnpay"

const METHODS: { id: Method; icon: typeof Banknote; labelKey: "checkBillPayCash" | "checkBillPayCard" | "checkBillPayVNPay" }[] = [
  { id: "cash", icon: Banknote, labelKey: "checkBillPayCash" },
  { id: "stripe", icon: CreditCard, labelKey: "checkBillPayCard" },
  { id: "vnpay", icon: QrCode, labelKey: "checkBillPayVNPay" },
]

export function CheckBillSheet({
  tableId,
  unpaidTotal,
  onClose,
  onSuccess,
}: {
  tableId: string
  unpaidTotal: number
  onClose: () => void
  onSuccess: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("TableSession")
  const [supabase] = useState(() => createClient())
  const [method, setMethod] = useState<Method | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!method) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await checkoutTableSession(supabase, tableId, method, locale, promoCode.trim() || null)
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
        return
      }
      onSuccess()
    } catch {
      setError(t("checkBillError"))
      setIsSubmitting(false)
    }
  }

  if (unpaidTotal === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
        <div className="nb-border nb-shadow w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl">
          <p className="mb-4 text-sm text-muted-foreground">{t("checkBillNothingToPay")}</p>
          <Button variant="neubrutal" className="h-11 w-full" onClick={onClose}>
            {t("checkBillClose")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="nb-border nb-shadow w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-card-foreground">{t("checkBillTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("checkBillClose")} className="text-muted-foreground hover:text-destructive">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{t("checkBillTotal")}</span>
          <span className="text-xl font-extrabold text-price">{formatVND(unpaidTotal)}</span>
        </div>

        <div className="mb-4 flex gap-2">
          <Input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder={t("checkBillPromoPlaceholder")}
            className="nb-border-sm h-10 flex-1 rounded-lg"
          />
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {METHODS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              disabled={isSubmitting}
              onClick={() => setMethod(id)}
              className={`nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl p-4 disabled:opacity-50 ${
                method === id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className="text-xs font-bold">{t(labelKey)}</span>
            </button>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <Button variant="neubrutal" className="h-11 w-full" disabled={!method || isSubmitting} onClick={handleConfirm}>
          {isSubmitting ? t("checkBillLoading") : t("checkBillConfirm")}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/customer/check-bill-sheet.tsx
git commit -m "Add CheckBillSheet: aggregate Cash/Stripe/VNPay payment picker"
```

---

### Task 18: Rewire `/table/[qrToken]` to the new ordering screen

**Files:**
- Modify: `app/[locale]/(customer)/table/[qrToken]/page.tsx`
- Modify: `components/customer/table-landing.tsx`

**Interfaces:**
- Consumes: `getPublicMenuData()` (`lib/supabase/menu-data-cached.ts`, unchanged); `TableOrderingSession` (Task 16).

- [ ] **Step 1: Fetch menu data in the page and pass it down**

Replace the full contents of `app/[locale]/(customer)/table/[qrToken]/page.tsx`:

```typescript
import { getTranslations } from "next-intl/server"
import { TableLanding } from "@/components/customer/table-landing"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"

export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ qrToken: string }>
}) {
  const { qrToken } = await params
  const t = await getTranslations("Customer")
  const { categories, items } = await getPublicMenuData()
  return (
    <>
      <h1 className="sr-only">{t("tableOrderTitle")}</h1>
      <TableLanding qrToken={qrToken} categories={categories} items={items} />
    </>
  )
}
```

- [ ] **Step 2: Render `TableOrderingSession` once a table resolves and isn't `cleaning`**

In `components/customer/table-landing.tsx`, replace the import lines and function signature:

```typescript
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Sparkles } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { useTables, type TableRecord } from "@/hooks/useTables"
import { TableOrderingSession } from "@/components/customer/table-ordering-session"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

export function TableLanding({
  qrToken,
  categories,
  items,
}: {
  qrToken: string
  categories: MenuCategory[]
  items: MenuItem[]
}) {
```

Replace the final `return` block (the "resolved, not cleaning" case — everything from `return (` to the end of the function, i.e. from the `MapPin`/"orderingAt"/"View Menu" block onward):

```typescript
  return <TableOrderingSession table={resolvedTable} categories={categories} items={items} />
}
```

The `invalidTitle`/`invalidMessage`/`backToMenu` (no table found) and `cleaningTitle`/`cleaningMessage`/`notifyStaff` (table being cleaned) blocks earlier in the component are unchanged — only the final "table resolved and ready to order" branch changes. `Link` (from `@/i18n/navigation`) stays imported — the "invalid" branch's "Back to Menu" button still uses it (`render={<Link href="/menu" />}`). `MapPin` becomes unused (it was only rendered in the removed final branch) — drop it from the `lucide-react` import line. The now-unused `TableLanding` namespace translation keys `orderingAt`/`tableName`/`servedHere`/`viewMenu` no longer need to be read via `t(...)` in this file, but leave the keys themselves in `messages/en.json`/`messages/vi.json` (harmless if unused, no removal needed).

- [ ] **Step 3: Verify locally**

Run: `npm run build`
Expected: no new type errors — confirms `MapPin` was actually removed if no longer referenced (an unused import is a lint warning, not a build failure, but clean it up).

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/(customer)/table/[qrToken]/page.tsx components/customer/table-landing.tsx
git commit -m "Rewire /table/[qrToken] into the full shared ordering screen"
```

---

### Task 19: `checkout-view.tsx` — close the old dine-in entry point

**Files:**
- Modify: `components/customer/checkout-view.tsx`

**Why:** the table ordering screen (Task 18) is now the only dine-in entry point — every round is `payAt: 'later'` with no payment-method picker, ever (design doc Goal 4). Leaving `/checkout`'s existing "Dine-in" toggle live would let a customer place a dine-in order the *old* way (payment chosen at checkout, no `table_session_id`, invisible to the running tab) — a second, inconsistent path to the same physical outcome. `/checkout` becomes pickup-only; `useTables`'s `activeTable`/`setActiveTableByToken` machinery that only ever existed to support this old path is left in place but becomes dead code — flagged here rather than removed, to keep this task's diff contained to closing the entry point (a full dead-code sweep of `useTables`/`QrScannerOverlay`'s dine-in linking is a reasonable, separate follow-up, not required for this feature to be correct or safe).

**Interfaces:**
- Consumes: none new.
- Produces: `CheckoutView` — `orderType` is always `"pickup"`; the order-type `SegmentedControl` and its "Dine-in" option, table-number chip, and "Scan Table QR" affordance are removed.

- [ ] **Step 1: Remove the order-type toggle and force pickup**

Replace:

```typescript
  const { items, subtotal, promoCode, promoDiscount, clear } = useCart()
  const { activeTable } = useTables()

  const [orderType, setOrderType] = useState<OrderType>(activeTable ? "dine-in" : "pickup")
  const [pickupTime, setPickupTime] = useState("asap")
```

with:

```typescript
  const { items, subtotal, promoCode, promoDiscount, clear } = useCart()

  // Dine-in now only ever happens through the table ordering screen
  // (/table/[qrToken], see
  // docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md)
  // -- checkout stays pickup-only.
  const orderType: OrderType = "pickup"
  const [pickupTime, setPickupTime] = useState("asap")
```

- [ ] **Step 2: Remove the now-unused `useTables` import and the order-type/table-scan UI section**

Remove the `import { useTables } from "@/hooks/useTables"` line.

Replace the entire "Order Type" `<section>` block:

```typescript
          <section className="mb-6 space-y-2">
            <h2 className="font-bold text-card-foreground">{t("orderType")}</h2>
            <SegmentedControl
              layoutId="checkout-order-type-pill"
              value={orderType}
              onChange={(next) => (next === "dine-in" ? activeTable && setOrderType(next) : setOrderType(next))}
              options={[
                { value: "pickup" as const, label: t("pickup") },
                {
                  value: "dine-in" as const,
                  label: t("dineIn"),
                  disabled: !activeTable,
                  title: !activeTable ? t("dineInRequiresScan") : undefined,
                },
              ]}
            />
            {orderType === "dine-in" && activeTable && (
              <div className="nb-border-sm inline-flex items-center gap-2 rounded-full bg-chip px-3 py-1.5 text-sm font-bold text-foreground">
                <TableIcon className="h-4 w-4" />
                {t("table")}: <strong>{tableNumber}</strong>
              </div>
            )}
            {!activeTable && (
              <div className="nb-border-sm flex items-center justify-between gap-2 rounded-lg bg-card p-3">
                <p className="text-xs text-muted-foreground">{t("dineInRequiresScan")}</p>
                <Button size="sm" variant="neubrutal" className="h-9 shrink-0 gap-1.5" onClick={() => setIsScannerOpen(true)}>
                  <QrCode className="h-3.5 w-3.5" />
                  {t("scanTableQr")}
                </Button>
              </div>
            )}
          </section>

```

with nothing (delete the whole block — pickup is the only order type now, so there's nothing to choose).

- [ ] **Step 3: Simplify every remaining `orderType`/`activeTable`/`tableNumber` reference**

`orderType === "pickup"` checks (the pickup-time `<select>` section) become unconditionally true, so their surrounding `{orderType === "pickup" && (...)}` guard can stay exactly as-is (still evaluates true) — no change needed there since `orderType` is now a `const "pickup"`.

Replace:

```typescript
  const tableNumber = activeTable?.number
```

with nothing (delete this line — `tableNumber` is no longer referenced anywhere once the Order Type section above is removed).

In `handlePlaceOrder`, replace:

```typescript
    if (
      items.length === 0 ||
      !shiftOpen ||
      (payAt === "now" && !paymentMethod) ||
      (orderType === "dine-in" && !activeTable)
    )
      return
```

with:

```typescript
    if (items.length === 0 || !shiftOpen || (payAt === "now" && !paymentMethod)) return
```

Replace:

```typescript
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (activeTable?.id ?? null) : null,
          tableNumber: orderType === "dine-in" ? tableNumber : null,
          pickupTime: orderType === "pickup" ? pickupTime : null,
```

with:

```typescript
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: "pickup",
          tableId: null,
          tableNumber: null,
          pickupTime,
```

Replace:

```typescript
      clear()
      setSelectedRedemptionIds([])
      if (orderType === "dine-in" && tableNumber) {
        router.push(`/orders/${data.orderId}?table=${encodeURIComponent(tableNumber)}`)
      } else {
        router.push(`/orders/${data.orderId}`)
      }
```

with:

```typescript
      clear()
      setSelectedRedemptionIds([])
      router.push(`/orders/${data.orderId}`)
```

Both of the "Place Order" button `disabled` expressions (desktop card and the fixed mobile bottom bar) drop `(orderType === "dine-in" && !activeTable)`:

```typescript
              disabled={
                !shiftOpen ||
                (payAt === "now" && !paymentMethod) ||
                isPlacing
              }
```

and

```typescript
          disabled={(payAt === "now" && !paymentMethod) || isPlacing}
```

- [ ] **Step 4: Remove the now-unused `TableIcon`/`QrScannerOverlay`/`isScannerOpen` wiring**

`TableIcon` is no longer rendered — remove it from the `lucide-react` import line. `isScannerOpen`/`setIsScannerOpen` and the `<QrScannerOverlay ... />` render at the bottom of the file are no longer reachable (their only trigger, the "Scan Table QR" button, was removed in Step 2) — remove the `const [isScannerOpen, setIsScannerOpen] = useState(false)` line, the `import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"` line, and the trailing `{isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}` render.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: no new type errors (confirms every removed identifier's remaining references were all found and cleaned up).

Manually verify on the deployed Vercel URL: `/menu` → add item → `/cart` → `/checkout` shows no order-type toggle, places a pickup order successfully.

- [ ] **Step 6: Commit**

```bash
git add components/customer/checkout-view.tsx
git commit -m "checkout-view: close the old dine-in entry point, pickup-only"
```

---

### Task 20: `lib/supabase/order-kds.ts` — `confirmTableCashPayment`

**Files:**
- Modify: `lib/supabase/order-kds.ts`
- Modify: `lib/supabase/orders-data.ts` (barrel re-export)
- Create/modify: `lib/supabase/order-kds.test.ts` (create if it doesn't already exist for this module; add alongside existing tests if it does)

**Interfaces:**
- Consumes: `confirm_table_cash_payment` RPC (Task 5).
- Produces: `confirmTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<number>`.

- [ ] **Step 1: Add the query function**

In `lib/supabase/order-kds.ts`, add after the existing `confirmServedCashPayment`:

```typescript
export async function confirmTableCashPayment(supabase: SupabaseClient, tableId: string): Promise<number> {
  const { data, error } = await supabase.rpc("confirm_table_cash_payment", { p_table_id: tableId })
  if (error) throw error
  return data as number
}
```

- [ ] **Step 2: Re-export from the barrel**

In `lib/supabase/orders-data.ts`, add `confirmTableCashPayment` to the existing `order-kds` re-export line:

```typescript
export type { KdsOrderItemRow, KdsOrderRow } from "./order-kds"
export {
  getKitchenOrders,
  getPendingPaymentOrders,
  advanceOrderStatus,
  confirmCashPayment,
  confirmServedCashPayment,
  confirmTableCashPayment,
} from "./order-kds"
```

- [ ] **Step 3: Test**

Check whether `lib/supabase/order-kds.test.ts` already exists (Glob `lib/supabase/order-kds.test.ts`); if not, create it with just this one describe block (matching the existing per-module test-file split — `orders-data.test.ts` is legacy/covers the pre-split barrel, per its own header comment new tests belong in the split module's own file):

```typescript
import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmTableCashPayment } from "./order-kds"

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
```

If `order-kds.test.ts` already exists with other describe blocks (from earlier features), add these two `describe`/`it` blocks alongside the existing ones and add `confirmTableCashPayment` to its existing import line instead of writing a new file.

Run: `npx vitest run lib/supabase/order-kds.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/order-kds.ts lib/supabase/orders-data.ts lib/supabase/order-kds.test.ts
git commit -m "Add confirmTableCashPayment query function for aggregate cash confirmation"
```

---

### Task 21: `useKitchenOrders.tsx` — `confirmTableCashPayment` action

**Files:**
- Modify: `hooks/useKitchenOrders.tsx`

**Interfaces:**
- Consumes: `confirmTableCashPayment` (Task 20).
- Produces: `KitchenOrdersContextValue` gains `confirmTableCashPayment: (tableId: string) => Promise<void>`.

- [ ] **Step 1: Add the import and action**

Replace the import line:

```typescript
import {
  advanceOrderStatus,
  confirmCashPayment as confirmCashPaymentQuery,
  confirmServedCashPayment as confirmServedCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"
```

with:

```typescript
import {
  advanceOrderStatus,
  confirmCashPayment as confirmCashPaymentQuery,
  confirmServedCashPayment as confirmServedCashPaymentQuery,
  confirmTableCashPayment as confirmTableCashPaymentQuery,
  getKitchenOrders,
  getPendingPaymentOrders,
  setOrderPaymentMethodCash,
  changeOrderPaymentMethod,
  type KdsOrderRow,
  type RealOrderStatus,
} from "@/lib/supabase/orders-data"
```

Add `confirmTableCashPayment` to the context type:

```typescript
type KitchenOrdersContextValue = {
  orders: KdsOrderRow[]
  pendingPaymentOrders: KdsOrderRow[]
  isLoading: boolean
  isRealtimeConnected: boolean
  advance: (orderId: string) => Promise<void>
  serveTable: (orderIds: string[]) => Promise<void>
  confirmCashPayment: (orderId: string) => Promise<void>
  confirmTableCashPayment: (tableId: string) => Promise<void>
  markCashPayment: (orderId: string) => Promise<void>
  undoCashPayment: (orderId: string) => Promise<void>
  completedCount: number
  avgTimeLabel: string
}
```

Add the implementation (after `confirmCashPayment`):

```typescript
  async function confirmTableCashPayment(tableId: string) {
    await confirmTableCashPaymentQuery(supabase, tableId)
  }
```

Add it to the provider's returned value:

```typescript
    <KitchenOrdersContext.Provider
      value={{
        orders,
        pendingPaymentOrders,
        isLoading,
        isRealtimeConnected,
        advance,
        serveTable,
        confirmCashPayment,
        confirmTableCashPayment,
        markCashPayment,
        undoCashPayment,
        completedCount,
        avgTimeLabel,
      }}
    >
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useKitchenOrders.tsx
git commit -m "useKitchenOrders: add confirmTableCashPayment action"
```

---

### Task 22: `kitchen-tables-column.tsx` — aggregate awaiting-payment UI

**Files:**
- Modify: `lib/supabase/order-kds.ts`
- Modify: `components/staff/kitchen-tables-column.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`KitchenDisplay` namespace)

**Why:** today's `awaitingPaymentOrder` derivation picks **one** served-and-unpaid order per table with `.find()` — with a running tab, a table can have several unpaid rounds (some served, some not, per design doc Goal 4/Q15) all sharing one payment method once Check Bill has been tapped. This task widens that to a `.filter()` covering every unpaid round with a payment method set, sums their total, and points the cash-confirm button at the new aggregate RPC.

**Interfaces:**
- Consumes: `useKitchenOrders().confirmTableCashPayment` (Task 21); existing `KdsOrderRow.tableId`/`paymentStatus`/`paymentMethod`/`total` — **note:** `KdsOrderRow` (`lib/supabase/order-kds.ts`) does not currently carry `total`; Step 1 below adds it, since the aggregate badge needs to sum unpaid amounts.

- [ ] **Step 1: Add `total` to `KdsOrderRow`**

`lib/supabase/order-mapping.ts`'s `OrderRow` already has `total: number` (it's part of `ORDER_SELECT`) — no change needed there. `lib/supabase/order-kds.ts`'s `KdsOrderRow`/`mapKdsRow` don't carry it through yet. Add `total: number` to the `KdsOrderRow` type and add `total: row.total,` to `mapKdsRow`'s returned object.

- [ ] **Step 2: Add translation keys**

In `messages/en.json`'s `KitchenDisplay` block, add after `"tableAwaitingPayment": "Awaiting Payment",`:

```json
    "tableAwaitingPaymentCount": "Awaiting Payment ({count})",
```

In `messages/vi.json`'s `KitchenDisplay` block, add after `"tableAwaitingPayment": "Chờ Thanh Toán",`:

```json
    "tableAwaitingPaymentCount": "Chờ Thanh Toán ({count})",
```

- [ ] **Step 3: Widen the derivation and confirm action**

Replace:

```typescript
  const { orders, serveTable, confirmCashPayment, markCashPayment, undoCashPayment } = useKitchenOrders()
```

with:

```typescript
  const { orders, serveTable, confirmCashPayment, confirmTableCashPayment, markCashPayment, undoCashPayment } = useKitchenOrders()
```

Replace:

```typescript
          const tableOrders = orders.filter((o) => o.tableId === table.id)
          const readyOrderIds = tableOrders.filter((o) => o.status === "ready").map((o) => o.id)
          const awaitingPaymentOrder = tableOrders.find((o) => o.status === "served" && o.paymentStatus === "pending")
```

with:

```typescript
          const tableOrders = orders.filter((o) => o.tableId === table.id)
          const readyOrderIds = tableOrders.filter((o) => o.status === "ready").map((o) => o.id)
          // A running tab can have several unpaid rounds sharing one
          // payment method once Check Bill has been tapped -- unlike the
          // single-order deferred-payment flow this widens, "awaiting
          // payment" isn't scoped to status === "served" here (design
          // doc Goal 4 / Q15: Check Bill can be tapped before every
          // round is served).
          const awaitingPaymentOrders = tableOrders.filter((o) => o.paymentStatus === "pending" && o.paymentMethod !== null)
          const awaitingPaymentTotal = awaitingPaymentOrders.reduce((sum, o) => sum + o.total, 0)
          const awaitingPaymentMethod = awaitingPaymentOrders[0]?.paymentMethod ?? null
```

Replace the awaiting-payment badge:

```typescript
                {awaitingPaymentOrder && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700">
                    <Wallet className="h-3 w-3" />
                    {t("tableAwaitingPayment")}
                  </span>
                )}
```

with:

```typescript
                {awaitingPaymentOrders.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700">
                    <Wallet className="h-3 w-3" />
                    {t("tableAwaitingPaymentCount", { count: awaitingPaymentOrders.length })}
                  </span>
                )}
```

Replace the Confirm Cash/Undo/Mark Cash button group:

```typescript
                {awaitingPaymentOrder?.paymentMethod === "cash" && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        confirmCashPayment(awaitingPaymentOrder.id).catch(() => setError(t("updateError")))
                      }}
                      className="nb-border-sm nb-shadow-sm nb-press-sm rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground"
                    >
                      {t("confirmCashReceived")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        undoCashPayment(awaitingPaymentOrder.id).catch(() => setError(t("updateError")))
                      }}
                      className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-2 text-xs font-extrabold text-muted-foreground"
                    >
                      {t("undoCash")}
                    </button>
                  </div>
                )}
                {awaitingPaymentOrder && awaitingPaymentOrder.paymentMethod === null && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      markCashPayment(awaitingPaymentOrder.id).catch(() => setError(t("updateError")))
                    }}
                    className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-secondary-foreground hover:brightness-110"
                  >
                    {t("markCash")}
                  </button>
                )}
```

with:

```typescript
                {awaitingPaymentMethod === "cash" && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      confirmTableCashPayment(table.id).catch(() => setError(t("updateError")))
                    }}
                    className="nb-border-sm nb-shadow-sm nb-press-sm rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground"
                  >
                    {t("confirmCashReceived")}
                  </button>
                )}
```

The single-order `markCash`/`undoCash` actions (`markCashPayment`/`undoCashPayment`) no longer have a call site in this component — table orders never sit with `paymentMethod === null` once served (Check Bill always sets the method for every covered order in one RPC call, design doc Goal 4/Section 6, so there's no "staff picks cash for an unset method" case here the way the single-order deferred-payment flow has). Leave `markCashPayment`/`undoCashPayment` themselves defined in `useKitchenOrders.tsx` (still exported, unused only from this component) — do not remove them; they remain load-bearing for anything else that might reference the hook's full interface, and removing an exported hook action is out of scope for this task.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/order-kds.ts components/staff/kitchen-tables-column.tsx messages/en.json messages/vi.json
git commit -m "KDS table card: aggregate awaiting-payment badge and cash confirmation"
```

---

### Task 23: Live verification

**Files:** none (verification only, against `https://phadincafe.vercel.app` per this project's established convention).

- [ ] **Step 1: Two-device live-sync cart**

Scan the same table's QR from two devices/browsers. Add an item on one — confirm it appears on the other within the Realtime channel's normal latency. Remove/change quantity on one device for an item the *other* device added — confirm it's allowed and reflected on both (Q19, fully symmetric).

- [ ] **Step 2: Idle-clear**

Add an item, leave both devices untouched 5+ minutes. Confirm the "Still there?" prompt appears; confirm "No" (or letting the 60s response window elapse) clears the draft and drops the table back to `available` (not `cleaning`) when zero rounds were ever placed.

- [ ] **Step 3: Multiple rounds, running tab**

Place a round, confirm the draft resets to empty and the round appears in the running tab with the correct status. Add and place a second round. Confirm the idle prompt never reappears once at least one round exists (leave both devices untouched 5+ minutes after round 1 — no prompt).

- [ ] **Step 4: Check Bill mid-round — Cash**

With one round `served` and a second still `preparing`, tap Check Bill → Cash. Confirm the KDS table card shows one aggregate "Awaiting Payment" badge with the correct combined count/total, and one "Confirm Cash Received" tap settles both rounds' `payment_status` at once (verify via `execute_sql` or Staff Order History) — the still-`preparing` round completes on its own once it reaches `served`, and the table only flips to `cleaning` after that.

- [ ] **Step 5: Check Bill — Stripe**

Tap Check Bill → Card, complete a real Stripe test-mode checkout for the summed total. Confirm the webhook flips every covered order's `payment_status` to `paid` in one event (check `stripe-webhook` logs via `query_logs`), `table_sessions.payment_pending` clears, and "Place Order" — blocked while the Stripe session was in flight — is usable again afterward.

- [ ] **Step 6: Check Bill — VNPay**

Same as Step 5 via the VNPay sandbox. Confirm `vnp_TxnRef` carries the `session:` prefix (visible in `vnpay-ipn`/`vnpay-return` logs via `query_logs`), the IPN aggregate branch fires, and the browser return redirects back to `/table/[qrToken]` (not `/orders/[id]` or `/checkout`).

- [ ] **Step 7: Promo code at Check Bill**

Apply a real active promo code at Check Bill against a multi-round unpaid total. Confirm the charged amount (gateway session amount, or the aggregate cash total shown to staff) reflects the discount, and `promotions.times_used` increments exactly once.

- [ ] **Step 8: Pickup regression**

Confirm `/menu` → `/cart` → `/checkout` is unchanged: no order-type toggle, Pay Now/Pay Later still works for all three methods, places a pickup order successfully end-to-end.

- [ ] **Step 9: `get_advisors` pass**

Run the Supabase MCP `get_advisors` tool (`type: "security"` and `type: "performance"`) after all migrations are applied — per this project's established convention, run this after adding any new table, not just when something feels slow. Address anything it flags on `table_sessions`/`table_cart_items` (e.g. a missing FK index) before considering this feature done.

