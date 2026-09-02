-- 0083_table_checkout_recovery.sql
-- A gateway checkout locks a table session before the Edge Function can
-- contact Stripe or construct a VNPay URL. Persist a unique attempt id with
-- that lock so a pre-redirect failure can release only its own unfinished
-- attempt. A stale failure cannot unlock a newer attempt, and a completed
-- payment cannot be released because payment_pending is already false (or
-- the table session has closed).

alter table public.table_sessions
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_started_at timestamptz;

create or replace function public.checkout_table_session(
  p_qr_token text,
  p_method public.payment_method,
  p_promo_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  v_attempt_id uuid;
begin
  select id into v_table_id
    from public.tables
    where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select * into v_session
    from public.table_sessions
    where table_id = v_table_id and status = 'active'
    for update;
  if v_session.id is null then
    raise exception 'no_active_session';
  end if;
  if v_session.payment_pending then
    raise exception 'payment_in_progress';
  end if;

  perform 1
    from public.orders
    where table_session_id = v_session.id and payment_status = 'pending'
    for update;

  select array_agg(id), coalesce(sum(total), 0)
    into v_order_ids, v_aggregate_total
    from public.orders
    where table_session_id = v_session.id and payment_status = 'pending';

  if v_order_ids is null or array_length(v_order_ids, 1) = 0 then
    raise exception 'nothing_to_pay';
  end if;

  if v_promo_code <> '' then
    select * into v_promo
      from public.promotions
      where code = v_promo_code
      for update;
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

    update public.promotions
      set times_used = times_used + 1
      where id = v_promo.id;
  end if;

  v_charge_total := greatest(v_aggregate_total - v_discount, 0);
  if p_method in ('stripe', 'vnpay') then
    v_attempt_id := gen_random_uuid();
  end if;

  update public.orders
    set payment_method = p_method
    where id = any(v_order_ids);

  update public.table_sessions
    set checkout_promo_code = nullif(v_promo_code, ''),
        checkout_discount_amount = v_discount,
        payment_pending = (v_attempt_id is not null),
        checkout_attempt_id = v_attempt_id,
        checkout_started_at = case when v_attempt_id is not null then now() else null end
    where id = v_session.id;

  return jsonb_build_object(
    'tableSessionId', v_session.id,
    'orderIds', to_jsonb(v_order_ids),
    'chargeTotal', v_charge_total,
    'checkoutAttemptId', v_attempt_id
  );
end;
$$;

revoke all on function public.checkout_table_session(text, public.payment_method, text)
  from public, anon, authenticated;
grant execute on function public.checkout_table_session(text, public.payment_method, text)
  to anon, authenticated;

create or replace function public.release_table_checkout(
  p_qr_token text,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
  v_session record;
begin
  select id into v_table_id
    from public.tables
    where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  select * into v_session
    from public.table_sessions
    where table_id = v_table_id and status = 'active'
    for update;

  if v_session.id is null
     or not v_session.payment_pending
     or v_session.checkout_attempt_id is distinct from p_attempt_id then
    return false;
  end if;

  -- checkout_table_session reserves one promo use before gateway setup.
  -- Put that reservation back only while releasing the exact attempt.
  if v_session.checkout_promo_code is not null then
    update public.promotions
      set times_used = greatest(times_used - 1, 0)
      where code = v_session.checkout_promo_code;
  end if;

  update public.orders
    set payment_method = null
    where table_session_id = v_session.id
      and payment_status = 'pending';

  update public.table_sessions
    set payment_pending = false,
        checkout_promo_code = null,
        checkout_discount_amount = 0,
        checkout_attempt_id = null,
        checkout_started_at = null
    where id = v_session.id
      and payment_pending
      and checkout_attempt_id = p_attempt_id;

  return found;
end;
$$;

revoke all on function public.release_table_checkout(text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_table_checkout(text, uuid)
  to anon, authenticated;
