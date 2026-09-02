begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- Replace only the identity lookup at the test boundary. The real UPDATE
-- grants, RLS policies, tables, and constraints remain in force; rollback
-- restores the production function body.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('test.current_user_role', true), '')::public.user_role;
$$;

set local role authenticated;
select set_config('test.current_user_role', 'manager', true);

select results_eq(
  $$with changed as (
      update public.shop_settings set tax_rate = 0.05 where id = 1 returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'a manager cannot update shop settings'
);

select results_eq(
  $$with changed as (
      update public.loyalty_settings set earn_rate_vnd_per_point = 5000 where id = 1 returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'a manager cannot update loyalty settings'
);

select set_config('test.current_user_role', 'admin', true);

select results_eq(
  $$with changed as (
      update public.shop_settings set tax_rate = 0.05 where id = 1 returning 1
    ) select count(*)::bigint from changed$$,
  $$values (1::bigint)$$,
  'an admin can update shop settings'
);

select results_eq(
  $$with changed as (
      update public.loyalty_settings
        set earn_rate_vnd_per_point = 5000,
            redeem_value_vnd_per_point = 0
        where id = 1
        returning 1
    ) select count(*)::bigint from changed$$,
  $$values (1::bigint)$$,
  'an admin can update loyalty settings'
);

reset role;

select throws_ok(
  $$update public.shop_settings set tax_rate = 1.01 where id = 1$$,
  '23514',
  null,
  'Postgres rejects a tax rate above 100 percent'
);

select throws_ok(
  $$update public.loyalty_settings set earn_rate_vnd_per_point = 0 where id = 1$$,
  '23514',
  null,
  'Postgres rejects a non-positive earning rate'
);

select throws_ok(
  $$update public.loyalty_settings set redeem_value_vnd_per_point = -1 where id = 1$$,
  '23514',
  null,
  'Postgres rejects a negative redemption value'
);

select * from finish();
rollback;
