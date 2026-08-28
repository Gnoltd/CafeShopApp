-- 0077_table_session_qr_token_and_fixes.sql
-- Continuation of the shared-table-ordering-session feature (see
-- docs/superpowers/plans/2026-08-28-shared-table-ordering-session.md and
-- its SDD ledger at .superpowers/sdd/2026-08-28-shared-table-ordering-session/progress.md,
-- Task 5 review) after two problems were found live and never fixed
-- before the previous work session ran out:
--
-- 1. CORRECTNESS (confirmed live): checkout_table_session's aggregate
--    lock (`select array_agg(id), sum(total) ... for update of orders`)
--    is invalid Postgres -- "FOR UPDATE is not allowed with aggregate
--    functions" is a hard parser rule, not a heuristic. The function as
--    migrated in 0074 cannot execute at all once a table has an active
--    session with pending orders. Fixed here by locking the order rows
--    with a plain (non-aggregating) `select ... for update` first, then
--    aggregating over the now-locked set in a second statement.
--
-- 2. SECURITY: every new guest-callable RPC in this feature
--    (get_table_session, add_cart_item, update_cart_item_quantity,
--    remove_cart_item, abandon_table_session, place_table_round,
--    checkout_table_session) was keyed on a raw `p_table_id uuid` /
--    `p_cart_item_id uuid`, treating that id as proof the caller is
--    physically at the table. It isn't: `tables_select_all` is
--    `using (true)` and `tables.id` has an explicit anon SELECT grant,
--    so any anon-key holder can `select id from tables` and enumerate
--    every table in the shop, then drive any of these RPCs against a
--    table they've never scanned. `table_cart_items` has the same public
--    SELECT policy (required for Realtime, see migration 0070's own
--    comment), so `table_cart_items.id` is equally enumerable.
--    `qr_code_token` is the credential this codebase already treats as
--    unguessable-and-protected (no SELECT grant to anon/authenticated at
--    all, migrations 0046/0047; only resolvable via the narrow
--    `get_table_by_qr_token` RPC) -- every function below now takes
--    `p_qr_token text` and resolves the table internally, mirroring that
--    existing pattern, instead of accepting a bare id from the client.
--    update_cart_item_quantity/remove_cart_item additionally verify the
--    cart item belongs to the resolved table's own active session before
--    acting on it, closing the matching table_cart_items.id enumeration
--    gap.
--
-- No client code calls any of these functions yet (Task 7's query layer
-- had not been built when this was found), so this is a pure signature
-- change with zero call sites to update elsewhere in the app.
--
-- Old p_table_id/p_cart_item_id-only signatures are dropped outright
-- (not create-or-replace-able across a differing parameter list).

drop function if exists public.get_table_session(uuid);
drop function if exists public.add_cart_item(uuid, uuid, uuid, uuid[], text, integer);
drop function if exists public.update_cart_item_quantity(uuid, integer);
drop function if exists public.remove_cart_item(uuid);
drop function if exists public.abandon_table_session(uuid);
drop function if exists public.place_table_round(uuid);
drop function if exists public.checkout_table_session(uuid, payment_method, text);

create or replace function public.get_table_session(p_qr_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session record;
  v_result jsonb;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select * into v_session from public.table_sessions
    where table_id = v_table_id and status = 'active';

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

revoke all on function public.get_table_session(text) from public;
grant execute on function public.get_table_session(text) to anon, authenticated;

create or replace function public.add_cart_item(
  p_qr_token text,
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
  v_table_id uuid;
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

  select id, status into v_table_id, v_table_status from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;
  if v_table_status = 'cleaning' then
    raise exception 'table_is_cleaning';
  end if;

  select id into v_session_id from public.table_sessions
    where table_id = v_table_id and status = 'active';

  if v_session_id is null then
    insert into public.table_sessions (table_id) values (v_table_id) returning id into v_session_id;
    update public.tables set status = 'occupied' where id = v_table_id and status = 'available';
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

revoke all on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer) from public;
grant execute on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer) to anon, authenticated;

