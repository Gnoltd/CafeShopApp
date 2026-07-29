-- 0065_tighten_get_redemption_expiry.sql
-- Security hardening (2026-07-29 review, L-9): get_redemption_expiry
-- took any redemption UUID with no ownership check, granted to
-- authenticated -- an existence oracle (timestamp only, no other data)
-- for a guessed/leaked redemption UUID. Not called by any client code
-- directly (only internally by place_order, which already validates
-- ownership before ever calling this), so this is pure defense-in-depth:
-- returning null uniformly for "not found" and "not yours" removes the
-- existence-oracle behavior too, not just the ownership gap.
--
-- L-10 (increment_table_scan_count, unauthenticated + unlimited) is
-- left as-is per the review's own assessment -- cosmetic metric
-- inflation only, no real abuse value.

create or replace function public.get_redemption_expiry(p_redemption_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reward_redemptions%rowtype;
  v_spend_since bigint;
begin
  select * into r from public.reward_redemptions where id = p_redemption_id;
  if r.id is null or r.customer_id <> auth.uid() then
    return null;
  end if;

  select coalesce(sum(o.total), 0) into v_spend_since
    from public.orders o
    where o.customer_id = r.customer_id
      and o.payment_status = 'paid'
      and o.paid_at >= r.redeemed_at;

  if v_spend_since > 1000000 then
    return now() + interval '1 year';
  end if;
  return r.redeemed_at + interval '1 year';
end;
$$;
