-- 0094_remove_shift_gate_and_tax.sql
-- Minimal ordering rebuild, Task 1: remove the shift-open ordering gate and
-- zero out the tax rate (menu prices already include tax; taxing again on
-- top would double-charge).
--
-- Body copied verbatim from the live public.place_order_legacy(jsonb)
-- (created by migration 0085's rename of the original place_order), with
-- exactly one change: the leading `no_open_shift` guard block is removed.
-- Nothing else in the function changes -- same parameters, same return
-- type, same remaining body (promo/loyalty/redemption/pricing logic stays
-- as-is; those branches are dormant-but-present per this rebuild's design
-- Decision 1).

create or replace function public.place_order_legacy(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_customer_id uuid := auth.uid();
  v_order_type order_type := (p_payload->>'orderType')::order_type;
  v_table_id uuid := (p_payload->>'tableId')::uuid;
  v_table_session_id uuid := (p_payload->>'tableSessionId')::uuid;
  v_payment_method payment_method := (p_payload->>'paymentMethod')::payment_method;
  v_promo_code text := upper(trim(coalesce(p_payload->>'promoCode', '')));
  v_promo_id uuid;
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
    select promo_id, discount_amount into v_promo_id, v_promo_discount
      from public._resolve_promo_discount(v_promo_code, v_subtotal);
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

  if v_promo_id is not null then
    update public.promotions set times_used = times_used + 1 where id = v_promo_id;
  end if;

  if v_payment_collected then
    update public.orders set status = 'paid', payment_status = 'paid' where id = v_order_id;
  end if;

  return jsonb_build_object('orderId', v_order_id, 'taxAmount', v_tax, 'total', v_total);
end;
$function$;

update public.shop_settings set tax_rate = 0 where id = 1;
