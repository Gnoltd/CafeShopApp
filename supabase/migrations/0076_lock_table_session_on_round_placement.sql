-- 0076_lock_table_session_on_round_placement.sql
-- Fixes a concurrency bug in place_table_round (migration 0072): the
-- session lookup had no row lock, so two devices at the same table both
-- tapping "Place Order" at nearly the same instant could both read the
-- same draft cart contents before either reached the
-- `delete from public.table_cart_items`, producing two duplicate orders
-- for the same items -- real duplicate food and duplicate charges. This
-- is the core multi-device concurrency scenario the shared-table-
-- ordering-session feature exists for, so it needs to be correct.
--
-- Fix: add `for update` to the session select, so two concurrent calls
-- serialize on the session row -- the second call only proceeds after
-- the first commits (and has already cleared the cart), so it correctly
-- sees an empty cart and raises `empty_cart` instead of placing a
-- duplicate round. This is the only change from migration 0072's body.

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
    where table_id = p_table_id and status = 'active'
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
    'tableId', p_table_id,
    'tableSessionId', v_session.id,
    'payAt', 'later',
    'items', v_items
  ));

  delete from public.table_cart_items where table_session_id = v_session.id;

  return v_result;
end;
$$;
