-- KDS payment confirmation stops being cash-only: staff can confirm a
-- table's (or a single served pickup order's) unpaid balance as paid via
-- whichever method the customer actually used (cash/card/vnpay), correcting
-- it on the spot if it differs from what the customer pre-selected on their
-- own phone. Replaces confirm_table_cash_payment (cash-hardcoded) and the
-- separate markTableCashPayment "set method with no method chosen yet"
-- step -- both collapse into one action.
--
-- Also switches the table-level match from table_sessions.table_id to
-- orders.table_id directly: confirm_table_cash_payment only reached orders
-- with a table_session_id set (the shared-cart QR flow), silently missing
-- a plain dine-in order placed via regular checkout with a table selected
-- (table_id set, table_session_id null) -- markTableCashPayment already
-- matched on table_id directly, so this also closes that inconsistency
-- rather than carrying it into the replacement.

drop function if exists public.confirm_table_cash_payment(uuid);

create or replace function public.confirm_table_payment(p_table_id uuid, p_method payment_method)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_updated integer;
begin
  if v_role is null or v_role not in ('staff', 'manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  update public.orders set payment_method = p_method, payment_status = 'paid'
    where table_id = p_table_id
      and payment_status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.confirm_table_payment(uuid, payment_method) from public;
grant execute on function public.confirm_table_payment(uuid, payment_method) to authenticated;
