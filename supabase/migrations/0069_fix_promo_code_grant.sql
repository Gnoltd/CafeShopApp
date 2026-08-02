-- 0069_fix_promo_code_grant.sql
-- Platform auto-re-grant gotcha (see supabase/CLAUDE.md) struck again:
-- migration 0068's explicit "grant execute ... to anon, authenticated"
-- did not prevent Supabase's platform-level auto-grant on CREATE
-- FUNCTION from also granting EXECUTE to PUBLIC. Not independently
-- exploitable here (validate_promo_code is deliberately guest-callable
-- with no role gate, and anon+authenticated already cover every real
-- API caller), but revoked for grant-hygiene consistency with this
-- project's established practice (0045, 0047, 0060, 0061).

revoke all on function public.validate_promo_code(text, integer) from public;
grant execute on function public.validate_promo_code(text, integer) to anon, authenticated;
