-- 0079_close_table_row_qr_token_leak.sql
-- CRITICAL, found by the shared-table-ordering-session feature's final
-- whole-branch review. Pre-existing (since migration 0012/0021), but this
-- feature is what makes it load-bearing: migration 0077 switched every
-- guest-callable table-session RPC from a raw table_id to qr_token on the
-- grounds that qr_code_token has zero SELECT grant to anon/authenticated
-- (0046/0047), unlike the openly-enumerable tables.id -- but that grant
-- check alone is insufficient. increment_table_scan_count and
-- notify_table_cleaning are both anon-executable SECURITY DEFINER
-- functions that `return tables` (the WHOLE row, qr_code_token included)
-- -- a SECURITY DEFINER function's composite return value is NOT
-- constrained by column-level grants (the same mechanism
-- lib/supabase/tables-data.ts's own comment on get_tables_admin already
-- documents, just without a role check here). Confirmed live:
--
--   select pg_get_functiondef('public.increment_table_scan_count'::regproc);
--   -- returns tables, no role check, granted to anon
--
-- Any anon-key holder can `select id from tables` (tables_select_all is
-- using (true)) then call increment_table_scan_count(id) to read back
-- qr_code_token for ANY table -- completely bypassing 0077's security
-- premise. notify_table_cleaning has the same shape, gated only on
-- status = 'cleaning' (an attacker-uncontrolled but observable condition).
--
-- Fix: narrow both functions' return shape to exactly the columns
-- lib/supabase/tables-data.ts's own TABLE_SELECT_SAFE already treats as
-- the safe/public set -- qr_code_token is never selected, so it can't
-- appear in the RPC response regardless of what the client-side TS layer
-- does with it afterward.

-- CREATE OR REPLACE cannot change a function's return type (RETURNS
-- tables -> RETURNS TABLE(...) is a different signature) -- must drop
-- first.
drop function if exists public.increment_table_scan_count(uuid);
drop function if exists public.notify_table_cleaning(uuid);

create or replace function public.increment_table_scan_count(p_table_id uuid)
returns table (
  id uuid,
  table_number text,
  location_vi text,
  location_en text,
  status public.table_occupancy_status,
  cleaning_notified_at timestamptz,
  scan_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.tables t
    set scan_count = t.scan_count + 1
    where t.id = p_table_id
    returning t.id, t.table_number, t.location_vi, t.location_en, t.status, t.cleaning_notified_at, t.scan_count;

  if not found then
    raise exception 'table % not found', p_table_id;
  end if;
end;
$$;

create or replace function public.notify_table_cleaning(p_table_id uuid)
returns table (
  id uuid,
  table_number text,
  location_vi text,
  location_en text,
  status public.table_occupancy_status,
  cleaning_notified_at timestamptz,
  scan_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.tables t
    set cleaning_notified_at = now()
    where t.id = p_table_id and t.status = 'cleaning'
    returning t.id, t.table_number, t.location_vi, t.location_en, t.status, t.cleaning_notified_at, t.scan_count;

  if not found then
    raise exception 'table % not found or not cleaning', p_table_id;
  end if;
end;
$$;

-- Drop + create loses prior grants; re-issue explicitly per this
-- project's documented live-grant convention (grants must be checked
-- live afterward, not assumed from migration text -- see the
-- auto-re-grant gotcha in CLAUDE.md).
revoke all on function public.increment_table_scan_count(uuid) from public;
grant execute on function public.increment_table_scan_count(uuid) to anon, authenticated;

revoke all on function public.notify_table_cleaning(uuid) from public;
grant execute on function public.notify_table_cleaning(uuid) to anon, authenticated;
