-- 0087_recall_last_completed_order.sql
-- Real "Recall" for the KDS: undo a mistaken hand-over on an already-paid
-- pickup order. complete_order_when_served_and_paid (0022) is a BEFORE
-- UPDATE trigger that rewrites NEW.status to 'completed' in-place whenever
-- NEW.status = 'served' AND NEW.payment_status = 'paid' -- so a naive
-- "set status back to served" would be silently re-completed by that same
-- trigger before the UPDATE even commits. Recalling to 'ready' instead
-- sidesteps it entirely (the condition only matches 'served'), with no
-- change to that trigger at all. Once back on the board at "ready", staff
-- re-confirm the same deliberate "Đã Phục Vụ" hand-over as any other order.
--
-- completed_at is new: the only prior timestamps are created_at (order
-- placement) and paid_at (payment_status turning 'paid', which can be
-- *before* completion for a Pay Now order paid at placement) -- neither
-- identifies "the most recently completed order" precisely enough to
-- recall the right one.

alter table public.orders add column if not exists completed_at timestamptz;

create or replace function public.complete_order_when_served_and_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'served' and new.payment_status = 'paid' and old.status is distinct from 'completed' then
    new.status := 'completed';
    new.completed_at := now();
  end if;
  return new;
end;
$$;

-- Guest-safe pattern doesn't apply here (staff-only action), but the same
-- "narrow security definer function, not a broad policy" shape does.
-- Pickup only for this pass: a dine-in order's completion also flips its
-- table to "cleaning" (sync_table_occupancy) and can close its table
-- session -- reconciling those back on a dine-in recall is real, separate
-- design work, not something to bolt on here. Scoped to the last 15
-- minutes (matches the KDS board's own "late ticket" threshold) so a
-- confused tap can't reopen an order from hours or days ago.
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

  update public.orders set status = 'ready' where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.recall_last_completed_order() from public;
grant execute on function public.recall_last_completed_order() to authenticated;
