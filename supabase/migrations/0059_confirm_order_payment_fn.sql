-- 0059_confirm_order_payment_fn.sql
-- Backfill: applied live 2026-07-28 (as "confirm_order_payment_fn") but
-- never committed to the repo -- part of an in-progress architecture
-- consolidation (docs/superpowers/plans/2026-07-29-architecture-deepening.md)
-- that hadn't yet wired any client code through this RPC when the drift
-- was discovered. Collapses the served-vs-not "mark this order's
-- payment as cleared" branch into one RPC, intended to be callable
-- identically from Stripe/VNPay's service-role webhooks and from an
-- authenticated staff client (POS/KDS cash confirm) -- rejecting a
-- logged-in non-staff caller (a plain customer) via the runtime check
-- below. See 0060 for a live-grant-audit finding this migration's own
-- revoke/grant didn't fully close.
--
-- auth.uid() is null when called via the service-role key (no user JWT
-- on the request at all), so "auth.uid() is not null and ... not in
-- (...)" short-circuits to false for webhook callers -- only a
-- logged-in non-staff caller (a plain customer) is rejected by this
-- runtime check.

create or replace function public.confirm_order_payment(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.order_status;
  v_updated int;
begin
  if auth.uid() is not null and public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not authorized to confirm payment';
  end if;

  select status into v_status from public.orders where id = p_order_id and payment_status = 'pending';
  if not found then
    return false;
  end if;

  if v_status = 'served' then
    update public.orders set payment_status = 'paid'
      where id = p_order_id and payment_status = 'pending';
  else
    update public.orders set status = 'paid', payment_status = 'paid'
      where id = p_order_id and payment_status = 'pending';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.confirm_order_payment(uuid) from public;
grant execute on function public.confirm_order_payment(uuid) to authenticated, service_role;
