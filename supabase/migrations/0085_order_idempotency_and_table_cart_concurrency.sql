-- 0085: make client retries safe and shared-table mutations atomic.
--
-- The existing place_order implementation contains the authoritative pricing,
-- promotion, loyalty, inventory and payment logic. Rename it and put a small
-- idempotency wrapper in front of it rather than copying that large function
-- body (which would make future fixes diverge between the two paths).

alter table public.orders add column if not exists submission_id uuid;
create unique index if not exists orders_submission_id_uidx
  on public.orders (submission_id) where submission_id is not null;

alter table public.table_cart_items
  add column if not exists version bigint not null default 0;

alter table public.table_sessions
  add column if not exists checkout_order_ids jsonb not null default '[]'::jsonb,
  add column if not exists checkout_charge_total integer,
  add column if not exists checkout_session_url text;

create table if not exists public.table_round_submissions (
  submission_id uuid primary key,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  total integer not null,
  created_at timestamptz not null default now()
);
alter table public.table_round_submissions enable row level security;
revoke all on public.table_round_submissions from anon, authenticated;

-- Serialize all operations for one checkout attempt. This avoids the
-- "both callers check, then both insert" race before the unique index is
-- reached, so promotions/loyalty are never evaluated twice.
alter function public.place_order(jsonb) rename to place_order_legacy;
create or replace function public.place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_id uuid := nullif(p_payload->>'submissionId', '')::uuid;
  v_existing record;
  v_result jsonb;
begin
  if v_submission_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_submission_id::text, 0));
    select id, total into v_existing
      from public.orders
      where submission_id = v_submission_id;
    if v_existing.id is not null then
      return jsonb_build_object('orderId', v_existing.id, 'total', v_existing.total, 'deduplicated', true);
    end if;
  end if;

  v_result := public.place_order_legacy(p_payload);

  if v_submission_id is not null then
    update public.orders set submission_id = v_submission_id
      where id = (v_result->>'orderId')::uuid;
  end if;
  return v_result;
end;
$$;
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- Keep one gateway attempt id across a response timeout and retry. The
-- recovery migration already stores an attempt id; this overload replaces
-- its random value with the caller's stable id while the RPC transaction is
-- still holding the session lock.
alter function public.checkout_table_session(text, public.payment_method, text)
  rename to checkout_table_session_legacy;
create or replace function public.checkout_table_session(
  p_qr_token text, p_method public.payment_method, p_promo_code text, p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_result jsonb; v_session_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_attempt_id::text, p_qr_token), 0));
  select id into v_session_id
    from public.table_sessions ts join public.tables t on t.id = ts.table_id
    where t.qr_code_token = p_qr_token and ts.status = 'active'
      and ts.payment_pending and ts.checkout_attempt_id = p_attempt_id
    for update;
  if v_session_id is not null then
    return jsonb_build_object(
      'tableSessionId', v_session_id,
      'orderIds', (select checkout_order_ids from public.table_sessions where id = v_session_id),
      'chargeTotal', (select checkout_charge_total from public.table_sessions where id = v_session_id),
      'checkoutAttemptId', p_attempt_id,
      'checkoutSessionUrl', (select checkout_session_url from public.table_sessions where id = v_session_id)
    );
  end if;
  v_result := public.checkout_table_session_legacy(p_qr_token, p_method, p_promo_code);
  if p_method in ('stripe', 'vnpay') then
    v_session_id := (v_result->>'tableSessionId')::uuid;
    update public.table_sessions set checkout_attempt_id = p_attempt_id
      , checkout_order_ids = v_result->'orderIds',
        checkout_charge_total = (v_result->>'chargeTotal')::integer,
        checkout_session_url = null
      where id = v_session_id and payment_pending;
    v_result := jsonb_set(v_result, '{checkoutAttemptId}', to_jsonb(p_attempt_id), true);
  end if;
  return v_result;
