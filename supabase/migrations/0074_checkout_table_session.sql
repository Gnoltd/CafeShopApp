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
