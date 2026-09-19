-- 0093_revoke_auto_regrant_dashboard_and_checkout_session_url.sql
-- Re-applying 0083-0086 (previously skipped on this live project) triggered
-- Supabase's platform-level auto-grant behavior on CREATE OR REPLACE
-- FUNCTION again -- the same recurring gotcha documented in CLAUDE.md
-- (already bitten this project at least four times: 0045, 0047, 0060,
-- 0061, 0069, 0075, 0088, 0092). Checked live via
-- information_schema.role_routine_grants immediately after applying
-- 0083-0086 and found two functions re-granted beyond their migration's
-- own intent:
--   - get_dashboard_stats(): migration 0086 only grants to `authenticated`,
--     but PUBLIC and anon also ended up with EXECUTE. Low severity (the
--     function's own internal role check still blocks non-staff), but
--     against the stated intent.
--   - record_table_checkout_session(text, uuid, text): migration 0085's
--     own comment says this is an internal persistence hook that must
--     stay service_role-only (exposing it to guests lets a caller poison
--     a pending table's stored gateway redirect URL) -- but anon and
--     authenticated also ended up with EXECUTE. This one is a real gap:
--     revoke it now.

revoke all on function public.get_dashboard_stats() from public, anon;
grant execute on function public.get_dashboard_stats() to authenticated;

revoke all on function public.record_table_checkout_session(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_table_checkout_session(text, uuid, text)
  to service_role;
