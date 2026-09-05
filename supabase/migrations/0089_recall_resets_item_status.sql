-- 0089_recall_resets_item_status.sql
-- Real bug found live: recall_last_completed_order (0087) reverted only
-- orders.status back to 'ready', leaving every order_items row still at
-- 'served' from the original hand-over. markOrderItemsServed's own guard
-- (`where status != 'served'`) then matched zero rows on the next "Đã
-- Phục Vụ" tap, so sync_order_status_from_items never re-fired and the
-- order never re-completed -- it sat on the board at 'ready' forever
-- while the client optimistically counted it as completed anyway
-- (useKitchenOrders' serveTable increments completedCount for any
-- order.status === "ready" target regardless of whether the item update
-- actually changed anything).
--
-- Fix: also reset every 'served' item back to 'ready' -- matching the
-- order-level state recall already produces -- so the next hand-over tap
-- is a real update again, not a no-op.
create or replace function public.recall_last_completed_order()
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_order public.orders;
begin
  if v_role is null or v_role not in ('staff', 'manager', 'admin') then
    raise exception 'not authorized';
  end if;

  select * into v_order
  from public.orders
  where status = 'completed'
    and payment_status = 'paid'
    and order_type = 'pickup'
    and completed_at > now() - interval '15 minutes'
  order by completed_at desc
  limit 1
  for update;

  if not found then
    raise exception 'nothing_to_recall';
  end if;

  update public.order_items set status = 'ready' where order_id = v_order.id and status = 'served';

  update public.orders set status = 'ready' where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;