end;
$$;
revoke all on function public.checkout_table_session(text, public.payment_method, text, uuid) from public;
grant execute on function public.checkout_table_session(text, public.payment_method, text, uuid) to anon, authenticated;
create or replace function public.checkout_table_session(
  p_qr_token text, p_method public.payment_method, p_promo_code text default null
)
returns jsonb language sql security definer set search_path = public
as $$ select public.checkout_table_session(p_qr_token, p_method, p_promo_code, gen_random_uuid()) $$;
revoke all on function public.checkout_table_session(text, public.payment_method, text) from public;
grant execute on function public.checkout_table_session(text, public.payment_method, text) to anon, authenticated;

create or replace function public.record_table_checkout_session(
  p_qr_token text, p_attempt_id uuid, p_checkout_url text
)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_table_id uuid; v_updated integer;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  update public.table_sessions set checkout_session_url = p_checkout_url
    where table_id = v_table_id and status = 'active' and payment_pending
      and checkout_attempt_id = p_attempt_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
revoke all on function public.record_table_checkout_session(text, uuid, text) from public;
grant execute on function public.record_table_checkout_session(text, uuid, text) to anon, authenticated;

-- Include the optimistic version in the guest-visible cart snapshot. The
-- client needs this token to reject stale edits instead of overwriting a
-- quantity changed by another device.
create or replace function public.get_table_session(p_qr_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_table_id uuid; v_session record; v_result jsonb;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then raise exception 'table_not_found'; end if;
  select * into v_session from public.table_sessions where table_id = v_table_id and status = 'active';
  if v_session.id is null then
    return jsonb_build_object('session', null, 'cartItems', '[]'::jsonb, 'rounds', '[]'::jsonb, 'unpaidTotal', 0);
  end if;
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id, 'paymentPending', v_session.payment_pending,
      'checkoutPromoCode', v_session.checkout_promo_code,
      'checkoutDiscountAmount', v_session.checkout_discount_amount
    ),
    'cartItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ci.id, 'menuItemId', ci.menu_item_id, 'nameVi', mi.name_vi,
      'nameEn', mi.name_en, 'sizeId', ci.size_id,
      'modifierIds', to_jsonb(ci.modifier_ids), 'note', ci.note,
      'unitPrice', ci.unit_price, 'quantity', ci.quantity, 'version', ci.version
    ) order by ci.updated_at) from public.table_cart_items ci
      join public.menu_items mi on mi.id = ci.menu_item_id
      where ci.table_session_id = v_session.id), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'createdAt', extract(epoch from o.created_at) * 1000,
      'status', o.status, 'paymentStatus', o.payment_status,
      'paymentMethod', o.payment_method, 'subtotal', o.subtotal,
      'taxAmount', o.tax_amount, 'total', o.total,
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'nameVi', mi2.name_vi, 'nameEn', mi2.name_en,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'note', oi.note,
        'sizeId', oi.size_id,
        'modifierIds', coalesce((select jsonb_agg(oim.modifier_id) from public.order_item_modifiers oim where oim.order_item_id = oi.id), '[]'::jsonb)
      )), '[]'::jsonb) from public.order_items oi join public.menu_items mi2 on mi2.id = oi.menu_item_id where oi.order_id = o.id)
    ) order by o.created_at) from public.orders o where o.table_session_id = v_session.id), '[]'::jsonb),
    'unpaidTotal', coalesce((select sum(total) from public.orders where table_session_id = v_session.id and payment_status = 'pending'), 0)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_table_session(text) from public;
grant execute on function public.get_table_session(text) to anon, authenticated;

-- Lock the table row before the legacy function resolves/creates its active
-- session. The unique active-session index remains a final backstop, while
-- this lock makes simultaneous first adds deterministic and cheap.
alter function public.add_cart_item(text, uuid, uuid, uuid[], text, integer)
  rename to add_cart_item_legacy;
