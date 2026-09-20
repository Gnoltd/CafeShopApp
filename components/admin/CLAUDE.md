# components/admin/CLAUDE.md

Admin-only UI, gated `manager|admin` by `middleware.ts`
(`/admin/staff`/`/admin/settings` further restricted to `admin` only).
As of the 2026-09-19 minimal ordering rebuild this directory covers
exactly three pages — menu management, staff accounts, and a trimmed
settings page — plus the shared admin shell. This file only covers what
actually survives here; check `find components/admin -type f` if it
ever looks stale rather than trusting this list from memory.

## What's here

- **`menu-management.tsx`** (`/admin/menu`) — item/category CRUD, real
  image upload (`menu-item-images` Storage bucket, unchanged by the
  rebuild). The old recipe/ingredient-linking UI tied to Inventory is
  gone (Inventory itself is deleted) — availability is now purely a
  manual toggle: `menu_items.is_available`, edited in
  `menu-item-form.tsx`, replacing what used to be inventory-driven.
  Review moderation (`menu-item-reviews-panel.tsx`, which was actually
  wired into `menu-item-form.tsx`, not this file) is deleted along with
  Reviews.
- **`menu-item-form.tsx`** — add/edit an item: name (vi/en),
  description, price, category assignment (via the
  `menu_item_categories` many-to-many join table, migration `0090`),
  image upload, the `is_available` toggle, and the admin-editable
  per-item Sizes editor (unchanged — kept per the design's Decision
  18). Modifier groups (`getModifierGroups`/`setItemModifierGroups` in
  `lib/supabase/menu-admin.ts`) are unchanged too.
- **`menu-categories-card.tsx`** — category create/rename/delete,
  shown alongside the item list.
- **`staff-accounts.tsx`** (`/admin/staff`) — list/create/enable/
  disable staff|manager|admin accounts. Creating one calls the
  `create-staff-account` Edge Function (the *only* Edge Function left
  in this whole project — see root `CLAUDE.md`'s Edge Functions
  section), which returns a one-time generated password for the admin
  to relay out of band. Disabling an account sets `is_active = false`
  (downgrades to `customer` everywhere per `current_user_role()` — see
  root `CLAUDE.md`'s Roles section — without touching their Auth
  login). Unchanged by the rebuild.
- **`staff-member-form.tsx`** — the add/edit dialog `staff-accounts.tsx`
  opens.
- **`settings-view.tsx`** (`/admin/settings`) — **trimmed to shop info
  only**: name, address, phone, opening hours. No tax-rate field (tax
  is deleted entirely — menu prices are already tax-inclusive,
  `shop_settings.tax_rate` is zeroed at the DB level, migration `0094`).
  No loyalty-settings section (Loyalty itself is deleted). No "Landing
  Hero" image card (`landing-hero-settings-card.tsx`, deleted — nothing
  customer-facing has consumed those images since the old marketing
  page was replaced, first by the 2026-09-06 Home merge and now by this
  rebuild's bare scan-QR page). `lib/supabase/settings-data.ts` was
  trimmed to match: `ShopSettings`/`ShopSettingsInput` no longer carry
  `taxRatePercent`, and every `LoyaltySettings*`/`LandingHeroSettings*`
  type/function in that file is deleted.
- **`admin-nav-items.ts`** — single source of truth for the sidebar/
  mobile-header nav: `ADMIN_NAV_ITEMS` is just `menu`/`staff`/`settings`
  now. A separate `ADMIN_EXTERNAL_NAV_ITEMS` list (rendered in its own
  bordered-off section — "leaving the admin shell," not one more admin
  page) links out to `/staff/orders` ("Vận hành"/Operations), since
  admin/manager still need a way to reach KDS+Tables even though those
  pages no longer live under `/admin/*`.
- **`admin-sidebar.tsx`**, **`admin-mobile-header.tsx`**,
  **`admin-layout-client.tsx`** — the shared admin shell. Its own doc
  comment (`admin-layout-client.tsx`) still mentions "Inventory/Shift/
  Tables data" providers mounted per-route — stale as of this rebuild
  (all three are deleted); harmless since it's just a comment, not
  fixed as part of this docs-only pass.

## What's deleted (do not re-introduce without re-reading the design doc)

- **Admin Dashboard** (`/admin/dashboard`, `dashboard-view.tsx`,
  `hooks/useDashboardStats.tsx`, `lib/supabase/dashboard-data.ts`,
  `lib/export-dashboard-excel.ts`) — no KPI page anymore.
- **Admin Inventory** (`/admin/inventory`, `inventory-management.tsx`,
  `ingredient-form.tsx`, `recipe-checklist.tsx`, `stock-adjust-form.tsx`,
  `hooks/useInventory.tsx`, `lib/supabase/inventory-data.ts`) —
  ingredient/stock tracking is gone; menu-item availability is a manual
  toggle now (see `menu-item-form.tsx` above).
- **Admin Tables** (`/admin/tables`, `tables-management.tsx`,
  `table-form.tsx` — the *admin* one; a same-named `table-form.tsx` was
  rebuilt fresh under `components/staff/`) — table CRUD moved to the
  new staff `/staff/tables` page (`components/staff/CLAUDE.md`), not
  kept as a separate admin route (Decision 13/17).
- **Shift Closing** (`/admin/shift`, `shift-closing.tsx`,
  `shift-report-detail.tsx`) — see root `CLAUDE.md`'s "Shift closing"
  entry; this wasn't just a UI deletion, the underlying shift-open
  ordering gate had to be removed too (migration `0094`).
- **Food Cost** (`/admin/food-cost`, `food-cost-calculator.tsx`) and
  **Promotions** (`/admin/promotions`, `promotions-management.tsx`,
  `lib/supabase/promotions-data.ts`) — both gone; Check Bill applies no
  promo code (Decision 14).
