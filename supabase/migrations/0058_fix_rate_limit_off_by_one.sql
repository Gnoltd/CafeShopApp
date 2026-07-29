-- 0058_fix_rate_limit_off_by_one.sql
-- Bug found live testing 0057's check_rate_limit() immediately after
-- deploy: the initial INSERT seeded request_count=1 for a brand-new key,
-- then the same call's logic unconditionally incremented it again before
-- returning -- double-counting the first request. Net effect: a
-- max_requests=N limit only ever allowed N-1 requests through before
-- blocking (confirmed live: pay-order's 10/min config blocked starting
-- on the 10th request, not the 11th). Not a security regression (errs
-- toward *more* restrictive), but doesn't match the documented/intended
-- threshold. Fix: seed a new key's row at 0 so the first call's
-- increment is the only increment it receives.

create or replace function public.check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  insert into public.edge_rate_limits (key, window_start, request_count)
  values (p_key, now(), 0)
  on conflict (key) do nothing;

  select window_start, request_count into v_window_start, v_count
    from public.edge_rate_limits
    where key = p_key
    for update;

  if now() - v_window_start > make_interval(secs => p_window_seconds) then
    update public.edge_rate_limits
       set window_start = now(), request_count = 1
       where key = p_key;
    return true;
  end if;

  if v_count >= p_max_requests then
    return false;
  end if;

  update public.edge_rate_limits
     set request_count = request_count + 1
     where key = p_key;
  return true;
end;
$$;