create or replace function public.add_cart_item(
  p_qr_token text, p_menu_item_id uuid, p_size_id uuid,
  p_modifier_ids uuid[], p_note text, p_quantity integer
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_table_id uuid; v_result uuid;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token for update;
  if v_table_id is null then raise exception 'table_not_found'; end if;
  v_result := public.add_cart_item_legacy(p_qr_token, p_menu_item_id, p_size_id, p_modifier_ids, p_note, p_quantity);
  return v_result;
end;
$$;
revoke all on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer) from public;
grant execute on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer) to anon, authenticated;

-- Delta-based mutation: two devices adding +1 concurrently both contribute
-- to the quantity. expected_version makes stale absolute edits detectable;
-- callers can refetch and retry rather than silently overwriting a change.
create or replace function public.update_cart_item_quantity_delta(
  p_qr_token text, p_cart_item_id uuid, p_delta integer, p_expected_version bigint
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_table_id uuid; v_item record; v_next integer;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token;
  if v_table_id is null then raise exception 'table_not_found'; end if;
  select ci.quantity, ci.version, ts.table_id into v_item
    from public.table_cart_items ci join public.table_sessions ts on ts.id = ci.table_session_id
    where ci.id = p_cart_item_id and ts.table_id = v_table_id and ts.status = 'active'
    for update;
  if v_item.quantity is null then raise exception 'cart_item_not_found'; end if;
  if p_expected_version is not null and v_item.version <> p_expected_version then
    raise exception 'stale_cart_item';
  end if;
  v_next := v_item.quantity + p_delta;
  if v_next <= 0 then
    delete from public.table_cart_items where id = p_cart_item_id;
    return jsonb_build_object('deleted', true, 'version', v_item.version + 1);
  end if;
  update public.table_cart_items
    set quantity = v_next, version = version + 1, updated_at = now()
    where id = p_cart_item_id;
  return jsonb_build_object('quantity', v_next, 'version', v_item.version + 1);
end;
$$;
revoke all on function public.update_cart_item_quantity_delta(text, uuid, integer, bigint) from public;
grant execute on function public.update_cart_item_quantity_delta(text, uuid, integer, bigint) to anon, authenticated;

-- Idempotent table rounds. The session lock is held by the wrapper while the
-- legacy function consumes the draft cart, so a response timeout followed by
-- a retry returns the original order instead of placing another round.
alter function public.place_table_round(text) rename to place_table_round_legacy;
create or replace function public.place_table_round(p_qr_token text, p_submission_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_table_id uuid; v_session_id uuid; v_existing record; v_result jsonb;
begin
  select id into v_table_id from public.tables where qr_code_token = p_qr_token for update;
  if v_table_id is null then raise exception 'table_not_found'; end if;
  select id into v_session_id from public.table_sessions where table_id = v_table_id and status = 'active' for update;
  if v_session_id is null then raise exception 'no_active_session'; end if;
  if p_submission_id is not null then
    select order_id, total into v_existing from public.table_round_submissions
      where submission_id = p_submission_id;
    if v_existing.order_id is not null then
      return jsonb_build_object('orderId', v_existing.order_id, 'total', v_existing.total, 'deduplicated', true);
    end if;
  end if;
  v_result := public.place_table_round_legacy(p_qr_token);
  if p_submission_id is not null then
    insert into public.table_round_submissions(submission_id, table_session_id, order_id, total)
      values (p_submission_id, v_session_id, (v_result->>'orderId')::uuid, (v_result->>'total')::integer);
  end if;
  return v_result;
end;
$$;
revoke all on function public.place_table_round(text, uuid) from public;
grant execute on function public.place_table_round(text, uuid) to anon, authenticated;
-- Preserve the existing one-argument client contract for older deployed UI.
create or replace function public.place_table_round(p_qr_token text)
returns jsonb language sql security definer set search_path = public
as $$ select public.place_table_round(p_qr_token, null::uuid) $$;
revoke all on function public.place_table_round(text) from public;
grant execute on function public.place_table_round(text) to anon, authenticated;
