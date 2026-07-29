# CLAUDE.md

Structural map of PhaDinCoffee. Full rationale/history lives in
`docs/superpowers/specs/` and `docs/superpowers/plans/` — one dated
design+plan pair per feature (e.g. `2026-07-07-vnpay-payment-integration-{design,}.md`).
This file is the current-state summary; check the dated docs for "why" a
decision was made or the full bug-hunt narrative behind a fix.

## Status

Everything shipped so far is real end-to-end. Next.js app (bilingual,
role-gated), full customer/staff/admin UI, live Supabase DB (43
migrations) with RLS, live Realtime sync across Inventory/Tables/Orders/
Staff accounts, 3-state table occupancy/cleaning, deferred (Pay
Now/Pay Later) payment with method-chosen-at-serving-time (including
a served-but-unpaid order's method being changeable/undoable), all
three payment methods (Cash/Stripe/VNPay), real customer reviews, real
admin menu-image upload, real Profile persistence, real Admin
Dashboard KPIs, shift closing (cash reconciliation) with real Shift
History, real Google sign-in, real Profile Settings (password change +
Google account linking), an admin-editable per-item Sizes editor, a
real forgot-password/reset-via-email flow, real Loyalty tier progress,
a real Rewards catalog/redemption (with a staff-facing redemption
lookup to close the loop), a real customer Address Book, a real POS
size/extras picker, and real Admin Settings (shop info, tax rate, and
loyalty enable/rates — genuinely persisted and driving POS/checkout,
not `useState` mock) all work end-to-end. Deployed at
**https://phadincoffee.vercel.app**, auto-deploys on push to `main`. See
`daily.md` for what's currently open — it's kept short and recap-free by
design, so check it before this file for "what's left."

## Stack

Next.js (App Router) + Tailwind v4 + shadcn/ui + next-intl, talking
directly to Supabase (Postgres + Auth + Realtime) via its SDK. No custom
backend server — RLS is the access-control boundary; Edge Functions
handle logic needing secrets/atomicity (payments, order placement, staff
account creation).

## Roles

`profiles.role`: `customer | staff | manager | admin`. Staff =
POS+Kitchen Display. Manager = Staff + menu/inventory/tables/reports.
Admin = Manager + staff accounts/roles + shop/loyalty settings.
`profiles.is_active = false` downgrades a disabled staff/manager/admin
to `customer` everywhere (`current_user_role()` + RLS) without touching
their Auth login — a disabled employee can still walk in and order as a
customer, no separate ban/logout step. Role is never cached client-side,
always re-resolved server-side per request.

## Bilingual (i18n)

- next-intl, locale-prefixed routing (`/vi/...`, `/en/...`), `vi` default.
- Config: `i18n/routing.ts`, `i18n/navigation.ts` (locale-aware
  `Link`/`useRouter`), `i18n/request.ts`.
- `messages/vi.json`/`messages/en.json`, namespaced per section. Add new
  keys to **both**. `Brand.name` ("PhaDinCoffee") and third-party names
  like "VNPay" are identical in both files — proper nouns, not translated.
- Server components: `getTranslations()`. Client: `useTranslations()`.
- **`middleware.ts` is required for locale resolution, not just auth** —
  disabling it for any reason (even to bypass auth locally) silently
  breaks translations app-wide. Never bypass auth by hardcoding a role
  or removing middleware; seed real Supabase test data/sessions instead.
- `export const dynamic = "force-dynamic"` on the root layout is
  required (Next's route cache otherwise serves the wrong locale).
- `lib/format.ts`: `formatVND`, `formatNumber`, `formatDateVN`, `formatPhoneVN`.

## Theme (`app/globals.css`)

Tailwind v4 `@theme`/`:root` (no `tailwind.config.ts`). Brand: `--primary`
`#b3341f` (brick red), `--secondary` `#6f4e37` (coffee brown), `--accent`
`#c9a66b` (caramel), `--background` `#fff8f2`, `--foreground` `#3a2e22`.
`--destructive` `#c1440e` is a deliberately different hue from
`--primary`. `--radius: 0.75rem`. Font: Be Vietnam Pro (not Geist). Use
semantic Tailwind classes (`bg-primary` etc.), never hardcode hex.
Original mockup source: `design/stitch-exports/`.

## Route map

Relative to the locale prefix, under `app/[locale]/`:
- `(marketing)` — `/`
- `(auth)` — `/login`, `/signup`, `/callback` (Google OAuth), `/reset-password`
  (route group, contributes no URL segment — bare paths)
- `(customer)` — `/menu`, `/menu/[itemId]`, `/cart`, `/checkout`,
  `/orders`, `/orders/[orderId]`, `/table/[qrToken]`, `/profile`,
  `/profile/settings`, `/profile/addresses`, `/loyalty`,
  `/loyalty/redemptions`
- `staff` — `/staff/pos`, `/staff/orders`, `/staff/orders/history`,
  `/staff/orders/history/[orderId]`, `/staff/rewards` (real URL
  segments, not route groups — a route group would collide with
  `(customer)`'s bare paths)
- `admin` — `/admin/dashboard`, `/menu`, `/inventory`, `/tables`,
  `/food-cost`, `/shift`, `/staff` (admin-only), `/settings` (admin-only)

`middleware.ts` (+ `lib/middleware-rules.ts` for the pure/testable
routing logic, extracted so it doesn't pull in `next-intl/middleware`
under Vitest) gates `/staff/*` (staff|manager|admin) and `/admin/*`
(manager|admin), plus exact-path gating on `/profile`/`/orders`/`/loyalty`
for logged-out guests (not `/orders/[id]`, reachable by guest checkout).
Fails open to anonymous on Supabase errors rather than crashing.

## Cross-cutting conventions & gotchas

Reusable facts that apply anywhere in the codebase, not tied to one feature.

- **Base UI, not Radix**: shadcn's `Button` wraps `@base-ui/react/button`
  — no `asChild`. For polymorphic rendering use `render`:
  `<Button render={<Link href="/x" />} nativeButton={false}>`.
- **Toggle switches need an explicit `left` position** on the thumb
  (`absolute left-0.5 top-0.5`, `translate-x-0`/`translate-x-5`) —
  omitting it makes the browser's static-position fallback push the
  "on" thumb outside the track.
- **The fixed `LanguageSwitcher`** (`app/[locale]/layout.tsx`,
  `fixed top-2 right-2 z-50`) can overlap admin header action buttons —
  admin layout uses `pt-16` to keep content clear of it.
- **Supabase Edge Function secrets (`Deno.env`) are a separate store
  from Vercel's env vars.** Syncing a var to Vercel does *not* make it
  available inside an Edge Function — it must also be set via the
  Supabase Dashboard (Edge Functions → Secrets) or `supabase secrets
  set`. Has bitten this project repeatedly (`STRIPE_SECRET_KEY`,
  `SITE_URL`, `STRIPE_WEBHOOK_SECRET`, `VNPAY_TMN_CODE`,
  `VNPAY_HASH_SECRET` all needed this separately). No MCP tool manages
  these secrets — it's a manual step every time.
- **Guest-safe RPC pattern**: any operation a logged-out guest needs
  (order tracking, order self-cancel, table QR scan count) is a narrow
  `security definer` function taking the row's id as a required
  parameter — never a broad RLS policy keyed on `customer_id is null`,
  which would let one guest bulk-read/affect every other guest's rows.
- **`handle_order_paid` trigger** (migration `0007`) only fires on an
  `UPDATE` transitioning `payment_status` to `'paid'`, never on
  `INSERT` — every order-creation path inserts at `pending` then does a
  real second `UPDATE` to flip it.
- **Postgres RPC parameter defaults don't apply when PostgREST sends
  explicit JSON `null`** (only when the arg is omitted) —
  `coalesce()` inside the function body if a default matters.
- **`order_type` enum is `pickup | dine_in`** (underscore) — client
  state uses hyphenated `"dine-in"` and must translate before any RPC
  call. Was a real bug (every dine-in order silently failed) until
  fixed 2026-07-07.
- **Order-status lifecycle logic intentionally lives in two separate
  places**, not one: `hooks/useKitchenOrders.tsx`'s `NEXT_STATUS` map
  (staff-driven kitchen progression, paid→preparing→ready→served) and
  `supabase/functions/_shared/order-status.ts`'s `buildPaidUpdate`
  (the served-or-not branch a payment webhook applies when money
  clears). Considered unifying these during an architecture review
  (2026-07-12) and rejected it — they're triggered by different events
  (a staff tap vs. a gateway callback), live in different runtimes
  (Next.js client bundle vs. Deno edge function) with no shared-code
  bridge between them (`tsconfig.json` excludes `supabase/functions`
  entirely), and don't call each other. Unifying would mean inventing
  new cross-runtime tooling to remove one repeated `"served"` string
  comparison — not worth it. Don't re-propose merging them without a
  third concern showing up that actually needs the same table.
- **Any code reading `profiles.role` directly** (not via
  `current_user_role()` or a function built on it) risks ignoring
  `is_active` — three call sites needed fixing for exactly this once;
  grep for a raw `.select("role")` on `profiles` before adding a new one.
- **VND handling differs by payment gateway**: Stripe treats VND as
  zero-decimal (send the integer total as-is); VNPay always wants
  `total × 100` regardless of currency. Don't copy one convention into
  the other.
- **VNPay signs with PHP `urlencode()` convention** (`+` for space, not
  `%20`) — plain `encodeURIComponent` produces a wrong hash for any
  value containing a space (e.g. `vnp_OrderInfo`). Was a real bug until
  caught via live sandbox testing 2026-07-07; fixed with a shared
  `vnpayEncode()` helper used consistently everywhere VNPay data is
  signed or verified.
- **`supabase.functions.invoke()` always attaches an `Authorization`
  header, even for a guest** — for a guest it's the client's own
  publishable key, not a JWT. Forwarding it blindly breaks
  `auth.uid()` resolution; only forward when the token is actually
  JWT-shaped (3 dot-separated segments).
- **Query layers are DI'd**: every `lib/supabase/*.ts` module takes a
  `SupabaseClient` as its first argument (not importing a singleton),
  so it's testable with a mocked client. Follow this pattern for new
  query modules.
- **"disabled + tooltip" convention**: any UI action with no real
  backing table/RPC yet is rendered `disabled` with an explanatory
  `title`, never silently non-functional.
- **Realtime**: subscribe unfiltered to `postgres_changes` and refetch,
  rather than using a column `filter` — a filter doesn't reliably
  combine with RLS-gated Realtime (confirmed directly, more than once).
- **A Postgres `AFTER UPDATE OF column_name` trigger only fires when
  the client's own UPDATE statement names that column** — not when
  another `BEFORE` trigger changes it as a side effect. Was a real bug:
  `sync_table_occupancy` (scoped to `OF status`) never fired when a
  deferred-payment order completed via a `payment_status`-only update
  (the `complete_order_when_served_and_paid` trigger flipped `status`
  internally, invisibly to the column scope) — a table could finish an
  order and never get freed. Fixed (migration `0024`) by dropping the
  column scope; the function's own body already gates its logic
  correctly, matching the unscoped pattern `handle_order_paid` and
  `complete_order_when_served_and_paid` already used.
- **Every RLS policy needs checking against all roles that can reach
  the UI surface calling it**, not just the role that happens to be
  logged in during a given test pass. `tables_admin_all` only granted
  `manager`/`admin` — but KDS (staff-reachable) exposes a table-status
  action too. A plain `staff` account got silently rejected until
  `tables_update_staff` (migration `0025`) was added. Pair this with
  always attaching `.catch()` to a Supabase write in the UI — an
  RLS denial with no error handling looks identical to "button does
  nothing," which is far harder to diagnose than a shown error message.
- **Verify against the deployed Vercel URL**
  (`https://phadincoffee.vercel.app`), not `npm run dev` — this
  project's explicit convention. Local `build`/`tsc`/`test` are fine for
  fast feedback but not the source of truth for "does it actually work."
- **Public, non-personalized data fetches can (and, for anything on a
  hot path, should) be cached** despite the root layout's
  `force-dynamic` — that flag disables Next's page-level caching for
  locale correctness, but doesn't prevent caching an individual data
  fetch. `lib/supabase/menu-data-cached.ts`'s `getPublicMenuData()`
  wraps `getCategories`/`getMenuItems` in `unstable_cache` (20s TTL,
  its own unauthenticated client since the content is RLS-`true`/public
  either way) — measured fix for `/menu` and `/` running the full
  nested-join query from scratch on every single request (~600-800ms
  of the ~1.1-1.3s TTFB). This is a deliberate exception to the DI'd
  query-layer convention (no `SupabaseClient` param) — only justified
  because the data is identical for every visitor; don't reach for this
  pattern for anything user-specific.
- **`get_advisors(type: "performance")` is worth running after adding
  any new table**, not just after something feels slow — it caught 4
  unindexed foreign keys on exactly the tables `getMenuItems`' nested
  select joins (migration `0037`) and flagged duplicate permissive RLS
  SELECT policies on the same tables (a `_admin_all FOR ALL` policy
  redundantly re-evaluated on every SELECT already covered by a
  separate `_select_all: true`/`_select_staff` policy) — the latter
  wasn't fixed (Postgres can't scope a single `FOR ALL` policy to
  exclude SELECT; fixing it cleanly needs splitting into 3 separate
  INSERT/UPDATE/DELETE policies, lower value than the index fix, noted
  here rather than done).

## Feature areas

Each real feature has its own design spec + implementation plan under
`docs/superpowers/specs/`/`docs/superpowers/plans/`. Below is only what
you need to find your way around; check the dated docs for full detail.

### Customer ordering flow (`/menu`, `/cart`, `/checkout`, `/orders/[orderId]`, `/menu/[itemId]`)
- `hooks/useCart.tsx` — cart Context + localStorage, per-item notes, one
  hardcoded promo code (`WELCOME10`, 10% off).
- `lib/supabase/menu-data.ts` — menu query layer. Items, sizes,
  modifier groups/extras are real and admin-configurable
  (`components/admin/menu-item-form.tsx`'s "Extras"/"Recipe" sections).
- `hooks/useOrders.tsx` — Checkout/Tracking/History share one Context;
  wraps `get_order_for_tracking`/`getMyOrders` (real RPC/query, see
  "Orders + Realtime" below).
- Product Detail Page has its own sticky Add-to-Cart bar; reviews are
  real (see "Reviews" below), shown here with the real aggregate rating.
- Menu's "+" quick-add always adds directly to cart when an item needs
  neither a size decision nor extras; otherwise tapping "+" opens
  `components/customer/quick-add-popup.tsx` (`QuickAddPopup` — handles
  both size selection and extras, not extras-only despite the older
  `quick-add-extras-popup.tsx` name still floating around in commit
  history) instead of the full Product Detail page — tapping the item
  itself still opens the full page.
- `menu_items.has_size_options` (migration `0020`) lets admin hide the
  size picker for a single-size item regardless of how many
  `menu_item_sizes` rows exist — an explicit toggle in
  `menu-item-form.tsx`, not automatic based on row count.
- Single-option modifier groups (extra shot, extra milk, etc.) render as
  one grouped list with prices shown inline, not one grid-column per
  extra — `product-detail.tsx`/`quick-add-popup.tsx` split
  `modifierGroups` into `extraGroups` (`options.length === 1`) vs
  `otherGroups` (`options.length > 1`, unchanged grid layout with prices
  added).
- `lib/supabase/loyalty-data.ts` — real `getLoyaltyBalance`/
  `getLoyaltyTransactions`, backing the Loyalty page's balance and
  transaction history (was a hardcoded mock until 2026-07-08). Tier
  progress is real too (2026-07-10): `loyalty_tiers` table (migration
  `0034`, Bronze/Silver/Gold/Diamond by lifetime points earned,
  bilingual `name_vi`/`name_en`) + `get_my_loyalty_tier_progress()` RPC
  (no args, resolves `auth.uid()` internally, returns current/next tier
  name + points-to-next + progress percent), surfaced via
  `getLoyaltyTierProgress` and the Loyalty page's tier card (localized
  tier name, real `ProgressRing`, and a max-tier "reached the top"
  message when there's no next tier).
- Landing's "Scan QR at Table" is real camera scanning
  (`components/customer/qr-scanner-overlay.tsx`, `jsQR`, no other new
  dependency) — decodes a table's printed QR code and routes into the
  existing `/table/[qrToken]` flow untouched. Validates the decoded
  string against the table-URL *pathname* shape only (ignores hostname,
  so it also works against preview-deployment URLs) before navigating —
  see `lib/qr-table-token.ts`'s `extractTableToken`.
- **Known gap**: `checkout-view.tsx`'s initial `orderType` reads
  `activeTable` only once at first render, so it can default to
  "pickup" if `activeTable` populates moments later (right after a
  reload, before `TablesProvider`'s localStorage hydration effect runs).

### Landing / Auth / Profile / Loyalty / Order History
- Login/Signup use real Supabase Auth; redirect to `ROLE_HOME[role]`
  (`lib/roles.ts`, shared with `middleware.ts`). Google OAuth sign-in
  is real (both buttons call `signInWithOAuth`; a callback page at
  `app/[locale]/(auth)/callback/page.tsx` — note this resolves to the
  bare URL `/<locale>/callback`, since `(auth)` is a route group and
  contributes no URL segment, same as `login`/`signup` — resolves role
  via `getCurrentRole` and redirects to `ROLE_HOME[role]`). Signup email
  confirmation frequently fails — this hosted project's shared email
  sender has a very low rate limit; no MCP tool can configure SMTP.
- Login's "Forgot password?" is real: a 3-view swap inside
  `login-form.tsx` (`"login" | "requestReset" | "resetSent"`) calls
  `supabase.auth.resetPasswordForEmail`, always landing on a
  Signup-style "check your email" screen regardless of whether the
  address is registered (Supabase's anti-enumeration behavior — never
  reveal account existence). The emailed link lands on
  `/reset-password` (`app/[locale]/(auth)/reset-password/page.tsx` +
  `components/auth/reset-password-view.tsx`) — same bare-URL route-group
  lesson as `/callback`. That page waits on `onAuthStateChange` for the
  session the recovery link establishes (same pattern as the OAuth
  callback), then reuses Settings' change-password form pattern
  (`updateUser({ password })`) before redirecting via
  `getCurrentRole`/`ROLE_HOME`. Shares the same shared-email-sender
  rate-limit risk as signup confirmation — shipped anyway per explicit
  decision; the real-emailed-link round trip is unconfirmed, see
  `daily.md`.
- `lib/get-current-role.ts` (`getCurrentRole(supabase)`) resolves role
  server-side for the "Go to [X]" shortcut shown to logged-in
  staff/admin browsing the customer side.
- Loyalty page's "Double Points Wednesday" banner is real (migration
  `0043`, 2026-07-11) — `handle_order_paid` doubles earned points when
  an order is marked paid on a Wednesday, evaluated in
  `Asia/Ho_Chi_Minh` (not the database's UTC, which would put the
  boundary at the wrong local hour). Was previously static marketing
  copy with zero day-of-week logic anywhere — a false claim made every
  day of the week, including Wednesdays.
- Loyalty rates are real (`loyalty_settings`: 10,000 VND = 1 point, 100
  pts = 10,000 VND off). Rewards catalog/redemption is real (migration
  `0035`): `rewards` table (4 seeded rewards, bilingual `name_*`/
  `description_*`, `points_cost`, `active`, `sort_order`) +
  `reward_redemptions` table + `redeem_reward(p_reward_id)` RPC
  (`security definer`, resolves `auth.uid()`, checks active + sufficient
  balance, then atomically inserts a `reward_redemptions` row + a
  `redeem` `loyalty_transactions` row + decrements the balance; raises
  machine-readable `not_authenticated`/`reward_not_found`/
  `reward_inactive`/`insufficient_points` on failure). Query layer:
  `lib/supabase/rewards-data.ts` (`getRewardsCatalog`/`redeemReward`);
  the Loyalty page's "Redeem Rewards" card opens
  `components/customer/rewards-catalog-modal.tsx` (a `BottomSheet`),
  which re-fetches balance + transactions on a successful redemption
  and shows the customer a real redemption code (`redeem_reward`'s
  returned id, `formatOrderId`-truncated) — usable two ways: applied
  self-service at checkout (primary path, see below) or shown to staff
  at `/staff/rewards` as a backup.
  **Redemption is actually spendable** (migration `0040`, added
  2026-07-11): every reward carries a flat `discount_value_vnd` (not
  tied to a specific menu item — "Free Black Coffee" and "20,000₫ Off"
  both apply the exact same way, no per-item cart-matching needed;
  seeded from real menu prices at the time). Checkout
  (`checkout-view.tsx`) fetches the customer's unused/unexpired
  redemptions via `getMyRedemptions`, shows them as a toggleable "My
  Rewards" list (**multiple per order allowed**, unlike the single-code
  `promoCode`/`WELCOME10` mechanic), and sends the selected
  `redemptionIds` to `place_order`, which validates each one
  server-side (ownership, not already used, not expired — raises
  `invalid_redemption_code`/`redemption_already_used`/
  `redemption_expired`) before summing their discount into the order
  total and stamping `applied_order_id` on success — same
  never-trust-the-client posture as every other discount `place_order`
  computes. A customer's full status list — Available/Used/Expired,
  redeemed date, expiry date, tap-to-copy code — lives at
  `/loyalty/redemptions` (`components/customer/my-redemptions-view.tsx`,
  linked from the Loyalty page).
  **Expiry is dynamic, not stored**: `get_redemption_expiry()` computes
  `redeemed_at + 1 year`, extended to `now() + 1 year` on every call
  where the customer's total paid spend since redeeming exceeds
  1,000,000 VND — recomputed fresh each time (checkout, the status
  list, `place_order`'s validation), not a cron-updated column, since
  "still active" can flip at any moment as new orders complete.
  `find_redemption_by_code()`/`fulfill_redemption()` (staff lookup,
  below) were updated in the same pass (migration `0041`) to treat
  `applied_order_id` as equally final as `fulfilled_at`, so staff can't
  double-honor a code a customer already spent online. Full round trip
  (redeem → select at checkout → place order → marked used) confirmed
  working live 2026-07-11.
- Profile's name/phone are real (`lib/supabase/profile-data.ts`,
  `profiles_update_own` RLS), inline pencil-edit writes through directly
  (no RPC needed). Email is the real logged-in Auth email, deliberately
  **read-only** — no `profiles.email` column exists, and editing the
  real Auth email would trigger Supabase's confirmation-email flow
  (rate-limit gotcha, see Auth above). Logout is real
  (`supabase.auth.signOut()` → `/menu` as guest, not `/login` — guest
  ordering stays available).
- Profile's "Settings" row is real: `/profile/settings`
  (`components/customer/profile-settings-view.tsx`, gated behind login
  via `lib/middleware-rules.ts`'s `AUTH_REQUIRED_EXACT_PATHS` — note
  this list is exact-match, not prefix-match, so a new page nested under
  an already-gated path still needs its own entry). Change Password
  calls `supabase.auth.updateUser({ password })` directly (no "current
  password" field — already-authenticated session). Connect/Disconnect
  Google uses real identity linking (`linkIdentity`/`unlinkIdentity`/
  `getUserIdentities`) — requires "Manual linking" enabled in the
  Supabase Dashboard (Authentication → configuration, off by default,
  no MCP tool for it). "Unlink" is only ever rendered enabled when the
  account has 2+ linked identities, mirroring Supabase's own
  server-side rule for the same thing — this is what actually prevents
  anyone locking themselves out, not custom logic.
- Profile's "Member ID" is a real per-user value (`#PDC-` +
  `formatOrderId(userId)`, the same truncated-UUID convention used for
  order/redemption codes elsewhere) — was a hardcoded `#PDC-8829`
  shown identically to every customer regardless of who was logged in.
- Profile's "Addresses" row is real (`/profile/addresses`, added
  2026-07-11, gated via `AUTH_REQUIRED_EXACT_PATHS` like Settings):
  `customer_addresses` table (migration `0039`), full CRUD +
  `set_default_address()` RPC (unsets all then sets one, guaranteeing
  at most one default). `lib/supabase/address-data.ts`,
  `components/customer/address-book-view.tsx`. Personal reference only
  — this app has no delivery `order_type` (`pickup | dine_in` only), so
  it's not wired into checkout.

### Reviews (real, all end-to-end)
- `menu_item_reviews` table + three `security definer` RPCs:
  `submit_menu_item_review` (verified-purchase only — requires a real
  `completed` order containing the item; upserts on
  `(menu_item_id, customer_id)`, so resubmitting edits the existing
  review rather than duplicating it), `reply_to_review`
  (manager/admin only), `get_menu_item_reviews` (public read,
  `security definer` because resolving the reviewer's display name
  needs `profiles.full_name`, which plain RLS would block for anyone
  who isn't that reviewer or staff). `lib/supabase/reviews-data.ts` is
  the query module.
- Submission lives on the customer's own Order Tracking/History detail
  page (`/orders/[orderId]`, shared component) — a "Rate & Review"
  action per item, shown only once that order is `completed`.
- `reviewerName` is `string | null` throughout (a reviewer's
  `profiles.full_name` is frequently unset) — always render with a
  translated "anonymous" fallback, never assume non-null.
- Admin/manager can post one public reply per review from a panel in
  the Menu Management item editor (`menu-item-reviews-panel.tsx`).

### Staff pages (`/staff/pos`, `/staff/orders`, `/staff/orders/history`, `/staff/rewards`)
- POS (`components/staff/pos-terminal.tsx`) — real size/extras picker
  (added 2026-07-11): `components/staff/pos-item-picker.tsx` mirrors
  the customer-side `QuickAddPopup`'s exact selection logic (default
  size, required-group defaults, price calc, extras-grouped-as-one-list
  layout) but reports back via an `onAdd` callback into POS's own local
  `OrderLine[]` state instead of `useCart` (a separate staff-side
  transaction, unchanged). Tapping an item with no size options and no
  modifier groups still adds directly at base price; otherwise the
  picker opens. Order lines are keyed by a generated `lineId` (not
  `menuItemId`) since the same item can now appear as multiple distinct
  lines with different size/extras — merging on re-add is keyed on
  `menuItemId + sizeId + sorted(modifierIds)`. `handleCharge` now sends
  each line's real `sizeId`/`modifierIds` to `place-order` instead of
  hardcoded `null`/`[]`.
- Staff Reward Redemption lookup (`/staff/rewards`, added 2026-07-11):
  `components/staff/reward-lookup.tsx` — search a customer's
  redemption code (the same 8-char code `rewards-catalog-modal.tsx`
  shows the customer after redeeming, `formatOrderId`-style), see the
  reward/customer/points, "Mark Fulfilled" once. `find_redemption_by_code()`
  (security invoker, RLS-gated) / `fulfill_redemption()` (security
  definer, narrowly scoped to `fulfilled_at` only, own internal
  staff-role check since it bypasses RLS) — migration `0038`. This is
  now the secondary/backup redemption path — self-service checkout
  application (migration `0040`, see "Loyalty rates are real..." above)
  is primary. Both RPCs treat `reward_redemptions.applied_order_id` as
  equally final as `fulfilled_at` (migration `0041`) so a code already
  spent online shows "Used at checkout" here instead of being
  honorable a second time in person.
- Kitchen Display — `components/staff/{kitchen-board,kitchen-top-bar,
  kitchen-sidebar,kitchen-stats-footer}.tsx`, orchestrated by
  `kitchen-display.tsx`. Board maps the real 6-state `order_status`
  enum (`pending_payment → paid → preparing → ready →
  completed/cancelled`); stats footer/sidebar shift-stats are all
  computed live, not mock.
- `hooks/useKitchenOrders.tsx` — shared Context for POS+KDS; `advance()`
  is the single choke point for status changes; deliberately not
  persisted to localStorage (matches pre-existing reset-on-reload
  behavior). Exposes real `isRealtimeConnected` (from the Realtime
  channel's own `.subscribe()` status, added 2026-07-11) — KDS's top
  bar "System Online" indicator now reflects the actual connection
  instead of a static always-green dot that stayed green even if
  Realtime silently dropped.
- Staff Order History (`/staff/orders/history[/[orderId]]`) —
  staff-wide order lookup, distinct from the customer's own history.
  `get_order_history()` RPC (migration `0019`) does search/filter/
  pagination in one round trip; `lib/supabase/orders-data.ts`'s
  `getOrderHistory`/`getOrderHistoryDetail`; `hooks/useOrderHistory.tsx`
  is a plain hook (not Context — nothing else shares this data).

### Admin pages (`/admin/dashboard`, `/menu`, `/inventory`, `/tables`, `/staff`, `/settings`)
- One left-sidebar shell (`components/admin/admin-sidebar.tsx` +
  `app/[locale]/admin/layout.tsx`) for all routes.
- `hooks/useInventory.tsx` (shared Dashboard+Inventory) — real stock
  adjustment via `adjust_ingredient_stock` RPC (atomic, clamps at 0),
  real `inventory_logs`, admin-configurable recipes
  (`menu_item_ingredients`/`modifier_ingredients`, feeding the
  `handle_order_paid` deduction trigger).
- `hooks/useTables.tsx` (shared Admin Tables + Table QR flow + KDS
  Tables column) — real rename/location, plus `status` (see "Table
  status" below), all Realtime.
  `regenerate_table_qr_token` (admin-only) and
  `increment_table_scan_count` (the one guest-writable `security
  definer` RPC in this flow, scoped to only ever touch `scan_count`)
  back the two operations plain RLS updates can't safely express.
  `activeTable` (a browser tab's dine-in session) deliberately keeps
  `localStorage` persistence — must survive a locale-switch remount.
- Menu Management: real Sizes editor — admin can add/remove/reorder
  per-item sizes with an editable name + price each (e.g. a drink can
  offer only M/L, not S), backed by `menu_item_sizes.sort_order`
  (migration `0033`) and `lib/supabase/menu-data.ts`'s `setItemSizes`
  (bulk delete-then-insert, called from `menu-management.tsx`'s
  `saveItem`).
- Menu Management: real image upload — `menu-item-form.tsx` shows an
  instant local `URL.createObjectURL()` preview (`ownsPreviewUrl` flag
  prevents revoking a blob URL still live elsewhere), then on Save
  actually uploads to the public `menu-item-images` Storage bucket
  (admin/manager-only write) and persists the real public URL. (Was
  genuinely broken until 2026-07-09 — the blob URL was silently
  discarded on save instead of uploaded; fixed.) Real pagination, real
  Add/Edit. List/preview thumbnails are a consistent square crop
  (`object-cover`).
- Staff Accounts: `create-staff-account` Edge Function creates a real
  Auth account + shows a one-time generated password; `profiles` rows
  can only be created via the `handle_new_user` trigger, so this can't
  be a plain insert. `set_initial_staff_role()` RPC (migration `0017`)
  works around `on_profile_role_change`'s trigger blocking the very
  first role assignment on a service-role connection with no JWT.
- Dashboard's revenue/orders/loyalty KPIs, 7-day chart, and best
  sellers are real (`get_dashboard_stats()` RPC, migration `0026`),
  Realtime on `orders`/`order_items`/`loyalty_transactions`. A 5-sheet
  `.xlsx` export button (`xlsx`/SheetJS) sits alongside it. The Revenue
  card links to `/admin/shift` (see "Shift closing" below).
- Admin Settings (`/admin/settings`, made real 2026-07-11): shop
  info (name/address/phone/hours) + tax rate, and loyalty
  enabled/earn-rate/redeem-rate, now actually persist to
  `shop_settings`/`loyalty_settings` via `lib/supabase/settings-data.ts`
  (migration `0042`) — `settings-view.tsx` was previously 100%
  `useState`-only mock (a stale doc-comment literally said the tables
  didn't exist yet, even though they'd existed since migration `0002`).
  Worst part of the gap: POS's tax line used a hardcoded
  `TAX_RATE = 0.08` that was never even sent to `place_order` — the
  server recomputed the total from scratch with **no tax at all**, so
  the number staff saw on screen was pure client-side decoration, never
  actually charged or recorded. Tax is now real end-to-end for **both**
  POS and online checkout (`orders.tax_amount`, computed by
  `place_order` from `shop_settings.tax_rate` on the post-discount
  subtotal — server-authoritative, matches how every other discount is
  never trusted from the client), shown in POS's order panel, checkout's
  summary, and the customer's own order tracking/history detail. The
  "Enable Program" loyalty toggle now actually gates both point earning
  (`handle_order_paid`) and point redemption (`place_order` raises
  `loyalty_program_disabled`) instead of doing nothing; checkout hides
  its whole Loyalty Points section when disabled.
  `shop_settings.tax_rate` is stored as a decimal fraction
  (`numeric(5,4)`, e.g. `0.08`) but the Admin UI/`ShopSettings` type
  both work in whole percent (e.g. `8`) — conversion happens in
  `settings-data.ts`, not spread across call sites. **Left at `0` on
  purpose** — no real tax rate was ever specified, so nothing was
  invented; the admin needs to set the real rate once via the now-working
  Settings page.

### Orders + Realtime (core, all real)
- `place_order` RPC (`security definer`) — the only place order money
  is computed; never trusts client-supplied prices. Always inserts
  `pending_payment`/`pending`, second `UPDATE` to `paid` when already
  collected (POS).
- `get_order_for_tracking` / `cancel_pending_order` — guest-safe
  single-row RPCs (see "Guest-safe RPC pattern" above).
- `place-order` Edge Function wraps `place_order` with the service-role
  key (see the JWT-forwarding gotcha above).
- A guest's own tracking page has no Realtime path (would require a
  bulk-guest-visibility RLS leak) — polls `get_order_for_tracking`
  every 10s instead, labeled in the UI as polling. Logged-in
  customers/staff get true Realtime.
- Order Tracking's "Contact Shop" button calls the real
  `shop_settings.phone` (`getShopSettings`, added 2026-07-11) and
  hides itself entirely when no phone is configured — was a hardcoded
  fake number (`+84281234567`) dialed for every order regardless of
  which shop's data was actually configured.

### Table status — occupancy + cleaning (all real, shipped 2026-07-08)
- `tables.status` (migration `0021`) is a 3-state enum — `available |
  occupied | cleaning` — replacing the old `is_occupied` boolean.
- **Occupied**: automatic — `sync_table_occupancy` trigger fires on a
  dine-in order `INSERT`, regardless of payment status.
- **Cleaning**: automatic — same trigger, fires when a table's *last*
  active order reaches `completed`/`cancelled`. Deliberately not the
  same event as "guest left" — a finished order always routes through
  Cleaning, never straight to Available.
- **Available**: always a manual staff tap ("Cleaning Done") — never
  automatic. Two surfaces call the same `setStatus`: the KDS "Tables"
  4th board column (`components/staff/kitchen-tables-column.tsx`) and
  Admin Tables (`components/admin/tables-management.tsx`, a 3-state
  contextual button, not a binary toggle).
- Guests scanning a `cleaning` table's QR get a blocked message with a
  "Notify Staff" button — guest-safe `notify_table_cleaning` RPC (sets
  `cleaning_notified_at`), shown as an urgent badge on the KDS table
  card until cleared.
- Admin Dashboard has a real-time "Table Status" card (3-way counts +
  a cleaning-attention alert), alongside the real KPI cards above it
  (see Admin pages above).
- Design: `docs/superpowers/specs/2026-07-08-table-status-design.md`;
  plan: `docs/superpowers/plans/2026-07-08-table-status.md`.

### Deferred payment + service lifecycle (all real, shipped 2026-07-08)
- New `served` order status (between `ready` and `completed`) — set
  from the table's own card in the KDS Tables column for dine-in (not
  the order card), or the existing Ready-column tap for pickup (no
  table to attach a Served action to).
- Checkout offers **Pay Now / Pay Later**. Pay Now is the unchanged
  existing flow (payment method picked at checkout, before the kitchen
  ever sees the order). Pay Later shows **no payment method picker at
  checkout at all** — the order reaches the kitchen immediately
  (bypasses `pending_payment`), and both the method and the payment
  itself are chosen only once the order is `served`:
  - **Customer** picks Cash/Card/VNPay on their own tracking page (a
    3-way picker) — Cash just records the choice for staff to collect
    in person; Card/VNPay records it and redirects to that gateway
    immediately.
  - **Staff** can also mark Cash directly from the table's card in KDS
    ("Mark Cash") — Stripe/VNPay stay customer-only, since staff can't
    complete a hosted checkout on the guest's behalf.
  - `orders.payment_method` is nullable (migration `0023`);
    `place_order` only requires it when `payAt = 'now'`.
- **Auto-completion**: `complete_order_when_served_and_paid` trigger
  (migration `0022`) promotes an order to `completed` the instant it's
  both `served` and `payment_status = 'paid'`, regardless of which
  becomes true first — a Pay Now order satisfies payment before
  serving, so tapping Served completes it immediately; a Pay Later
  order satisfies serving first and waits on payment.
- New `pay-order` Edge Function — customer-triggered deferred
  Stripe/VNPay checkout-session creation, reusing `place-order`'s
  session-building logic but invoked later against an existing order.
  `stripe-webhook`/`vnpay-ipn`/`vnpay-return` were all corrected to
  branch on the order's *current* status, so a served-but-unpaid order
  is never wrongly regressed back to `paid` or cancelled by a stale
  payment attempt.
- Checkout now **requires a real scanned table for Dine-in** — the
  toggle is disabled until `activeTable` is set (no more fake
  fallback table number sending `table_id: null`, which used to make
  an order invisible to the entire table-driven KDS model).
- **Payment method correction** (real, shipped 2026-07-10): a
  served-but-unpaid order's recorded method can be changed or reset.
  `change_order_payment_method(p_order_id, p_method default null)`
  (guest-safe `security definer`, migration `0032`) only acts while
  `status = 'served' AND payment_status = 'pending'`; `null` resets to
  "no method chosen." Two surfaces: the customer's tracking page
  ("Change payment method" under the Cash-awaiting note, "Choose a
  different method" next to the gateway retry button) and KDS's table
  card (an "Undo" button next to Confirm Cash — dine-in only, no
  pickup equivalent, see known gaps below).
- Design: `docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md`
  (see its "Revision" section for the method-also-deferred correction);
  plan: `docs/superpowers/plans/2026-07-08-deferred-payment-service-lifecycle.md`.
  Payment method correction: `docs/superpowers/specs/2026-07-10-payment-method-correction-design.md` /
  `docs/superpowers/plans/2026-07-10-payment-method-correction.md`.

### Payments — Cash, Stripe, VNPay (all real, all end-to-end verified live)
- **Cash**: self-checkout starts `pending_payment`; staff confirms via
  `components/staff/kitchen-pending-payment.tsx`'s "Confirm Cash
  Received" (`confirmCashPayment`, plain update). POS cash collects in
  person, skips straight to `paid`.
- **Stripe**: `place-order` creates a real Checkout Session (raw
  `fetch`, no SDK) when `paymentMethod === "stripe"` and not already
  collected; 30-min `expires_at`. `stripe-webhook` (HMAC-SHA256 via Web
  Crypto) is the source of truth for "paid" —
  `checkout.session.completed`/`.expired` flip the order via a guarded
  `UPDATE ... WHERE payment_status = 'pending'`. POS's Card option
  reuses the `'stripe'` enum value (no separate `'card'` value), sends
  `paymentCollected: true`, skips the Stripe branch entirely.
- **VNPay**: `place-order` builds a locally-signed redirect URL (no API
  call needed). `vnpay-ipn` (server-to-server, source of truth, VNPay's
  `{RspCode, Message}` response contract) and `vnpay-return` (single
  return URL for every outcome, distinguished by `vnp_ResponseCode`;
  calls `cancel_pending_order` on failure) are both real. POS's VNPay
  option has its own real `'vnpay'` enum value.
- All three share `cancel_pending_order` for self-cancel/expiry cleanup.
- Out of scope for all three: refunds/disputes (handled manually via
  each gateway's dashboard), any in-person card/QR reader hardware
  integration (Stripe Terminal etc.).

### Shift closing (real, shipped 2026-07-10)
- `/admin/shift` — cash reconciliation: open a shift with a starting
  cash amount, a live report tracks cash orders against it, close with
  a counted amount to get an over/short summary.
- `shifts` table + `orders.paid_at` column + three RPCs (migration
  `0031`): open/report/close. `open_shift` errors cleanly (shown, not
  crashed) if a shift is already open — only one open shift at a time.
- `lib/supabase/shift-data.ts` query module; reachable from Admin
  Dashboard's Revenue KPI card and the Admin sidebar. Manager/admin
  only (same gate as the rest of `/admin/*`).
- **Shift History** (real, added 2026-07-11): `/admin/shift` has a
  Current/History tab switch. `get_shift_history()` RPC (migration
  `0036`) lists every past closed shift (open/close time, counted cash,
  difference, total revenue across all methods) — `getShiftHistory`.
  Selecting one calls the already-existing `get_shift_report(p_shift_id)`
  (query layer's `getShiftReport` gained an optional `shiftId` param) to
  show that shift's full detail. `components/admin/shift-report-detail.tsx`
  is the shared renderer (opened/closed time, KPI stats, per-method
  breakdown, transaction list) used for the live shift, the
  just-closed summary, and any historical shift — previously the
  just-closed summary only showed cash stats with no method breakdown
  and nothing at all persisted once you navigated away, since only the
  currently-open shift was ever fetchable.
- Plan: `docs/superpowers/plans/2026-07-10-shift-closing.md`; design:
  `docs/superpowers/specs/2026-07-10-shift-closing-design.md`.

## Database (`supabase/migrations/`)

67 migrations applied to the live hosted project (`qhiypdqnrnzndxdwqxbx`)
via the Supabase MCP server's `apply_migration`. Every table in `public`
has RLS enabled (confirmed via `list_tables`/`get_advisors`).

| Range | Covers |
|---|---|
| `0001`–`0007` | identity/roles, shop config, menu, inventory, orders, payments/loyalty, `handle_order_paid` trigger |
| `0008`–`0009` | menu bilingual columns + real menu seed |
| `0010`–`0011` | inventory bilingual columns + `adjust_ingredient_stock` RPC + seed |
| `0012`–`0013` | tables bilingual columns + scan/QR-regen RPCs + seed |
| `0014`–`0015` | `place_order`/`get_order_for_tracking` RPCs + Realtime publication fix |
| `0016`–`0017` | `profiles.is_active` + `get_staff_members()` + `set_initial_staff_role()` |
| `0018` | `cancel_pending_order()` (Stripe follow-up) |
| `0019` | `get_order_history()` (Staff Order History) |
| `0020` | `menu_items.has_size_options` (per-item size-picker toggle) |
| `0021` | `tables.status` 3-state enum + occupancy/cleaning trigger + `notify_table_cleaning()` guest RPC |
| `0022`–`0023` | `served` order status + auto-completion trigger + `payAt`/nullable `payment_method` (deferred payment) |
| `0024` | fixed `sync_table_occupancy`'s trigger column-scope gap (see gotcha below) |
| `0025` | `tables_update_staff` RLS policy (staff-role gap, see gotcha below) |
| `0026` | `get_dashboard_stats()` (real Admin Dashboard KPIs) |
| `0027` | `menu_item_reviews` table + review RPCs |
| `0028` | `menu-item-images` public Storage bucket |
| `0029` | `get_order_for_tracking` carries `menuItemId` (needed by reviews) |
| `0030` | `get_order_history()` date filters made null-safe (removed a silent 7-day default) |
| `0031` | `shifts` table + `orders.paid_at` + shift open/report/close RPCs |
| `0032` | `change_order_payment_method()` (Pay Later method correction) |
| `0033` | `menu_item_sizes.sort_order` (admin Sizes editor display order) |
| `0034` | `loyalty_tiers` table + `get_my_loyalty_tier_progress()` (real Loyalty tier progress) |
| `0035` | `rewards`/`reward_redemptions` tables + `redeem_reward()` (real Rewards catalog/redemption) |
| `0036` | `get_shift_history()` (Shift History — list + view past closed shifts) |
| `0037` | Missing FK indexes on menu tables (performance) |
| `0038` | `reward_redemptions.fulfilled_at` + `find_redemption_by_code()`/`fulfill_redemption()` (staff redemption lookup) |
| `0039` | `customer_addresses` table + `set_default_address()` (real Address Book) |
| `0040` | `rewards.discount_value_vnd` + `reward_redemptions.applied_order_id` + `get_redemption_expiry()`/`get_my_redemptions()` + `place_order` gains `redemptionIds` (self-service reward-redemption checkout) |
| `0041` | `find_redemption_by_code()`/`fulfill_redemption()` also treat `applied_order_id` as "used" (staff/checkout consistency) |
| `0042` | `loyalty_settings.enabled` + `orders.tax_amount` + `place_order`/`handle_order_paid`/`get_order_for_tracking` gain real tax + loyalty-enabled enforcement (Admin Settings made real) |
| `0043` | `handle_order_paid` doubles points when paid on a Wednesday (Asia/Ho_Chi_Minh) — makes the Loyalty page's "Double Points Wednesday" banner real |
| `0044` | `place_order`'s `paymentCollected: true` branch gated behind a real staff/manager/admin role check (was callable by any anon/authenticated caller to fabricate a free "paid" order) |
| `0045` | `set_initial_staff_role` locked down after Supabase's platform-level default privileges left it anon/authenticated-executable despite its own `revoke ... from public` (see the auto-re-grant gotcha below) |
| `0046` | Closed direct client-forgeable `orders`/`order_items` INSERT + customer self-inflated `loyalty_points_balance` (raw client writes bypassing `place_order` entirely) |
| `0047` | Follow-up to `0046` — a column-level revoke can't narrow an already-broader table-level grant; re-does the fix by revoking the blanket table grant and re-granting only safe columns |
| `0048` | Fixed `current_user_role() not in (...)` returning `NULL` (not `TRUE`) for a fully anonymous caller under three-valued logic — silently bypassed every function using that exact pattern as its only gate |
| `0049` | `tables_update_staff` column-scoped to close a direct `qr_code_token` overwrite `0046`/`0047` missed (UPDATE privilege is independent of SELECT) |
| `0050` | `menu-item-images` bucket gains real `allowed_mime_types`/`file_size_limit` (previously client-claimed only, unenforced server-side) |
| `0051`–`0052` | `landing-hero-images` Storage bucket + `shop_settings` hero-image columns (admin-editable hero photo background) |
| `0053` | Shift management rebuild — staff (not just manager/admin) can open/join/close a shift; `place_order` now rejects every order while no shift is open; opener/closer names + planned window + per-worker roster + per-item revenue breakdown |
| `0054` | Locked down `0053`'s unscoped `FOR ALL` shifts/shift_workers RLS (was the actual write gate since those RPCs are `security invoker` — any staff JWT could bypass the RPCs entirely via a direct PostgREST call) |
| `0055` | Dropped the stale single-arg `open_shift(int)` overload `0053`'s signature change left behind |
| `0056` | `change_order_payment_method()` gains an ownership check (mirroring `cancel_pending_order`) — a served-unpaid order's UUID alone was previously enough to change/reset its payment method |
| `0057` | `edge_rate_limits` table + `check_rate_limit()` RPC — DB-backed per-key rate limiting for the guest-callable `place-order`/`pay-order` Edge Functions |
| `0058` | Fixed an off-by-one in `0057`'s `check_rate_limit()` (allowed one fewer request than configured) |
| `0059`–`0060` | Backfilled `confirm_order_payment()` (applied live 2026-07-28 outside the repo) and revoked an anon `EXECUTE` grant the platform auto-added — was a live payment-bypass (any anon caller could mark any pending order "paid") |
| `0061` | Revoked the same platform auto-re-grant on `check_rate_limit` (anon/authenticated could otherwise manipulate arbitrary rate-limit counters) |
| `0062` | Defense-in-depth role checks added to `get_dashboard_stats`/`get_order_history`/`get_shift_history`/`get_shift_report`/`find_redemption_by_code` (not currently exploitable — RLS-backstopped — but were missing the check every sibling staff-only function has) |
| `0063` | `menu_item_reviews` direct SELECT scoped to own-or-staff (was `using (true)`, leaking raw `customer_id` UUIDs per review) |
| `0064` | Added matching `WITH CHECK` to 3 UPDATE policies (`profiles_update_admin`, `shop_settings`/`loyalty_settings`) that only had `USING` |
| `0065` | `get_redemption_expiry()` gains an ownership check, closing an existence-oracle side effect too |
| `0066` | Added `set search_path = public` to the two functions missing it (`adjust_ingredient_stock`, `set_order_paid_at`) |
| `0067` | Row-locks (`FOR UPDATE`) the loyalty-balance read in `redeem_reward`/`place_order` to prevent a concurrent-redemption race driving the balance negative |

**Live-grant auto-re-grant gotcha, worth remembering:** a migration's own
`revoke all ... from public; grant execute ... to X;` does NOT reliably
survive Supabase's platform-level auto-grant behavior on `CREATE
FUNCTION` — a distinct, LATER follow-up migration is required every
time. Has bitten this project at least four times now (`0045`, `0047`,
`0060`, `0061`). Any new `SECURITY DEFINER` function should have its
`information_schema.role_routine_grants` checked live immediately after
creation, not assumed correct from the migration text alone.

A real admin account (`admin@phadincoffee.dev`) was bootstrapped via
direct SQL insert into `auth.users` (public signup hits the shared email
rate limit). Two throwaway test accounts (staff/customer roles) also
exist — credentials in `.env.local` and the gitignored `test-accounts.md`.

## Edge Functions (`supabase/functions/`)

All real: `place-order` (routes to Stripe/VNPay/cash based on payload),
`stripe-webhook`, `vnpay-ipn`, `vnpay-return`, `create-staff-account`.
None use an SDK for their respective gateway — raw `fetch`/Web Crypto
throughout, matching this project's dependency-free convention. No Deno
test harness exists in this project — Edge Functions are verified live
(curl smoke tests + real sandbox transactions), not with automated tests.

## Deployment (Vercel)

Live at **https://phadincoffee.vercel.app** (project `phadincoffee`,
`gnoltd-s-projects` team, linked to `Gnoltd/CoffeeShop` — push to `main`
auto-deploys, no manual `vercel deploy` needed).

- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` (dead —
  VNPay's real return URL is built dynamically pointing at the Supabase
  function URL, not this var). The Stripe/VNPay secrets are *also*
  separately required as **Supabase Edge Function secrets** — see
  Cross-cutting conventions above; Vercel and Supabase are two
  different secret stores.
- **Supabase Auth's "URL Configuration" (Site URL + Redirect URLs) is
  Dashboard-only**, no MCP tool exposes it. Must include
  `https://phadincoffee.vercel.app/**`, the Vercel preview-deployment
  wildcard, and `http://localhost:3000/**`.

## Building the rest

All Stitch-designed pages are ported; all four original "make all data
real-time" sub-projects (Inventory, Tables, Orders, Staff accounts),
all three payment methods (Cash, Stripe, VNPay), table occupancy/
cleaning, deferred payment + service lifecycle, payment method
correction, real reviews, real menu-image upload, real Profile
persistence, the admin Sizes editor, Shift History, the real Address
Book, the POS size/extras picker, and the Admin/KDS/POS nav-link gaps
are shipped and verified live. Google sign-in and Profile Settings
(password change + Google account linking) are shipped and
live-verified end-to-end. Forgot password is shipped and verified live
except for the actual emailed-link round trip (shared email-sender
rate-limit risk, same as signup confirmation). Loyalty tier progress
(migration `0034`) and rewards catalog/redemption + its staff-facing
redemption lookup (migrations `0035`, `0038`) are both real, shipped
and live-verified end-to-end. Real Admin Dashboard KPIs and shift
closing's open/report/close flow are shipped but still need a hand
live-verification pass — an automated attempt at this specific check
has stalled twice without landing a result, see `daily.md`'s Open
list. No known-mock surfaces remain — check `daily.md` for current
status.
When adding anything new:
shared brand tokens, `useTranslations`/`getTranslations` with both
message files updated together, Base UI's `render` prop for polymorphic
Buttons, "disabled + tooltip" for unbacked actions, DI'd query-layer
modules, guest-safe RPCs for anything a logged-out user needs to touch.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `Gnoltd/CoffeeShop`, managed via the `gh`
CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See
`docs/agents/domain.md`.
