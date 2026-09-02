-- Re-open dine-in from the regular checkout without bypassing the shared
-- table-session model. One RPC imports the whole local cart transactionally;
-- a transfer id makes retries safe if the client loses the first response.

create table public.table_cart_imports (
  id uuid primary key,
  table_id uuid not null references public.tables(id) on delete cascade,
  item_count integer not null check (item_count > 0),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.table_cart_imports enable row level security;
revoke all on table public.table_cart_imports from anon, authenticated;
create index table_cart_imports_table_id_idx on public.table_cart_imports (table_id);
create index table_cart_imports_created_at_idx on public.table_cart_imports (created_at);

-- Serialize every add for one table, including imports and adds from other
-- phones, so two devices cannot create duplicate lines after both observe
-- that the line does not exist. Keep the previous implementation private and
-- put the lock plus stricter configuration validation in a narrow wrapper.
alter function public.add_cart_item(text, uuid, uuid, uuid[], text, integer)
  rename to add_cart_item_unlocked;
alter function public.add_cart_item_unlocked(text, uuid, uuid, uuid[], text, integer)
  set search_path = '';
revoke all on function public.add_cart_item_unlocked(text, uuid, uuid, uuid[], text, integer)
  from public, anon, authenticated;

create function public.add_cart_item(
  p_qr_token text,
  p_menu_item_id uuid,
  p_size_id uuid,
  p_modifier_ids uuid[],
  p_note text,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
  v_modifier_ids uuid[];
  v_valid_modifier_count integer;
begin
  select id into v_table_id
    from public.tables
    where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_table_id::text, 1));

  -- place_table_round already locks this same row FOR UPDATE. Holding it
  -- here prevents that RPC from reading/deleting the shared draft between
  -- this add's merge and commit.
  perform 1
    from public.table_sessions
    where table_id = v_table_id and status = 'active'
    for update;

  if p_size_id is not null and not exists (
    select 1
    from public.menu_item_sizes
    where id = p_size_id and menu_item_id = p_menu_item_id
  ) then
    raise exception 'invalid_size_for_menu_item';
  end if;

  select coalesce(array_agg(modifier_id order by modifier_id), array[]::uuid[])
    into v_modifier_ids
    from unnest(coalesce(p_modifier_ids, array[]::uuid[])) as selected_modifiers(modifier_id);

  if cardinality(v_modifier_ids) <> (
    select count(distinct modifier_id)
    from unnest(v_modifier_ids) as selected_modifiers(modifier_id)
  ) then
    raise exception 'duplicate_modifier';
  end if;

  if cardinality(v_modifier_ids) > 0 then
    select count(*) into v_valid_modifier_count
      from public.modifiers m
      join public.menu_item_modifier_groups mig
        on mig.modifier_group_id = m.modifier_group_id
       and mig.menu_item_id = p_menu_item_id
      where m.id = any(v_modifier_ids);

    if v_valid_modifier_count <> cardinality(v_modifier_ids) then
      raise exception 'invalid_modifier_for_menu_item';
    end if;

    if exists (
      select 1
      from public.modifiers m
      join public.modifier_groups mg on mg.id = m.modifier_group_id
      where m.id = any(v_modifier_ids)
      group by mg.id, mg.max_selections
      having count(*) > mg.max_selections
    ) then
      raise exception 'too_many_modifiers_for_group';
    end if;
  end if;

  return public.add_cart_item_unlocked(
    p_qr_token,
    p_menu_item_id,
    p_size_id,
    v_modifier_ids,
    p_note,
    p_quantity
  );
end;
$$;

revoke all on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer)
  from public, anon, authenticated;
grant execute on function public.add_cart_item(text, uuid, uuid, uuid[], text, integer)
  to anon, authenticated;

create or replace function public.import_table_cart(
  p_qr_token text,
  p_transfer_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
  v_existing public.table_cart_imports%rowtype;
  v_item jsonb;
  v_count integer;
begin
  if p_transfer_id is null then
    raise exception 'transfer_id_required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items_must_be_an_array';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 or v_count > 100 then
    raise exception 'cart_item_count_out_of_range';
  end if;

  select id into v_table_id
    from public.tables
    where qr_code_token = p_qr_token;
  if v_table_id is null then
    raise exception 'table_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_transfer_id::text, 0));
  select * into v_existing
    from public.table_cart_imports
    where id = p_transfer_id;
  if v_existing.id is not null then
    if v_existing.table_id <> v_table_id then
      raise exception 'transfer_id_already_used';
    end if;
    if v_existing.payload <> p_items then
      raise exception 'transfer_payload_mismatch';
    end if;
    return v_existing.item_count;
  end if;

  delete from public.table_cart_imports
    where created_at < now() - interval '7 days';

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform public.add_cart_item(
      p_qr_token,
      (v_item ->> 'menuItemId')::uuid,
      case
        when jsonb_typeof(v_item -> 'sizeId') = 'string'
          then (v_item ->> 'sizeId')::uuid
        else null
      end,
      array(
        select modifier_id::uuid
        from jsonb_array_elements_text(coalesce(v_item -> 'modifierIds', '[]'::jsonb))
          as selected_modifiers(modifier_id)
        order by modifier_id
      ),
      case
        when jsonb_typeof(v_item -> 'note') = 'string'
          then v_item ->> 'note'
        else null
      end,
      coalesce((v_item ->> 'quantity')::integer, 1)
    );
  end loop;

  insert into public.table_cart_imports (id, table_id, item_count, payload)
  values (p_transfer_id, v_table_id, v_count, p_items);

  return v_count;
end;
$$;

revoke all on function public.import_table_cart(text, uuid, jsonb) from public;
grant execute on function public.import_table_cart(text, uuid, jsonb) to anon, authenticated;
