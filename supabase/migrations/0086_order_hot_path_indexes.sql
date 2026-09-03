-- 0086: measured indexes for order/dashboard hot paths.
--
-- The live performance advisor identified the order_items(order_id),
-- orders(customer_id), and orders(table_id) foreign keys as unindexed.
-- EXPLAIN plans also showed sequential scans for customer history and the
-- paid-order dashboard/rollup date windows. Keep these indexes narrow and
-- aligned with the predicates used by the application.

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists orders_customer_id_idx
  on public.orders (customer_id);

create index if not exists orders_table_id_idx
  on public.orders (table_id);

create index if not exists orders_paid_created_at_idx
  on public.orders (created_at)
  where payment_status = 'paid';

-- Preserve the public API while making Vietnam-local day boundaries sargable.
-- `created_at` is timestamptz, so these bounds are converted once from the
-- Asia/Ho_Chi_Minh calendar date into UTC instants and can use the index
-- above. The function remains security-invoker and keeps its existing role
-- check as defense in depth.
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_today_start timestamptz := v_today::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_tomorrow_start timestamptz := (v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_seven_day_start timestamptz := (v_today - 6)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_result jsonb;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'todayRevenue', coalesce((
      select sum(total) from public.orders
      where payment_status = 'paid'
        and created_at >= v_today_start
        and created_at < v_tomorrow_start
    ), 0),
    'ordersToday', coalesce((
      select count(*) from public.orders
      where payment_status = 'paid'
        and created_at >= v_today_start
        and created_at < v_tomorrow_start
    ), 0),
    'loyaltyIssuedToday', coalesce((
      select sum(points_change) from public.loyalty_transactions
      where type = 'earn'
        and created_at >= v_today_start
        and created_at < v_tomorrow_start
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
          and created_at >= v_seven_day_start
          and created_at < v_tomorrow_start
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
          and o.created_at >= v_seven_day_start
          and o.created_at < v_tomorrow_start
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

grant execute on function public.get_dashboard_stats() to authenticated;
