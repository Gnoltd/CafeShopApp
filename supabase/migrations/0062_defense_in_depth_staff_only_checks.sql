-- 0062_defense_in_depth_staff_only_checks.sql
-- Found during the same live-grant audit as 0060: get_dashboard_stats,
-- get_order_history, get_shift_history, get_shift_report, and
-- find_redemption_by_code are all staff/admin-only features (per
-- supabase/CLAUDE.md and root CLAUDE.md) but had NO internal caller
-- check at all -- unlike every sibling staff-only function in this
-- schema (close_shift, fulfill_redemption, get_staff_members,
-- join_shift, leave_shift, open_shift, regenerate_table_qr_token,
-- reply_to_review), which all correctly use
-- "current_user_role() is null or ... not in (...)".
--
-- Verified NOT currently exploitable: all five are SECURITY INVOKER
-- (no SECURITY DEFINER), and every underlying table they query
-- (orders, shifts, reward_redemptions, loyalty_transactions,
-- order_items, profiles) has RLS policies scoped either to
-- `customer_id = auth.uid()` (never IS NULL, so a guest's null
-- auth.uid() matches nothing) or to the staff/manager/admin role --
-- so an anon or plain-customer caller today gets zero or self-scoped
-- rows back, not other customers' or the shop's real data.
--
-- Adding the check anyway as defense-in-depth: relying solely on "RLS
-- happens to be strict enough" is exactly the gap that let
-- confirm_order_payment (0059/0060) and check_rate_limit (0057/this
-- session) go live anon-exploitable when they were SECURITY DEFINER
-- with no internal check -- a future edit that flips one of these five
-- to DEFINER (e.g. to fix an unrelated RLS friction) would silently
-- reopen the same hole. No functional change for legitimate
-- staff/manager/admin callers.

