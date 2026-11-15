-- 20261115120000_seed_phadin_27_drinks_menu.sql
-- Replaces the 9-item mock seed (and any test row) with PhaDinCafe's real
-- 27-beverage menu across 5 drink categories (0 food items).
-- Reuses existing category & menu_item UUIDs via ON CONFLICT (id) DO UPDATE
-- so historical order_items / table_session_cart_items FK references remain intact.

insert into public.categories (id, name_vi, name_en, sort_order)
values
  ('0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40', 'Cà Phê', 'Coffee', 0),
  ('feca9822-7a29-4818-abda-87c6e21ed45e', 'Trà & Đồ Ấm', 'Tea & Warm Drinks', 1),
  ('6546be10-b8d2-4283-b7e7-af8a1000956a', 'Nước Ép', 'Fresh Juice', 2),
  ('1c4fc178-ef40-4b41-bee7-8acfa28b524b', 'Sinh Tố & Đá Xay', 'Smoothies & Frappe', 3),
  ('a590f8c1-4d2e-4b9a-8c11-7e3f9a2d5b05', 'Sữa Chua', 'Yogurt', 4)
on conflict (id) do update
set name_vi = excluded.name_vi,
    name_en = excluded.name_en,
    sort_order = excluded.sort_order;

insert into public.menu_items (
  id, name_vi, name_en, description_vi, description_en,
  base_price, icon, is_available, is_popular, image_url, has_size_options
)
values
  -- 1. Cà Phê (8 món)
  ('8ebf4865-fe08-4ce5-a04f-9f5804393a55', 'Cà Phê Đen Pha Đin', 'Black Coffee', 'Đen đá hoặc đen nóng rang xay nguyên chất hương vị Tây Bắc.', 'Traditional bold roasted black coffee, served hot or iced.', 25000, 'coffee', true, true, '/images/menu/ca-phe-den-pha-din.jpg', true),
  ('3929b81c-d4c9-42ef-9a76-b6e201712f23', 'Cà Phê Sữa', 'Milk Coffee', 'Cà phê phin truyền thống hòa quyện cùng sữa đặc béo ngậy.', 'Authentic phin drip coffee with rich condensed milk.', 29000, 'coffee', true, true, '/images/menu/ca-phe-sua.jpg', true),
  ('2125b8be-1b27-45dd-9c2f-55662195a1ea', 'Bạc Xỉu', 'White Coffee', 'Nhiều sữa tươi và sữa đặc, dịu nhẹ vị cà phê.', 'Sweet milk-forward coffee with a gentle espresso finish.', 32000, 'milk', true, true, '/images/menu/bac-xiu.jpg', true),
  ('145d4b16-2ab6-4d93-856e-3ffb3f268025', 'Cà Phê Muối', 'Salted Cream Coffee', 'Cà phê phin đậm đà phủ lớp kem muối mặn dịu béo thơm.', 'Rich phin coffee topped with silky salted cream foam.', 35000, 'coffee', true, true, '/images/menu/ca-phe-muoi.jpg', true),
  ('55e969aa-4fca-471d-9eec-ae9e4e511240', 'Cà Phê Cốt Dừa', 'Coconut Milk Coffee', 'Cốt dừa xay sánh mịn kết hợp cùng cà phê phin đậm vị.', 'Blended creamy coconut milk over bold phin coffee.', 39000, 'coffee', true, true, '/images/menu/ca-phe-cot-dua.jpg', true),
  ('b1000001-0000-4000-8000-000000000006', 'Americano', 'Iced / Hot Americano', 'Espresso pha loãng thanh nhẹ, phục vụ nóng hoặc đá.', 'Smooth espresso diluted with hot water or served over ice.', 32000, 'coffee', true, false, '/images/menu/americano.jpg', true),
  ('b1000001-0000-4000-8000-000000000007', 'Café Latte', 'Café Latte', 'Espresso hạt Arabica Tây Bắc hòa quyện cùng sữa tươi.', 'Northwest Arabica espresso with steamed or chilled fresh milk.', 39000, 'coffee', true, false, '/images/menu/cafe-latte.jpg', true),
  ('b1000001-0000-4000-8000-000000000008', 'Cappuccino', 'Cappuccino', 'Espresso kết hợp lớp bọt sữa đánh bông dày mịn.', 'Classic espresso topped with airy, velvety milk foam.', 39000, 'coffee', true, false, '/images/menu/cappuccino.jpg', true),

  -- 2. Trà & Đồ Ấm (6 món)
  ('765a8e06-8a02-4170-993c-65fbcbebf899', 'Trà Đào Cam Sả', 'Peach Orange Lemongrass Tea', 'Hồng trà ủ lạnh kết hợp đào miếng giòn, cam vàng và hương sả tươi.', 'Chilled black tea with crisp peach slices, orange, and lemongrass.', 35000, 'cup-soda', true, true, '/images/menu/tra-dao-cam-sa.jpg', true),
  ('0efa7eed-c1f3-408e-bd79-b415a3e81531', 'Matcha Latte', 'Matcha Latte', 'Bột trà xanh Nhật Bản khuấy mịn cùng sữa tươi nóng hoặc đá.', 'Japanese matcha whisked with fresh milk, served hot or iced.', 38000, 'milk', true, false, '/images/menu/matcha-latte.jpg', true),
  ('b1000001-0000-4000-8000-000000000011', 'Trà Gừng Mật Ong', 'Hot Ginger Honey Tea', 'Trà ấm pha gừng tươi giã thơm và mật ong rừng Tây Bắc.', 'Warming ginger infusion sweetened with wild Northwest honey.', 30000, 'coffee', true, false, '/images/menu/tra-gung-mat-ong.jpg', true),
  ('b1000001-0000-4000-8000-000000000012', 'Trà Lipton Chanh Mật Ong', 'Lipton Lemon Honey Tea', 'Trà Lipton truyền thống kết hợp chanh tươi và mật ong.', 'Classic Lipton black tea with fresh lime and honey.', 28000, 'cup-soda', true, false, '/images/menu/tra-lipton-chanh-mat-ong.jpg', true),
  ('b1000001-0000-4000-8000-000000000013', 'Trà Hoa Cúc Mật Ong', 'Chamomile Honey Tea', 'Trà hoa cúc thanh dịu pha mật ong ấm áp, thư giãn.', 'Soothing chamomile blossom tea sweetened with pure honey.', 32000, 'coffee', true, false, '/images/menu/tra-hoa-cuc-mat-ong.jpg', true),
  ('b1000001-0000-4000-8000-000000000014', 'Cacao Sữa Nóng / Đá', 'Hot / Iced Milk Cocoa', 'Cacao nguyên chất đậm vị pha cùng sữa đặc béo thơm.', 'Rich pure cocoa blended with creamy condensed milk.', 35000, 'milk', true, false, '/images/menu/cacao-sua.jpg', true),

  -- 3. Nước Ép (6 món)
  ('3e0d2857-ed99-4fab-8b57-047b2251c99b', 'Nước Ép Cam Dứa', 'Orange Pineapple Juice', 'Cam tươi ép nguyên chất kết hợp dứa chín thơm mát.', 'Freshly pressed orange and sweet pineapple juice.', 38000, 'cup-soda', true, true, '/images/menu/nuoc-ep-cam-dua.jpg', true),
  ('9d8131f4-065d-4355-9ee7-db9ac5a4c71e', 'Nước Ép Cam Cà Rốt', 'Orange Carrot Juice', 'Nước ép cam tươi và cà rốt nguyên chất giàu vitamin.', 'Vitamin-rich freshly pressed orange and carrot juice.', 35000, 'cup-soda', true, false, '/images/menu/nuoc-ep-cam-ca-rot.jpg', true),
  ('b1000001-0000-4000-8000-000000000017', 'Nước Ép Dưa Hấu', 'Fresh Watermelon Juice', 'Dưa hấu đỏ ép lạnh tự nhiên, thanh ngọt giải nhiệt.', 'Cold-pressed sweet red watermelon juice.', 32000, 'cup-soda', true, false, '/images/menu/nuoc-ep-dua-hau.jpg', true),
  ('b1000001-0000-4000-8000-000000000018', 'Nước Cam Tươi', 'Fresh Orange Juice', 'Cam tươi vắt nguyên chất 100% giàu vitamin C.', '100% freshly squeezed orange juice.', 35000, 'cup-soda', true, true, '/images/menu/nuoc-cam-tuoi.jpg', true),
  ('b1000001-0000-4000-8000-000000000019', 'Nước Ép Dứa', 'Fresh Pineapple Juice', 'Dứa chín ép tươi giữ trọn vị chua ngọt tự nhiên.', 'Freshly pressed ripe pineapple juice.', 32000, 'cup-soda', true, false, '/images/menu/nuoc-ep-dua.jpg', true),
  ('b1000001-0000-4000-8000-000000000020', 'Nước Chanh Leo / Chanh Tươi', 'Fresh Passion Fruit / Lime Juice', 'Chanh leo hoặc chanh tươi pha đá mát lạnh sảng khoái.', 'Refreshing iced passion fruit or fresh lime cooler.', 28000, 'cup-soda', true, false, '/images/menu/nuoc-chanh-leo-chanh-tuoi.jpg', true),

  -- 4. Sinh Tố & Đá Xay (4 món)
  ('b1000001-0000-4000-8000-000000000021', 'Sinh Tố Xoài', 'Fresh Mango Smoothie', 'Xoài chín xay sánh mịn cùng sữa đặc và đá tuyết.', 'Ripe mango blended smooth with condensed milk and ice.', 39000, 'cup-soda', true, false, '/images/menu/sinh-to-xoai.jpg', true),
  ('b1000001-0000-4000-8000-000000000022', 'Sinh Tố Bơ', 'Avocado Smoothie', 'Bơ sáp dẻo mịn xay cùng sữa tươi và sữa đặc.', 'Creamy ripe avocado blended with fresh and condensed milk.', 42000, 'cup-soda', true, false, '/images/menu/sinh-to-bo.jpg', true),
  ('b1000001-0000-4000-8000-000000000023', 'Cookie & Cream Đá Xay', 'Cookies & Cream Frappe', 'Bánh Oreo xay mịn cùng sữa tươi và kem vani.', 'Oreo cookies blended with ice, milk, and vanilla cream.', 42000, 'cup-soda', true, false, '/images/menu/cookie-cream-da-xay.jpg', true),
  ('6dd6dac7-49e1-48d0-b643-a4d68850b093', 'Sô-cô-la Đá Xay', 'Chocolate Ice Blended', 'Sô-cô-la đậm đặc xay đá mịn mát lạnh.', 'Rich dark chocolate ice-blended frappe.', 42000, 'cup-soda', true, false, '/images/menu/so-co-la-da-xay.jpg', true),

  -- 5. Sữa Chua (3 món)
  ('b1000001-0000-4000-8000-000000000025', 'Sữa Chua Đánh Đá Cà Phê', 'Coffee Crushed Ice Yogurt', 'Sữa chua đánh đá mịn rưới cốt cà phê phin đậm đà.', 'Tangy yogurt whipped with crushed ice and bold phin coffee.', 35000, 'milk', true, false, '/images/menu/sua-chua-danh-da-ca-phe.jpg', true),
  ('b1000001-0000-4000-8000-000000000026', 'Sữa Chua Đánh Đá Truyền Thống', 'Classic Crushed Ice Yogurt', 'Sữa chua đánh đá kèm sữa đặc và chút chanh tươi.', 'Classic Vietnamese yogurt whipped with condensed milk and crushed ice.', 28000, 'milk', true, false, '/images/menu/sua-chua-danh-da-truyen-thong.jpg', true),
  ('b1000001-0000-4000-8000-000000000027', 'Sữa Chua Hoa Quả / Việt Quất', 'Fruit / Blueberry Yogurt', 'Sữa chua dầm hoa quả tươi hoặc sốt việt quất chua ngọt.', 'Chilled yogurt topped with fresh seasonal fruit and blueberry compote.', 35000, 'milk', true, false, '/images/menu/sua-chua-hoa-qua-viet-quat.jpg', true)
