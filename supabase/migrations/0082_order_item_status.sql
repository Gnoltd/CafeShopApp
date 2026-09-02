-- 0082_order_item_status.sql
-- Per-item kitchen status. Today order_items has no status at all --
-- orders.status is the only place kitchen progress lives, so a whole
-- order (e.g. a table round with several drinks) can only ever advance
-- as one block. This adds order_items.status and makes orders.status a
-- derived roll-up of its items, so every existing downstream trigger
-- (complete_order_when_served_and_paid, sync_table_occupancy) and every
-- payment webhook keeps working off orders.status unmodified. See
-- docs/superpowers/specs/2026-09-02-per-item-kitchen-status-design.md.

create type public.order_item_status as enum ('preparing', 'ready', 'served');

alter table public.order_items
  add column status public.order_item_status not null default 'preparing';

-- Backfill: an item under an order that already reached served/completed
-- before this migration is itself already served -- a fresh 'preparing'
-- default would misrepresent already-finished orders as freshly started.
update public.order_items oi
set status = 'served'
from public.orders o
where o.id = oi.order_id
  and o.status in ('served', 'completed');

-- order_items previously had no UPDATE policy at all (0005 only granted
-- select/insert), so staff could not touch it. This staff-only policy
-- is paired with a column-scoped grant below -- UPDATE privilege is
-- independent of SELECT/RLS (the lesson from migration 0049), so a
-- broad table-level grant inherited from schema defaults would let
-- staff overwrite price/quantity/menu_item_id too if left ungated.
create policy "order_items_update_staff" on public.order_items for update
  using (public.current_user_role() in ('staff', 'manager', 'admin'))
  with check (public.current_user_role() in ('staff', 'manager', 'admin'));

-- Revoke from both anon and authenticated (not just authenticated) --
-- matches this project's established pattern (migration 0047): a
-- column-level grant can't narrow an already-broader table-level grant
-- inherited from Supabase's schema defaults, so the blanket grant must
-- be revoked from every role it was given to before re-granting narrow.
revoke update on public.order_items from anon, authenticated;
grant update (status) on public.order_items to authenticated;

-- Recomputes the parent order's status whenever an item's status
-- changes. Only fires on order_items UPDATE, not INSERT: a fresh
-- order's items already default to 'preparing' at insert time, but the
-- parent order is left exactly as place_order/the payment webhook set
-- it (e.g. 'paid') until staff actually ticks the first item --
-- preserving the KDS board's "New" column as "kitchen hasn't touched
-- this order yet."
create or replace function public.sync_order_status_from_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := new.order_id;
  v_current_status order_status;
  v_new_status order_status;
begin
  select status into v_current_status from public.orders where id = v_order_id;

  -- Only orders actively moving through the kitchen are item-derived.
  -- pending_payment (not kitchen-visible yet), cancelled, and completed
  -- are set by other paths and must not be overwritten here.
  if v_current_status not in ('paid', 'preparing', 'ready', 'served') then
    return new;
  end if;

  select case
    when bool_and(status = 'served') then 'served'
    when bool_or(status = 'preparing') then 'preparing'
    else 'ready'
  end into v_new_status
  from public.order_items
  where order_id = v_order_id;

  update public.orders set status = v_new_status
    where id = v_order_id and status is distinct from v_new_status;

  return new;
end;
$$;

drop trigger if exists on_order_item_status_change on public.order_items;
create trigger on_order_item_status_change
  after update of status on public.order_items
  for each row
  execute function public.sync_order_status_from_items();

alter publication supabase_realtime add table public.order_items;
