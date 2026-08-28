-- 0075_fix_confirm_table_cash_payment_role_check.sql
-- Follow-up to 0074. Two problems found by checking live grants/behavior
-- immediately after creating confirm_table_cash_payment, per this
-- project's documented convention (see CLAUDE.md's "Live-grant
-- auto-re-grant gotcha"):
--
-- 1. Despite 0074's `revoke all ... grant ... to authenticated` (no
--    anon), Supabase's platform-level auto-grant on CREATE FUNCTION
--    left `anon` with EXECUTE anyway -- the same recurring gap fixed
--    before in migrations 0045/0047/0060/0061.
-- 2. confirm_table_cash_payment's role check
--    (`current_user_role() not in (...)`) omitted the `is null or`
--    guard every sibling staff-only function in this codebase carries
--    (get_dashboard_stats, get_shift_history, find_redemption_by_code,
--    etc. -- all fixed by 0048/0062). current_user_role() returns NULL
--    when there's no matching profiles row for auth.uid(); PL/pgSQL's
--    `IF NULL THEN` is false, so the exception was silently skipped.
--    Combined with #1's stray anon grant, an anonymous caller could
--    call this function and mark a table's cash orders paid, bypassing
--    the staff-only gate entirely.

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
  return v_updated;
end;
$$;

revoke all on function public.confirm_table_cash_payment(uuid) from public, anon;
grant execute on function public.confirm_table_cash_payment(uuid) to authenticated;
