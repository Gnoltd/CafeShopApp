-- 0066_add_search_path_to_functions.sql
-- Security hardening (2026-07-29 review, L-11): adjust_ingredient_stock
-- and set_order_paid_at were the only two functions in the schema
-- missing `set search_path = public`, inconsistent with every other
-- function. Both are SECURITY INVOKER referencing only public.-qualified
-- tables (or now()/new.* for the trigger), so practical risk was low --
-- added for consistency with the rest of the schema.

create or replace function public.adjust_ingredient_stock(p_ingredient_id uuid, p_change numeric, p_reason inventory_log_reason)
returns ingredients
language plpgsql
set search_path = public
as $$
declare
  v_current numeric;
  v_clamped_change numeric;
  v_row public.ingredients;
begin
  select stock_quantity into v_current
    from public.ingredients
    where id = p_ingredient_id
    for update;

  if v_current is null then
    raise exception 'ingredient % not found', p_ingredient_id;
  end if;

  v_clamped_change := greatest(p_change, -v_current);

  update public.ingredients
    set stock_quantity = round(stock_quantity + v_clamped_change, 2)
    where id = p_ingredient_id
    returning * into v_row;

  insert into public.inventory_logs (ingredient_id, change_quantity, reason, created_by)
    values (p_ingredient_id, v_clamped_change, p_reason, auth.uid());

  return v_row;
end;
$$;

create or replace function public.set_order_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;
