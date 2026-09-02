-- 0084_settings_authorization_constraints.sql
-- The Settings route is admin-only. Match that product rule in both sides
-- of each UPDATE policy, and enforce the same business ranges that the UI
-- and query layer validate.

alter policy "shop_settings_update_admin" on public.shop_settings
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

alter policy "loyalty_settings_update_admin" on public.loyalty_settings
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

do $$
begin
  if not exists (
    select 1
      from pg_constraint
      where conname = 'shop_settings_tax_rate_range'
        and conrelid = 'public.shop_settings'::regclass
  ) then
    alter table public.shop_settings
      add constraint shop_settings_tax_rate_range
      check (tax_rate >= 0 and tax_rate <= 1);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
      where conname = 'loyalty_settings_earn_rate_positive'
        and conrelid = 'public.loyalty_settings'::regclass
  ) then
    alter table public.loyalty_settings
      add constraint loyalty_settings_earn_rate_positive
      check (earn_rate_vnd_per_point > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
      where conname = 'loyalty_settings_redeem_value_nonnegative'
        and conrelid = 'public.loyalty_settings'::regclass
  ) then
    alter table public.loyalty_settings
      add constraint loyalty_settings_redeem_value_nonnegative
      check (redeem_value_vnd_per_point >= 0);
  end if;
end
$$;
