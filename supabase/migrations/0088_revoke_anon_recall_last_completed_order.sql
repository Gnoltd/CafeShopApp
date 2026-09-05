-- 0088_revoke_anon_recall_last_completed_order.sql
-- Same platform auto-re-grant gotcha as 0045/0047/0060/0061/0069/0075:
-- Supabase's default privileges on CREATE FUNCTION re-granted anon EXECUTE
-- on recall_last_completed_order despite 0087's own revoke+grant in the
-- same migration. The function's own role check already rejects an anon
-- caller (raises 'not authorized'), but the grant itself should still not
-- exist -- defense in depth, matching 0062's reasoning.
revoke execute on function public.recall_last_completed_order() from anon;
