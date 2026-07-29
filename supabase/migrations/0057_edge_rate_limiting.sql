-- 0057_edge_rate_limiting.sql
-- Security fix (2026-07-29 review, finding M-5): place-order and
-- pay-order are both verify_jwt-disabled (a guest must be able to place
-- and pay for an order with no session), which also means neither has
-- any request throttling -- unlimited anonymous order creation
-- (place-order's payAt:'later' path goes straight to the kitchen board
-- with no payment gate at all) and unlimited Stripe/VNPay session
-- creation. A plain in-memory counter inside the Edge Function would
-- not actually work here: Deno Deploy runs multiple isolate instances
-- behind the one function URL, so per-instance state doesn't add up to
-- a real global limit. This table + function give a single, atomic,
-- globally-consistent counter shared across every instance, called by
-- the Edge Functions' service-role client before doing any real work
-- (see _shared/rate-limit.ts).

create table if not exists public.edge_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  request_count int not null default 1
);

-- Never client-readable -- callers only ever get true/false back from
-- check_rate_limit(), and this table's job is to enforce a limit, not
-- serve as an audit log.
alter table public.edge_rate_limits enable row level security;

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
  -- Ensure a row exists for this key without erroring on a concurrent
  -- first-request race (two guests hitting a brand-new key at once).
  insert into public.edge_rate_limits (key, window_start, request_count)
  values (p_key, now(), 1)
  on conflict (key) do nothing;

  -- Lock this key's row so two concurrent requests for the SAME key
  -- serialize here rather than both reading the same stale count and
  -- both incrementing past the limit.
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

-- service_role only -- called exclusively from the Edge Functions' own
-- service-role client, never meant to be invoked from the browser
-- (matching the established pattern for internal-only functions, e.g.
-- set_initial_staff_role, 0017/0045).
revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
