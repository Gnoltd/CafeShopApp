-- 0056_confirm_order_payment_fn.sql
-- Collapses the served-vs-not "mark this order's payment as cleared"
-- branch into one RPC, callable identically from Stripe/VNPay's
-- service-role webhooks and from an authenticated staff client (POS/KDS
-- cash confirm). Previously this branch was independently re-derived in
-- three places: hooks/useKitchenOrders.tsx's confirmCashPayment (from a
-- possibly-stale client-side order list -- a real race that could
-- silently revert an already-served cash order back to 'paid'),
-- stripe-webhook, and vnpay-ipn (both via the now-removed
-- _shared/order-status.ts buildPaidUpdate helper). See the 2026-07-29
-- architecture review and docs/superpowers/plans/2026-07-29-architecture-deepening.md.
--
-- auth.uid() is null when called via the service-role key (no user JWT
-- on the request at all), so "auth.uid() is not null and ... not in
-- (...)" short-circuits to false for webhook callers -- only a
-- logged-in non-staff caller (a plain customer) is rejected.

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
