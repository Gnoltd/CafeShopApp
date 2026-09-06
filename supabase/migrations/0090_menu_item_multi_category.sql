-- Menu items become many-to-many with categories. Was menu_items.category_id
-- (a single required FK); replaced by a join table so one item can carry
-- more than one category tag, matching the existing
-- menu_item_modifier_groups / menu_item_sizes join-table pattern. Every
-- existing item's current category_id is preserved as its one row here
-- before the old column is dropped.

create table public.menu_item_categories (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  primary key (menu_item_id, category_id)
);
alter table public.menu_item_categories enable row level security;

create index menu_item_categories_category_id_idx on public.menu_item_categories(category_id);

create policy "menu_item_categories_select_all" on public.menu_item_categories for select using (true);
create policy "menu_item_categories_admin_all" on public.menu_item_categories for all
  using (public.current_user_role() in ('manager', 'admin'))
  with check (public.current_user_role() in ('manager', 'admin'));

insert into public.menu_item_categories (menu_item_id, category_id)
select id, category_id from public.menu_items;

alter table public.menu_items drop constraint menu_items_category_id_fkey;
alter table public.menu_items drop column category_id;
