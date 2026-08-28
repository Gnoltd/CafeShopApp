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