create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_result jsonb;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'todayRevenue', coalesce((
      select sum(total) from public.orders
      where payment_status = 'paid'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'ordersToday', coalesce((
      select count(*) from public.orders
      where payment_status = 'paid'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'loyaltyIssuedToday', coalesce((
      select sum(points_change) from public.loyalty_transactions
      where type = 'earn'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'sevenDayRevenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d::date, 'YYYY-MM-DD'), 'revenue', coalesce(r.revenue, 0)
      ) order by d), '[]'::jsonb)
      from generate_series(v_today - 6, v_today, interval '1 day') d
      left join (
        select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, sum(total) as revenue
        from public.orders
        where payment_status = 'paid'
          and (created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_today - 6 and v_today
        group by 1
      ) r on r.day = d::date
    ),
    'bestSellers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nameVi', mi.name_vi, 'nameEn', mi.name_en, 'quantitySold', s.quantity_sold
      ) order by s.quantity_sold desc), '[]'::jsonb)
      from (
        select oi.menu_item_id, sum(oi.quantity) as quantity_sold
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.payment_status = 'paid'
          and (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_today - 6 and v_today
        group by oi.menu_item_id
        order by quantity_sold desc
        limit 3
      ) s
      join public.menu_items mi on mi.id = s.menu_item_id
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_order_history(
  p_date_from date default null,
  p_date_to date default null,
  p_statuses order_status[] default array['completed'::order_status, 'cancelled'::order_status],
  p_order_type order_type default null,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns json
language plpgsql
set search_path to 'public'
as $$
declare
  v_statuses order_status[] := coalesce(p_statuses, array['completed', 'cancelled']::order_status[]);
  v_rows json;
  v_total bigint;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  select count(*) into v_total
  from public.orders o
  left join public.tables tb on tb.id = o.table_id
  left join public.profiles p on p.id = o.customer_id
  where o.status = any(v_statuses)
    and (p_date_from is null or o.created_at::date >= p_date_from)
    and (p_date_to is null or o.created_at::date <= p_date_to)
    and (p_order_type is null or o.order_type = p_order_type)
    and (
      p_search is null or p_search = '' or
      o.id::text ilike p_search || '%' or
      tb.table_number ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.phone ilike '%' || p_search || '%'
    );

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_rows
  from (
    select
      o.id,
      o.created_at,
      o.order_type,
      tb.table_number as table_number,
      p.full_name as customer_name,
      o.payment_method,
      o.status,
      o.total
    from public.orders o
    left join public.tables tb on tb.id = o.table_id
    left join public.profiles p on p.id = o.customer_id
    where o.status = any(v_statuses)
      and (p_date_from is null or o.created_at::date >= p_date_from)
      and (p_date_to is null or o.created_at::date <= p_date_to)
      and (p_order_type is null or o.order_type = p_order_type)
      and (
        p_search is null or p_search = '' or
        o.id::text ilike p_search || '%' or
        tb.table_number ilike '%' || p_search || '%' or
        p.full_name ilike '%' || p_search || '%' or
        p.phone ilike '%' || p_search || '%'
      )
    order by o.created_at desc
    limit p_limit offset p_offset
  ) r;

  return json_build_object('rows', v_rows, 'totalCount', v_total);
end;
$$;

create or replace function public.get_shift_history()
returns json
language plpgsql
set search_path to 'public'
as $$
declare
  v_result json;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  select coalesce(json_agg(row_to_json(h)), '[]'::json) into v_result
  from (
    select
      s.id,
      (extract(epoch from s.opened_at) * 1000)::bigint as "openedAt",
      (extract(epoch from s.closed_at) * 1000)::bigint as "closedAt",
      po.full_name as "openedByName",
      pc.full_name as "closedByName",
      s.starting_cash as "startingCash",
      s.counted_cash as "countedCash",
      (s.counted_cash - (s.starting_cash + coalesce((
        select sum(o.total) from public.orders o
        where o.payment_status = 'paid'
          and o.paid_at >= s.opened_at and o.paid_at <= s.closed_at
          and o.payment_method = 'cash'
      ), 0)))::bigint as "difference",
      coalesce((
        select sum(o.total) from public.orders o
        where o.payment_status = 'paid'
          and o.paid_at >= s.opened_at and o.paid_at <= s.closed_at
      ), 0)::bigint as "totalRevenue"
    from public.shifts s
    left join public.profiles po on po.id = s.opened_by
    left join public.profiles pc on pc.id = s.closed_by
    where s.closed_at is not null
    order by s.closed_at desc
  ) h;

  return v_result;
end;
$$;

create or replace function public.get_shift_report(p_shift_id uuid default null)
returns json
language plpgsql
set search_path to 'public'
as $$
declare
  s public.shifts%rowtype;
  v_window_end timestamptz;
  v_by_method json;
  v_cash_total bigint;
  v_expected bigint;
  v_transactions json;
  v_opened_by_name text;
  v_closed_by_name text;
  v_workers json;
  v_items_sold json;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  if p_shift_id is null then
    select * into s from public.shifts where closed_at is null;
  else
    select * into s from public.shifts where id = p_shift_id;
  end if;
  if s.id is null then
    return null;
  end if;

  v_window_end := coalesce(s.closed_at, now());

  select p.full_name into v_opened_by_name from public.profiles p where p.id = s.opened_by;
  select p.full_name into v_closed_by_name from public.profiles p where p.id = s.closed_by;

  select coalesce(json_agg(row_to_json(m)), '[]'::json) into v_by_method
  from (
    select o.payment_method as method, count(*)::int as count, coalesce(sum(o.total), 0)::bigint as total
    from public.orders o
    where o.payment_status = 'paid'
      and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
      and o.payment_method is not null
    group by o.payment_method
    order by o.payment_method
  ) m;

  select coalesce(sum(o.total), 0) into v_cash_total
  from public.orders o
  where o.payment_status = 'paid'
    and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
    and o.payment_method = 'cash';

  v_expected := s.starting_cash + v_cash_total;

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_transactions
  from (
    select
      o.id,
      (extract(epoch from o.paid_at) * 1000)::bigint as "paidAt",
      o.payment_method as "paymentMethod",
      o.total
    from public.orders o
    where o.payment_status = 'paid'
      and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
      and o.payment_method is not null
    order by o.paid_at desc
  ) r;

  select coalesce(json_agg(row_to_json(w)), '[]'::json) into v_workers
  from (
    select
      sw.staff_id as "staffId",
      p.full_name as "fullName",
      (extract(epoch from sw.joined_at) * 1000)::bigint as "joinedAt",
      case when sw.left_at is null then null else (extract(epoch from sw.left_at) * 1000)::bigint end as "leftAt"
    from public.shift_workers sw
    join public.profiles p on p.id = sw.staff_id
    where sw.shift_id = s.id
    order by sw.joined_at
  ) w;

  select coalesce(json_agg(row_to_json(i)), '[]'::json) into v_items_sold
  from (
    select
      mi.id as "menuItemId",
      mi.name_vi as "nameVi",
      mi.name_en as "nameEn",
      sum(oi.quantity)::int as quantity,
      sum(oi.subtotal)::bigint as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.menu_items mi on mi.id = oi.menu_item_id
    where o.payment_status = 'paid'
      and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
    group by mi.id, mi.name_vi, mi.name_en
    order by quantity desc
  ) i;

  return json_build_object(
    'id', s.id,
    'openedAt', (extract(epoch from s.opened_at) * 1000)::bigint,
    'closedAt', case when s.closed_at is null then null else (extract(epoch from s.closed_at) * 1000)::bigint end,
    'openedByName', v_opened_by_name,
    'closedByName', v_closed_by_name,
    'plannedStartAt', case when s.planned_start_at is null then null else (extract(epoch from s.planned_start_at) * 1000)::bigint end,
    'plannedEndAt', case when s.planned_end_at is null then null else (extract(epoch from s.planned_end_at) * 1000)::bigint end,
    'startingCash', s.starting_cash,
    'countedCash', s.counted_cash,
    'notes', s.notes,
    'byMethod', v_by_method,
    'expectedCash', v_expected,
    'difference', case when s.counted_cash is null then null else s.counted_cash - v_expected end,
    'transactions', v_transactions,
    'workers', v_workers,
    'itemsSold', v_items_sold
  );
end;
$$;

create or replace function public.find_redemption_by_code(p_code text)
returns table(id uuid, reward_name_vi text, reward_name_en text, points_spent integer, redeemed_at timestamptz, fulfilled_at timestamptz, applied_order_id uuid, customer_name text)
language plpgsql
set search_path to 'public'
as $$
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  return query
  select
    rr.id,
    r.name_vi,
    r.name_en,
    rr.points_spent,
    rr.redeemed_at,
    rr.fulfilled_at,
    rr.applied_order_id,
    p.full_name
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  join public.profiles p on p.id = rr.customer_id
  where rr.id::text ilike (p_code || '%')
  order by rr.redeemed_at desc
  limit 5;
end;
$$;
