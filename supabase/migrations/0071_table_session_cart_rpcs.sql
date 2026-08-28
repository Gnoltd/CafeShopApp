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
