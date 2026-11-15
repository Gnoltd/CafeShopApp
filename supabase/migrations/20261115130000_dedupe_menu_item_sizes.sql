-- 20261115130000_dedupe_menu_item_sizes.sql
-- The 27-drinks seed (20261115120000) cross-joined ALL menu_items with M/L and
-- has no unique key, so every run (and every pre-existing S/M/L row) stacked
-- extra copies: 114 rows for 25 items, 59 of them exact duplicates (each item
-- showed M/L two or three times in the size picker).
-- Keep the first row per (menu_item_id, name), repoint anything that still
-- references a duplicate, delete the rest, then forbid it from recurring.

create temp table _size_dupes as
select id, keep_id
from (
  select id,
         first_value(id) over w as keep_id,
         row_number()    over w as rn
  from public.menu_item_sizes
  window w as (partition by menu_item_id, name order by sort_order, id)
) r
where rn > 1;

update public.order_items oi
   set size_id = d.keep_id
  from _size_dupes d
 where oi.size_id = d.id;

update public.table_cart_items ci
   set size_id = d.keep_id
  from _size_dupes d
 where ci.size_id = d.id;

delete from public.menu_item_sizes s
 using _size_dupes d
 where s.id = d.id;

drop table _size_dupes;

create unique index if not exists menu_item_sizes_item_name_key
  on public.menu_item_sizes (menu_item_id, name);