on conflict (id) do update
set name_vi = excluded.name_vi,
    name_en = excluded.name_en,
    description_vi = excluded.description_vi,
    description_en = excluded.description_en,
    base_price = excluded.base_price,
    icon = excluded.icon,
    is_available = excluded.is_available,
    is_popular = excluded.is_popular,
    image_url = excluded.image_url,
    has_size_options = excluded.has_size_options;

delete from public.menu_item_categories
where menu_item_id in (
  '8ebf4865-fe08-4ce5-a04f-9f5804393a55',
  '3929b81c-d4c9-42ef-9a76-b6e201712f23',
  '2125b8be-1b27-45dd-9c2f-55662195a1ea',
  '145d4b16-2ab6-4d93-856e-3ffb3f268025',
  '55e969aa-4fca-471d-9eec-ae9e4e511240',
  'b1000001-0000-4000-8000-000000000006',
  'b1000001-0000-4000-8000-000000000007',
  'b1000001-0000-4000-8000-000000000008',
  '765a8e06-8a02-4170-993c-65fbcbebf899',
  '0efa7eed-c1f3-408e-bd79-b415a3e81531',
  'b1000001-0000-4000-8000-000000000011',
  'b1000001-0000-4000-8000-000000000012',
  'b1000001-0000-4000-8000-000000000013',
  'b1000001-0000-4000-8000-000000000014',
  '3e0d2857-ed99-4fab-8b57-047b2251c99b',
  '9d8131f4-065d-4355-9ee7-db9ac5a4c71e',
  'b1000001-0000-4000-8000-000000000017',
  'b1000001-0000-4000-8000-000000000018',
  'b1000001-0000-4000-8000-000000000019',
  'b1000001-0000-4000-8000-000000000020',
  'b1000001-0000-4000-8000-000000000021',
  'b1000001-0000-4000-8000-000000000022',
  'b1000001-0000-4000-8000-000000000023',
  '6dd6dac7-49e1-48d0-b643-a4d68850b093',
  'b1000001-0000-4000-8000-000000000025',
  'b1000001-0000-4000-8000-000000000026',
  'b1000001-0000-4000-8000-000000000027'
);

