-- 0078_table_cart_items_fk_indexes.sql
-- get_advisors(type: "performance") flagged two unindexed foreign keys on
-- table_cart_items after the full RPC set landed (Task 1's own ledger note
-- anticipated this exact check). Matches this project's established
-- convention (migration 0037 did the same for menu tables).

create index table_cart_items_menu_item_id_idx on public.table_cart_items (menu_item_id);
create index table_cart_items_size_id_idx on public.table_cart_items (size_id);
