-- Follow-up to 0091 -- Supabase's platform-level auto-grant re-added anon
-- EXECUTE on confirm_table_payment despite that migration's own revoke.
-- Not independently exploitable (the function itself rejects any caller
-- whose role isn't staff/manager/admin), but grant-hygiene follow-up to
-- match every other SECURITY DEFINER function in this project (see the
-- "Live-grant auto-re-grant gotcha" note in supabase/CLAUDE.md).

revoke execute on function public.confirm_table_payment(uuid, payment_method) from anon;