insert into public.menu_item_categories (menu_item_id, category_id)
values
  -- 1. Cà Phê
  ('8ebf4865-fe08-4ce5-a04f-9f5804393a55', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('3929b81c-d4c9-42ef-9a76-b6e201712f23', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('2125b8be-1b27-45dd-9c2f-55662195a1ea', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('145d4b16-2ab6-4d93-856e-3ffb3f268025', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('55e969aa-4fca-471d-9eec-ae9e4e511240', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('b1000001-0000-4000-8000-000000000006', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('b1000001-0000-4000-8000-000000000007', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  ('b1000001-0000-4000-8000-000000000008', '0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40'),
  -- 2. Trà & Đồ Ấm
  ('765a8e06-8a02-4170-993c-65fbcbebf899', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  ('0efa7eed-c1f3-408e-bd79-b415a3e81531', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  ('b1000001-0000-4000-8000-000000000011', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  ('b1000001-0000-4000-8000-000000000012', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  ('b1000001-0000-4000-8000-000000000013', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  ('b1000001-0000-4000-8000-000000000014', 'feca9822-7a29-4818-abda-87c6e21ed45e'),
  -- 3. Nước Ép
  ('3e0d2857-ed99-4fab-8b57-047b2251c99b', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  ('9d8131f4-065d-4355-9ee7-db9ac5a4c71e', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  ('b1000001-0000-4000-8000-000000000017', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  ('b1000001-0000-4000-8000-000000000018', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  ('b1000001-0000-4000-8000-000000000019', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  ('b1000001-0000-4000-8000-000000000020', '6546be10-b8d2-4283-b7e7-af8a1000956a'),
  -- 4. Sinh Tố & Đá Xay
  ('b1000001-0000-4000-8000-000000000021', '1c4fc178-ef40-4b41-bee7-8acfa28b524b'),
  ('b1000001-0000-4000-8000-000000000022', '1c4fc178-ef40-4b41-bee7-8acfa28b524b'),
  ('b1000001-0000-4000-8000-000000000023', '1c4fc178-ef40-4b41-bee7-8acfa28b524b'),
  ('6dd6dac7-49e1-48d0-b643-a4d68850b093', '1c4fc178-ef40-4b41-bee7-8acfa28b524b'),
  -- 5. Sữa Chua
  ('b1000001-0000-4000-8000-000000000025', 'a590f8c1-4d2e-4b9a-8c11-7e3f9a2d5b05'),
  ('b1000001-0000-4000-8000-000000000026', 'a590f8c1-4d2e-4b9a-8c11-7e3f9a2d5b05'),
  ('b1000001-0000-4000-8000-000000000027', 'a590f8c1-4d2e-4b9a-8c11-7e3f9a2d5b05')
on conflict do nothing;

delete from public.menu_item_sizes
where menu_item_id in (
  '8ebf4865-fe08-4ce5-a04f-9f5804393a55',
  '3929b81c-d4c9-42ef-9a76-b6e201712f23',
  '2125b8be-1b27-45dd-9c2f-55662195a1ea',
  '145d4b16-2ab6-4d93-856e-3ffb3f268025',
  '55e969aa-4fca-471d-9eec-ae9e4e511240',
  'b1000001-0000-4000-8000-000000000006',
  'b1000001-0000-4000-8000-000000000007',
  'b1000001-0000-4000-8000-000000000008',
  '765a8e06-8a02-4170-993c-65fbcbebf899',
  '0efa7eed-c1f3-408e-bd79-b415a3e81531',
  'b1000001-0000-4000-8000-000000000011',
  'b1000001-0000-4000-8000-000000000012',
  'b1000001-0000-4000-8000-000000000013',
  'b1000001-0000-4000-8000-000000000014',
  '3e0d2857-ed99-4fab-8b57-047b2251c99b',
  '9d8131f4-065d-4355-9ee7-db9ac5a4c71e',
  'b1000001-0000-4000-8000-000000000017',
  'b1000001-0000-4000-8000-000000000018',
  'b1000001-0000-4000-8000-000000000019',
  'b1000001-0000-4000-8000-000000000020',
  'b1000001-0000-4000-8000-000000000021',
  'b1000001-0000-4000-8000-000000000022',
  'b1000001-0000-4000-8000-000000000023',
  '6dd6dac7-49e1-48d0-b643-a4d68850b093',
  'b1000001-0000-4000-8000-000000000025',
  'b1000001-0000-4000-8000-000000000026',
  'b1000001-0000-4000-8000-000000000027'
);

insert into public.menu_item_sizes (menu_item_id, name, price_delta, sort_order)
select mi.id, s.name, s.price_delta, s.sort_order
from public.menu_items mi
cross join (
  values
    ('M', 0, 0),
    ('L', 8000, 1)
) as s(name, price_delta, sort_order);
