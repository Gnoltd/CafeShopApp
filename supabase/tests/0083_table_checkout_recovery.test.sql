begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.tables (id, table_number, qr_code_token)
values (
  '83000000-0000-4000-8000-000000000001',
  'task-1-recovery-test',
  'task-1-recovery-token'
);

insert into public.table_sessions (
  id,
  table_id,
  payment_pending,
  checkout_attempt_id,
  checkout_started_at
)
values (
  '83000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000001',
  true,
  '83000000-0000-4000-8000-000000000003',
  now()
);

set local role anon;

select is(
  public.release_table_checkout(
    'task-1-recovery-token',
    '83000000-0000-4000-8000-000000000004'
  ),
  false,
  'a mismatched attempt cannot release the checkout lock'
);

select is(
  (select payment_pending from public.table_sessions where id = '83000000-0000-4000-8000-000000000002'),
  true,
  'the mismatched release leaves the checkout locked'
);

select is(
  public.release_table_checkout(
    'task-1-recovery-token',
    '83000000-0000-4000-8000-000000000003'
  ),
  true,
  'the matching unfinished attempt is released'
);

select is(
  (select payment_pending from public.table_sessions where id = '83000000-0000-4000-8000-000000000002'),
  false,
  'the matching release clears the checkout lock'
);

reset role;

update public.table_sessions
  set payment_pending = false,
      checkout_attempt_id = '83000000-0000-4000-8000-000000000005',
      checkout_started_at = now()
  where id = '83000000-0000-4000-8000-000000000002';

set local role anon;

select is(
  public.release_table_checkout(
    'task-1-recovery-token',
    '83000000-0000-4000-8000-000000000005'
  ),
  false,
  'a completed checkout cannot be released'
);

select is(
  (select checkout_attempt_id from public.table_sessions where id = '83000000-0000-4000-8000-000000000002'),
  '83000000-0000-4000-8000-000000000005'::uuid,
  'a completed checkout retains its attempt identifier'
);

reset role;

update public.table_sessions
  set payment_pending = false,
      checkout_attempt_id = null,
      checkout_started_at = null
  where id = '83000000-0000-4000-8000-000000000002';

insert into public.orders (
  id,
  order_type,
  table_id,
  status,
  payment_method,
  payment_status,
  subtotal,
  total,
  table_session_id
)
values (
  '83000000-0000-4000-8000-000000000006',
  'dine_in',
  '83000000-0000-4000-8000-000000000001',
  'served',
  null,
  'pending',
  100000,
  100000,
  '83000000-0000-4000-8000-000000000002'
);

set local role anon;

select ok(
  (public.checkout_table_session(
    'task-1-recovery-token',
    'stripe',
    null
  )->>'checkoutAttemptId')::uuid is not null,
  'gateway checkout returns a persisted attempt identifier'
);

select * from finish();
rollback;
