-- 0070_table_sessions_schema.sql
-- Schema for the live shared table cart / running tab / aggregate
-- payment feature. See
-- docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md.
--
-- Both new tables get a public SELECT policy (using (true)) and
-- deliberately NO insert/update/delete policy. This differs from this
-- project's usual guest-safe pattern of "RPC only, zero direct
-- PostgREST access" -- that pattern alone is not enough here because
-- Supabase Realtime's postgres_changes delivery is itself RLS-gated: a
-- table with RLS enabled and zero SELECT policy delivers no change
-- events to ANY client, guest or not, which would silently break the
-- live-sync requirement this feature exists for. A public SELECT
-- policy is an acceptable trust level for this data (menu items,
-- quantities, notes for an active table's own order -- comparable
-- sensitivity to orders/order_items, which already have broad SELECT
-- policies); writes still only ever happen through the RPCs below, so
-- prices/quantities can never be client-forged the way orders/
-- order_items were before migration 0046.

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id),
  status text not null default 'active' check (status in ('active', 'abandoned', 'closed')),
  payment_pending boolean not null default false,
  checkout_promo_code text,
  checkout_discount_amount integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index table_sessions_table_id_idx on public.table_sessions (table_id);
-- Partial index: the only lookup this feature ever does is "the active
-- session for this table" -- at most one row can match by construction
-- (add_cart_item only creates a new session when none is active).
create unique index table_sessions_one_active_per_table_idx
  on public.table_sessions (table_id) where status = 'active';

alter table public.table_sessions enable row level security;

create policy "table_sessions_select_all" on public.table_sessions
  for select
  using (true);

create table public.table_cart_items (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  size_id uuid references public.menu_item_sizes(id),
  modifier_ids uuid[] not null default array[]::uuid[],
  note text,
  unit_price integer not null,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now()
);

create index table_cart_items_session_idx on public.table_cart_items (table_session_id);

alter table public.table_cart_items enable row level security;

create policy "table_cart_items_select_all" on public.table_cart_items
  for select
  using (true);

alter table public.orders add column table_session_id uuid references public.table_sessions(id);
create index orders_table_session_id_idx on public.orders (table_session_id) where table_session_id is not null;

alter publication supabase_realtime add table public.table_sessions;
alter publication supabase_realtime add table public.table_cart_items;