create or replace function public.update_cart_item_quantity(p_qr_token text, p_cart_item_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_owner_table_id uuid;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select ts.table_id into v_owner_table_id
    from public.table_cart_items ci
    join public.table_sessions ts on ts.id = ci.table_session_id
    where ci.id = p_cart_item_id;

  if v_owner_table_id is null or v_owner_table_id <> v_table_id then
    raise exception 'cart_item_not_found';
  end if;

  if p_quantity <= 0 then
    delete from public.table_cart_items where id = p_cart_item_id;
  else
    update public.table_cart_items set quantity = p_quantity, updated_at = now() where id = p_cart_item_id;
  end if;
end;
$$;

revoke all on function public.update_cart_item_quantity(text, uuid, integer) from public;
grant execute on function public.update_cart_item_quantity(text, uuid, integer) to anon, authenticated;

create or replace function public.remove_cart_item(p_qr_token text, p_cart_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_owner_table_id uuid;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select ts.table_id into v_owner_table_id
    from public.table_cart_items ci
    join public.table_sessions ts on ts.id = ci.table_session_id
    where ci.id = p_cart_item_id;

  if v_owner_table_id is null or v_owner_table_id <> v_table_id then
    raise exception 'cart_item_not_found';
  end if;

  delete from public.table_cart_items where id = p_cart_item_id;
end;
$$;

revoke all on function public.remove_cart_item(text, uuid) from public;
grant execute on function public.remove_cart_item(text, uuid) to anon, authenticated;

create or replace function public.abandon_table_session(p_qr_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session_id uuid;
  v_has_orders boolean;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select id into v_session_id from public.table_sessions
    where table_id = v_table_id and status = 'active';
  if v_session_id is null then
    return false;
  end if;

  select exists(select 1 from public.orders where table_session_id = v_session_id) into v_has_orders;
  if v_has_orders then
    return false;
  end if;

  delete from public.table_cart_items where table_session_id = v_session_id;
  update public.table_sessions set status = 'abandoned', ended_at = now() where id = v_session_id;
  update public.tables set status = 'available' where id = v_table_id and status = 'occupied';
  return true;
end;
$$;

revoke all on function public.abandon_table_session(text) from public;
grant execute on function public.abandon_table_session(text) to anon, authenticated;

create or replace function public.place_table_round(p_qr_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session record;
  v_items jsonb;
  v_result jsonb;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select * into v_session from public.table_sessions
    where table_id = v_table_id and status = 'active'
    for update;
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
    'tableId', v_table_id,
    'tableSessionId', v_session.id,
    'payAt', 'later',
    'items', v_items
  ));

  delete from public.table_cart_items where table_session_id = v_session.id;

  return v_result;
end;
$$;

revoke all on function public.place_table_round(text) from public;
grant execute on function public.place_table_round(text) to anon, authenticated;

-- checkout_table_session: same qr_token switch, plus the FOR UPDATE fix
-- described at the top of this file -- the order-locking select is now a
-- plain (non-aggregating) row lock; the aggregate sum/array_agg runs as a
-- second statement over the now-locked rows.
create or replace function public.checkout_table_session(
  p_qr_token text,
  p_method payment_method,
  p_promo_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session record;
  v_order_ids uuid[];
  v_aggregate_total integer;
  v_promo public.promotions%rowtype;
  v_promo_code text := upper(trim(coalesce(p_promo_code, '')));
  v_discount integer := 0;
  v_charge_total integer;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select * into v_session from public.table_sessions
    where table_id = v_table_id and status = 'active'
    for update;
  if v_session.id is null then
    raise exception 'no_active_session';
  end if;
  if v_session.payment_pending then
    raise exception 'payment_in_progress';
  end if;

  -- Lock the covered order rows first (plain select, no aggregates --
  -- FOR UPDATE cannot be combined with aggregate functions in the same
  -- statement), then aggregate over the now-locked set separately.
  perform 1 from public.orders
    where table_session_id = v_session.id and payment_status = 'pending'
    for update;

  select array_agg(id), coalesce(sum(total), 0) into v_order_ids, v_aggregate_total
    from public.orders
    where table_session_id = v_session.id and payment_status = 'pending';

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

revoke all on function public.checkout_table_session(text, payment_method, text) from public;
grant execute on function public.checkout_table_session(text, payment_method, text) to anon, authenticated;
