-- 0064_add_with_check_to_update_policies.sql
-- Security hardening (2026-07-29 review, L-8): profiles_update_admin
-- (0001) and the shop_settings/loyalty_settings UPDATE policies (0002)
-- specify USING but not WITH CHECK, allowing a row to be mutated into a
-- state the USING clause wouldn't itself re-permit. All three are
-- already backstopped in practice (prevent_role_self_change trigger +
-- narrowed column grants for profiles; manager/admin-only reach for the
-- config tables), so residual risk was negligible -- this closes the
-- asymmetry for consistency with the correctly-written
-- profiles_update_own (which already has both clauses).

alter policy "profiles_update_admin" on public.profiles
  with check (public.current_user_role() = 'admin');

alter policy "shop_settings_update_admin" on public.shop_settings
  with check (public.current_user_role() in ('manager', 'admin'));

alter policy "loyalty_settings_update_admin" on public.loyalty_settings
  with check (public.current_user_role() in ('manager', 'admin'));
