-- 0073_close_table_session_on_complete.sql
-- Full redefinition of sync_table_occupancy (unchanged body from
-- migration 0021 except: the existing "no other active order for this
-- table -> cleaning" branch also closes the table's active
-- table_sessions row). No trigger definition change needed -- the
-- existing unscoped `after insert or update` trigger (migration 0024)
-- already fires on every relevant transition.

create or replace function public.sync_table_occupancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.order_type = 'dine_in' and new.table_id is not null then
      update public.tables
      set status = 'occupied', cleaning_notified_at = null
      where id = new.table_id;
    end if;
    return new;
  end if;

  if new.table_id is not null
     and new.status in ('completed', 'cancelled')
     and old.status not in ('completed', 'cancelled') then
    if not exists (
      select 1 from public.orders
      where table_id = new.table_id
        and status not in ('completed', 'cancelled')
        and id <> new.id
    ) then
      update public.tables set status = 'cleaning' where id = new.table_id;
      update public.table_sessions set status = 'closed', ended_at = now()
        where table_id = new.table_id and status = 'active';
    end if;
  end if;

  return new;
end;
$$;
