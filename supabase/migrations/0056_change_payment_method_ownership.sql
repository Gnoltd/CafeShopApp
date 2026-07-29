-- 0056_change_payment_method_ownership.sql
-- Security fix (2026-07-29 review, finding M-4/L-7): the original
-- change_order_payment_method (0032) updated by p_order_id with only a
-- status guard and NO ownership check, so anyone holding a served-unpaid
-- order's UUID could change or null-out its recorded payment method
-- (griefing / staff confusion — not theft, since it can't mark an order
-- paid). Bring it in line with cancel_pending_order (0018): reject when
-- the order belongs to a real account that isn't the caller, while still
-- allowing the guest/null-customer capability path the rest of the
-- deferred-payment flow relies on. The final UPDATE keeps the
-- served+pending guard in its WHERE, so a concurrent state transition
-- can't corrupt a now-paid order (closes the L-7 TOCTOU window).

create or replace function public.change_order_payment_method(
  p_order_id uuid,
  p_method payment_method default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_updated int;
begin
  select customer_id into v_customer_id from public.orders
    where id = p_order_id
      and status = 'served'
      and payment_status = 'pending';

  if not found then
    return false;
  end if;

  if v_customer_id is not null and v_customer_id != auth.uid() then
    raise exception 'not authorized to change this order''s payment method';
  end if;

  update public.orders
    set payment_method = p_method
    where id = p_order_id
      and status = 'served'
      and payment_status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.change_order_payment_method(uuid, payment_method) from public;
grant execute on function public.change_order_payment_method(uuid, payment_method) to anon, authenticated;
