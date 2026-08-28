-- 0080_confirm_table_cash_payment_touches_session.sql
-- Found by the shared-table-ordering-session feature's final whole-branch
-- review (I-1): guest devices have no Realtime visibility into `orders`
-- at all (RLS -- orders_select_own/orders_select_staff, and a guest
-- round has customer_id null, which matches neither policy; Realtime
-- delivery is itself RLS-gated). confirm_table_cash_payment only ever
-- touched `orders`, so a guest's screen never updated when staff
-- confirmed cash for their table -- table_sessions IS visible to guests
-- (public select-all, migration 0070), so a touch update there gives
-- guests a Realtime signal to refetch via their existing
-- table_sessions subscription. This is a snappy-UX addition, not the
-- full fix -- hooks/useTableSession.tsx separately gains a low-frequency
-- poll fallback (matching this project's existing guest-tracking-page
-- convention) covering every other guest-invisible order-status change
-- (paid -> preparing -> ready -> served) this touch alone doesn't.

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
  if public.current_user_role() is null or public.current_user_role() not in ('staff', 'manager', 'admin') then
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

  if v_updated > 0 then
    -- No-op value update -- table_sessions has no dedicated "touch"
    -- column, and adding one is out of scope for this fix. A plain
    -- UPDATE still generates a WAL/logical-replication change event
    -- regardless of whether the value actually changed, which is all
    -- Supabase Realtime's postgres_changes delivery needs.
    update public.table_sessions set payment_pending = payment_pending where id = v_session_id;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.confirm_table_cash_payment(uuid) from public, anon;
grant execute on function public.confirm_table_cash_payment(uuid) to authenticated;
