-- 0063_restrict_menu_item_reviews_select.sql
-- Security hardening (2026-07-29 review, L-6): menu_item_reviews_select_all
-- (0027) used `using (true)`, so any visitor could query the table
-- directly and read raw customer_id UUIDs per review -- get_menu_item_reviews
-- deliberately returns only full_name, but the underlying table leaked the
-- UUID (enumerate which customer authored which review).
--
-- Public review browsing (guest-browsable /menu) still goes entirely
-- through get_menu_item_reviews, a security definer RPC that never reads
-- the table directly under the caller's own privileges -- it's
-- unaffected by this policy change. The only other real caller,
-- lib/supabase/reviews-data.ts's getMyReviewForItem, already filters
-- `.eq("customer_id", userId)` for the CALLER's own id, so scoping to
-- own-or-staff changes nothing for it.

drop policy "menu_item_reviews_select_all" on public.menu_item_reviews;

create policy "menu_item_reviews_select_own_or_staff" on public.menu_item_reviews
  for select using (
    customer_id = auth.uid()
    or current_user_role() in ('staff', 'manager', 'admin')
  );
