# CLAUDE.md

Structural map of PhaDinCafe. Full rationale/history lives in
`docs/superpowers/specs/` and `docs/superpowers/plans/` — one dated
design+plan pair per feature (e.g. `2026-07-07-vnpay-payment-integration-{design,}.md`).
This file is the current-state summary; check the dated docs for "why" a
decision was made or the full bug-hunt narrative behind a fix.

## Status

**Rebuilt 2026-09-19 into a deliberately minimal, single-purpose app**
(the "minimal ordering rebuild" — see
`docs/superpowers/specs/2026-09-19-minimal-ordering-rebuild-design.md`
for the design/decisions and
`docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md` for the
full task-by-task execution, including several real mid-execution
findings/corrections recorded inline against Tasks 1, 8, 9, and 16 —
read those before trusting the original plan text's intent over what
actually shipped). The app now does exactly one thing end-to-end: a
guest scans a table's QR code, orders from a live shared table cart
(`/table/[qrToken]`, multi-device real-time sync, no account of any
kind), and staff/manager/admin run one login-gated "operations" area
(`/staff/orders` KDS + `/staff/tables`) that settles every bill in cash.
Admin is limited to `/admin/menu` (items/prices/images/availability),
`/admin/staff` (create staff accounts), and a trimmed `/admin/settings`
(shop name/address/phone/hours only — no tax, no loyalty, no landing
hero). Removed entirely (application code, not DB — see the Database
section below): customer accounts/login/signup/Google sign-in/forgot-
password, Profile + Profile Settings, Address Book, Loyalty, Rewards +
staff redemption lookup, Reviews, Promotions/promo codes, the
individual (non-table) cart + checkout, Pickup as an orderable type,
Pay Now/Pay Later choice, Stripe, VNPay, tax calculation, POS, Shift
Closing (and the underlying shift-open gate that used to block
ordering entirely), Admin Dashboard, Admin Inventory, Food Cost, and
the landing/marketing page. Bilingual (`vi`/`en`) and RLS-as-boundary
are unchanged from before the rebuild. **As of this docs update
(rebuild plan Task 26), the rebuild lives on branch
`rebuild/minimal-ordering-rebuild` in a git worktree and has not yet
been pushed to `main` or deployed** — the rebuild plan's Task 27 (final
local build/lint/test pass) and Task 28 (push + live-verify) come
after this one; until Task 28 lands,
**https://phadincafe.vercel.app** (auto-deploys on push to `main`)
still serves the pre-rebuild, full-featured app this Status section no
longer describes. Check `git log`/`daily.md` for whether that's since
happened. See `daily.md` for what's currently open — it's kept short
and recap-free by design, so check it before this file for "what's
left."

## Stack

Next.js (App Router) + Tailwind v4 + shadcn/ui + next-intl, talking
directly to Supabase (Postgres + Auth + Realtime) via its SDK. No custom
backend server — RLS is the access-control boundary. **Since the
2026-09-19 rebuild removed Stripe/VNPay/POS, only one Edge Function
remains** (`create-staff-account`, for the one thing that still needs
the service-role key/atomicity outside the DB) — order placement now
goes straight through a `security definer` RPC
(`place_table_round`/`place_order`) called directly from the browser,
no Edge Function in front of it.

## Roles

`profiles.role`: `customer | staff | manager | admin`. **Since the
2026-09-19 rebuild, nothing ever creates a new `customer` row** (signup
is deleted — see the Route map) — the value stays in the enum and in
role-resolution code (`lib/get-current-role.ts` still returns
`"customer"` as the downgrade target below) only because old rows and
that downgrade mechanism aren't something this rebuild touches. Staff =
Kitchen Display + Tables (`/staff/orders`, `/staff/tables`) — POS is
deleted. Manager currently has identical reach to Staff (both land on
`/staff/orders`) plus `/admin/menu`; Inventory/reports/dashboard, the
old manager-only surfaces, are deleted. Admin = Manager + `/admin/staff`
(staff accounts/roles) + `/admin/settings` (shop info only — tax/loyalty
settings are deleted). Per Decision 23 of the 2026-09-19 design doc,
staff/manager/admin deliberately stay three distinct DB/RLS roles even
though staff and manager now end up with near-identical UI access —
collapsing the role schema was judged a bigger, riskier change than the
value it would add here.
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
  keys to **both**. `Brand.name` ("PhaDinCafe") and third-party names
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

**Rewritten 2026-09-19** (the minimal ordering rebuild) — verify against
`find app -type f` if this ever looks stale, rather than trusting this
list from memory. Relative to the locale prefix, under `app/[locale]/`:
- `(auth)` — `/login` only (route group, contributes no URL segment).
  The one surviving auth surface in the whole app — staff/manager/admin
  sign-in (plain email/password, no Google/reset/signup — see the
  Feature areas' "Login" note below). `signup/`, `callback/` (Google
  OAuth), and `reset-password/` were all deleted; `(auth)/layout.tsx`
  and `(auth)/login/page.tsx` are the only two files left in the group.
- `(customer)` — `/` (a bare "scan the QR code at your table to order"
  screen with a staff-sign-in link — replaced the old merged marketing+
  dashboard Home, see the historical note below), `/menu`, `/menu/[itemId]`
  (both public and permanently read-only — no add-to-cart control is
  ever enabled outside an active table session), `/table/[qrToken]`
  (the shared table ordering session — the only place any order can be
  placed, and the only "logged-in-feeling" customer surface, though it's
  still fully guest/anonymous).
- `staff` — `/staff/orders` (KDS ticket board) and `/staff/tables`
  (table list/CRUD/QR + cash confirmation, absorbing the old admin
  Tables page). Both files live under a route group,
  `app/[locale]/staff/(operations)/`, sharing one layout/nav — the
  group contributes no URL segment, so the live paths are still
  `/staff/orders`/`/staff/tables`. `/staff/pos`, `/staff/orders/history`,
  `/staff/orders/shift-history`, and `/staff/rewards` are all deleted.
- `admin` — `/admin/menu`, `/admin/staff` (admin-only), `/admin/settings`
  (admin-only). `/admin/dashboard`, `/inventory`, `/tables`, `/food-cost`,
  `/shift`, and `/promotions` are all deleted.

`middleware.ts` (+ `lib/middleware-rules.ts` for the pure/testable
routing logic, extracted so it doesn't pull in `next-intl/middleware`
under Vitest) gates `/staff/*` (staff|manager|admin) and `/admin/*`
(manager|admin), with `/admin/staff`/`/admin/settings` further
restricted to admin only (`/admin/menu` stays manager+admin).
`AUTH_REQUIRED_EXACT_PATHS` is now an empty array — every customer-
facing route is guest/anonymous, so there is no page left that needs to
gate a logged-out guest (the old `/profile`/`/orders`/`/loyalty` exact-
path gates were deleted along with those routes). Fails open to
anonymous on Supabase errors rather than crashing.

**Superseded 2026-09-19:** the minimal ordering rebuild replaced the
merged Home page this whole entry describes with a bare "scan the QR
code" screen (`app/[locale]/(customer)/page.tsx`, see the Route map
above) — `home-view.tsx`, `best-sellers-arc.tsx`, and every mockup-
fidelity detail below are deleted. Kept here as history per this file's
own convention rather than deleted outright.

**Home (`/`) merge, 2026-09-06:** the old `(marketing)` route group (a
separate public landing page at `/`, `CoffeeCupHero` +
`BestSellersGallery`'s full-viewport scroll-jacked arc + `BestSellersMarquee`)
and the old auth-gated `/home` dashboard tab were merged into one page,
rebuilt from an imported Claude Design canvas mockup rather than adapted
from either predecessor. `/` now lives in `(customer)` (gets the real
`CustomerHeader`/`BottomNav`/Cart+Orders+Tables providers everyone else
already has) and renders for everyone: guests see the hero/best-sellers/
store-info content with no personalized sections; logged-in customers
additionally get the greeting hero's quick-add suggestion, dine-in/pickup
tiles, a rewards banner (linking to the real `/loyalty/redemptions`
catalog — the mockup's promo copy was fabricated, not backed by real
data), a table-session-resume banner (new: `lib/active-table-storage.ts`
persists the joined `qrToken` client-side, re-validated on load via the
existing guest-safe `get_table_session` RPC), the live-order banner,
quick reorder, and the loyalty progress card. `ROLE_HOME.customer` is now
`"/"`. **Revised 2026-09-07:** the bestsellers section
(`components/customer/best-sellers-arc.tsx`) went through two wrong builds
before matching its actual source — first a flat swipe-carousel, then a
full-viewport dark scroll-jacked arc ported from the old deleted
`(marketing)` route's `BestSellersGallery`. Neither was "the ref": the
real source is the Claude Design canvas Home was rebuilt from
(`PhaDinCafe Customer App.dc.html`, imported live via the design MCP —
see its `bsCards`/`frame()` logic), which defines a much smaller, plainer
technique — a `min(360px, 100%)` sticky box (normal `nb-border`/light
card styling, no dark takeover) where cards stack at one spot and each
slides diagonally, rotates ±6°, scales, and fades as scroll passes its
own 300px window (`frame(u)`, `u = scrollProgress - cardIndex`); section
height is `360 + count*300 + 144` px, not viewport-relative. Ported
1:1 including the exact transform formula and the mockup card's
`Home.selectThis` CTA copy (was already a real, unused translation key —
evidence this was the intended build all along). The one deliberate deviation: the mockup's trailing card is
a fabricated "Buy 1 Get 1" promo with category-filter chips; this build's
trailing card is the same real rewards card (→ `/loyalty/redemptions`)
used throughout Home instead, since that promo copy isn't backed by real
data (same reasoning as the hero's promo banner, below). A static-list
`prefers-reduced-motion` fallback (not present in the mockup) is kept as
a real accessibility fix. Left deliberately
untouched: the Admin Settings "Landing Hero" image card
(`components/admin/landing-hero-settings-card.tsx`) and its
`landing-hero-images` bucket/`shop_settings` columns (migrations
`0051`–`0052`) — nothing customer-facing consumes those images anymore
now that `CoffeeCupHero` is gone; flagged here rather than removed since
that's an admin-facing feature outside this change's scope.

## Cross-cutting conventions & gotchas

Reusable facts that apply anywhere in the codebase, not tied to one feature.

- **Base UI, not Radix**: shadcn's `Button` wraps `@base-ui/react/button`
  — no `asChild`. For polymorphic rendering use `render`:
  `<Button render={<Link href="/x" />} nativeButton={false}>`.
- **Toggle switches need an explicit `left` position** on the thumb
  (`absolute left-0.5 top-0.5`, `translate-x-0`/`translate-x-5`) —
  omitting it makes the browser's static-position fallback push the
  "on" thumb outside the track.
- **The fixed `HeaderActionsStack`** (`components/shared/header-actions-stack.tsx`,
  role badge + theme toggle + `LanguageSwitcher`, mounted from
  `app/[locale]/layout.tsx`, `fixed top-3 right-4 z-50`) can overlap
  admin header action buttons — admin layout uses `pt-16` to keep
  content clear of it. It renders as a sibling of `{children}` in the
  root layout, not a descendant — a component inside it can't read
  context from a provider scoped lower in the tree (e.g. customer-only
  `TablesProvider`); see `useActiveTableOptional`'s localStorage-based
  workaround in `hooks/useTables.tsx` for the pattern to reuse instead
  of `useContext` in this situation.
- **Historical (no longer applicable after the 2026-09-19 rebuild
  removed Stripe/VNPay, but keeping the lesson):** Supabase Edge
  Function secrets (`Deno.env`) are a separate store from Vercel's env
  vars — syncing a var to Vercel does *not* make it available inside an
  Edge Function; it must also be set via the Supabase Dashboard (Edge
  Functions → Secrets) or `supabase secrets set`. Bit this project
  repeatedly (`STRIPE_SECRET_KEY`, `SITE_URL`, `STRIPE_WEBHOOK_SECRET`,
  `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` all needed this separately) back
  when those gateways existed. The one remaining Edge Function,
  `create-staff-account`, only reads Supabase's own always-present
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, so this gotcha has no live
  trigger surface today — but the underlying two-secret-stores fact
  still applies to any future custom secret. No MCP tool manages these
  secrets — it's a manual step every time.
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
  call (`lib/supabase/order-mapping.ts`'s `toRealOrderType`/
  `fromRealOrderType`). Was a real bug (every dine-in order silently
  failed) until fixed 2026-07-07. **Since the 2026-09-19 rebuild**,
  every order placed goes through `place_table_round` (dine-in only,
  always tied to a scanned table) — `pickup` can no longer be created,
  but old `pickup` rows still exist in production and KDS
  (`kitchen-display.tsx`/`kitchen-board.tsx`) still filters/displays
  them, so the enum value and this translation gotcha both stay live.
- **Resolved by deletion (2026-09-19 rebuild) — was "order-status
  lifecycle logic intentionally lives in two separate places."** This
  entry used to document a deliberate non-unification of
  `hooks/useKitchenOrders.tsx`'s status-progression logic and
  `supabase/functions/_shared/order-status.ts`'s `buildPaidUpdate` (a
  branch a Stripe/VNPay webhook applied when money cleared). Both
  webhook callers (`stripe-webhook`, `vnpay-ipn`) and `order-status.ts`
  itself are now deleted — there's no second runtime's copy of this
  logic left to compare against, so the "don't re-propose merging them"
  guidance is moot. Progression is now single-owner: migration `0082`
  added per-item `order_items.status` (so one ticket with several drinks
  can advance drink-by-drink instead of one all-or-nothing order
  status), `hooks/useKitchenOrders.tsx`'s `NEXT_ITEM_STATUS`/
  `PREV_ITEM_STATUS` maps drive the staff tap, and `orders.status`
  itself is a server-side rolled-up derivation from its items' statuses
  (same migration) that every remaining trigger
  (`complete_order_when_served_and_paid`, `sync_table_occupancy`,
  `handle_order_paid`) still reads unmodified.
- **Any code reading `profiles.role` directly** (not via
  `current_user_role()` or a function built on it) risks ignoring
  `is_active` — three call sites needed fixing for exactly this once;
  grep for a raw `.select("role")` on `profiles` before adding a new one.
- **Historical (no longer applicable after the 2026-09-19 rebuild
  removed Stripe/VNPay entirely — payment is cash-only now):** VND
  handling used to differ by payment gateway (Stripe treats VND as
  zero-decimal, send the integer total as-is; VNPay always wanted
  `total × 100` regardless of currency), and VNPay signed with PHP
  `urlencode()` convention (`+` for space, not `%20` — plain
  `encodeURIComponent` produced a wrong hash for any value containing a
  space, e.g. `vnp_OrderInfo`; a real bug until caught via live sandbox
  testing 2026-07-07, fixed with a shared `vnpayEncode()` helper). Both
  gotchas' entire trigger surface (`place-order`, `pay-order`,
  `stripe-webhook`, `vnpay-ipn`, `vnpay-return`) is deleted. Kept here
  as a reminder that a future non-VND or non-cash gateway would need the
  same kind of per-gateway amount/encoding audit, not assumed-identical
  handling.
- **Historical (narrower trigger surface after the 2026-09-19 rebuild):**
  `supabase.functions.invoke()` always attaches an `Authorization`
  header, even for a guest — for a guest it's the client's own
  publishable key, not a JWT; forwarding it blindly breaks
  `auth.uid()` resolution, so only forward when the token is actually
  JWT-shaped (3 dot-separated segments). This mattered because
  `place-order`/`pay-order` were guest-callable; both are deleted. The
  one surviving Edge Function, `create-staff-account`, is never
  guest-callable (`verify_jwt` stays on, admin-only) so this gotcha has
  no live trigger today — but the lesson still applies to any future
  guest-callable function.
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
  (`https://phadincafe.vercel.app`), not `npm run dev` — this
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
- **A `SECURITY DEFINER` function that `returns` a whole table row**
  (e.g. `returns tables`) **bypasses column-level `REVOKE`s entirely** —
  a column grant only restricts a direct `SELECT`/`UPDATE` on the table
  itself, not what a function's composite return value carries. Any
  function returning a full row must be checked for which columns it's
  actually safe to expose, not just have its own grants audited. Real
  example: `increment_table_scan_count`/`notify_table_cleaning` both
  `return tables` (the whole row, `qr_code_token` included) and are
  anon-executable — despite `qr_code_token` having zero direct SELECT
  grant (migrations `0046`/`0047`), any anon caller could `select id
  from tables` (public `tables_select_all`) then call either function
  to read back the token, recovering a table's QR code without ever
  scanning it. Fixed migration `0079`.

## Feature areas

Each real feature has its own design spec + implementation plan under
`docs/superpowers/specs/`/`docs/superpowers/plans/`. Below is only what
you need to find your way around; check the dated docs for full detail.

### Customer, staff, and admin feature areas

Migrated to per-folder files (2026-07-13) so they only load when working
in that folder: `components/customer/CLAUDE.md` (menu browsing, QR-scan
table landing, the shared table ordering session, cash-only Check
Bill), `components/staff/CLAUDE.md` (the merged KDS + Tables
"operations" area, cash confirmation), `components/admin/CLAUDE.md`
(menu management, staff accounts, trimmed settings). All three were
rewritten for the 2026-09-19 minimal ordering rebuild — everything they
used to describe (POS, reward lookup, dashboard, inventory, shift
closing, etc.) is deleted; see "Status" above and
`docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md` for
what came out. Below are only the feature areas that span multiple
directories.

### Login — the one surviving auth surface (fixed 2026-09-19)

`components/auth/login-form.tsx` (`/login`) is staff/manager/admin
sign-in only — plain email/password via
`supabase.auth.signInWithPassword`, routing to `ROLE_HOME[role]`
(`/staff/orders` for all three roles). **A real, live bug found and
fixed during the 2026-09-19 rebuild** (Task 16B, not anticipated by the
original plan): this file had a working "Sign in with Google" button, a
"Forgot password?" flow, and a "Sign up" link — all three pointed at
routes deleted many tasks earlier in the same rebuild (`(auth)/callback/`,
`(auth)/reset-password/`, `(auth)/signup/`), so all three were live
dead links on the one page every staff member actually uses to get in.
Fixed to plain email/password only. Four now-orphaned files were
deleted alongside it: `components/auth/signup-form.tsx`,
`oauth-callback.tsx`, `reset-password-view.tsx`, `google-icon.tsx`. No
self-service "forgot password" for anyone (Decision 19) — a staff
member who forgets their password gets it reset manually via the
Supabase Dashboard.

### Orders + Realtime (core, all real — rewritten for the 2026-09-19 rebuild)

**Every order is created through `place_table_round`** (dine-in only,
tied to a scanned table's shared session) — there is no other code path
that inserts an `orders` row. The call chain is `place_table_round` →
`place_table_round_legacy` → `place_order` (an idempotency wrapper
added in migration `0085`: takes a client-generated submission id and
returns the existing order on an exact retry instead of double-placing)
→ `place_order_legacy` (the original pricing/promo/loyalty/inventory
logic, unmodified except for migration `0094` removing its
`no_open_shift` guard — see the Database section). Money is still
always computed server-side; the client never supplies prices.
- Per-item kitchen status (migration `0082`): `order_items.status`
  lets one ticket with several drinks advance drink-by-drink;
  `orders.status` is a server-side rolled-up derivation from its
  items, read unmodified by `complete_order_when_served_and_paid`,
  `sync_table_occupancy`, and `handle_order_paid`.
- There is no separate guest order-tracking route or RPC anymore
  (`get_order_for_tracking`/`cancel_pending_order`/`/orders/[orderId]`
  are all deleted) — a guest's order status is shown inline on their
  own `/table/[qrToken]` page instead, via `hooks/useTableSession.tsx`
  (Realtime on `table_cart_items`/`orders`/`table_sessions`, plus a
  10s poll for `orders` status changes Realtime can't deliver to a
  guest at all — see the Shared table ordering session entry below).
- Cash confirmation is a single staff-facing RPC,
  `confirm_table_payment(p_table_id, p_method)` (migration `0091`),
  called from `/staff/tables` always with `method: "cash"` (the UI
  component is `ConfirmCashPayment`, a one-tap confirm with no picker —
  cash is the only method left system-wide). It updates every
  `pending`-payment order for that `table_id` to `paid`, which
  `handle_order_paid` (still only on an `UPDATE` transitioning
  `payment_status` to `'paid'`, never on `INSERT`) picks up as before.
- A `recall_last_completed_order()` RPC (migrations `0087`–`0089`, not
  part of the 2026-09-19 rebuild) lets staff revert the single most
  recent completed+paid order back onto the KDS board within a short
  window, resetting its item statuses too.

### Table status — DB stays 3-state, UI is binary since 2026-09-19
- `tables.status` (migration `0021`) is still a 3-state enum —
  `available | occupied | cleaning` — and `sync_table_occupancy` still
  maintains it exactly as before (occupied on a dine-in order `INSERT`;
  cleaning when a table's last active order completes/cancels;
  available only ever via a manual staff action). Per this rebuild's
  Decision 1 ("never drop a DB table/column"), none of that DB-level
  machinery changed.
- **What changed is the UI, and the history is worth getting right**:
  the old 3-state cycle button (`components/staff/kitchen-tables-column.tsx`,
  described in this section pre-2026-09-19) had already been dead,
  unrendered code since a 2026-09-05 commit — predating this whole
  rebuild by two weeks. So the "live 3-state table UI" this section used
  to describe hadn't actually been reachable by anyone for a while
  before the rebuild even started. `notify_table_cleaning`/the
  "cleaning" blocked-QR-scan screen were similarly dead on the customer
  side (`TableLanding`'s `cleaning`-status branch, removed outright in
  Task 7 of the rebuild).
- The new `/staff/tables` page (`components/staff/tables-operations-view.tsx`,
  absorbing the old admin Tables CRUD too — see the route map) is what
  actually makes a table-status view live for the first time in a
  while: a binary "trống" (empty) / "đang phục vụ" (in service) badge
  computed from whether the table currently has an open `table_sessions`
  row — reusing data the component already fetches for showing active
  carts/rounds, not a second query. No "cleaning" state, no urgent-alert
  badge, no "Notify Staff" affordance — Decision 12 dropped the
  3-way distinction from the UI entirely.
- Historical design/plan docs for the original 3-state feature:
  `docs/superpowers/specs/2026-07-08-table-status-design.md` /
  `docs/superpowers/plans/2026-07-08-table-status.md`. Current binary
  UI: Task 15/16 of
  `docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md`.

### Deferred payment, Pay Now/Later, and Payment method correction — deleted 2026-09-19

This whole feature area (the `served`-status deferred-payment lifecycle,
the Pay Now/Pay Later checkout choice, and the later "payment method
correction" undo/change flow — all shipped 2026-07-08/2026-07-10) is
gone. It only ever existed for the individual (non-table) checkout flow
and the Stripe/VNPay gateways, both deleted by the 2026-09-19 rebuild —
see "Cash-only payment" below for what replaced it. `orders.payment_method`
stays nullable (migration `0023`) and the `served` status/
`complete_order_when_served_and_paid` trigger are untouched at the DB
level (Decision 1: never drop), but nothing in the surviving UI ever
shows a payment-method picker or an "undo"/"change method" control —
every order is cash, decided once, by staff, after the fact. Historical
docs, kept for the full bug-hunt narrative:
`docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md`,
`docs/superpowers/plans/2026-07-08-deferred-payment-service-lifecycle.md`,
`docs/superpowers/specs/2026-07-10-payment-method-correction-design.md`,
`docs/superpowers/plans/2026-07-10-payment-method-correction.md`.

### Cash-only payment (real, since the 2026-09-19 rebuild)

Payment is cash-only everywhere — no Stripe, no VNPay, no method
picker of any kind shown to a customer. The customer's only
payment-adjacent action is tapping "Yêu cầu tính tiền" (request the
bill) on their table page, which calls `requestTableBill` →
`checkout_table_session(p_qr_token, p_method: 'cash', p_promo_code:
null)` directly from the browser (no Edge Function in front of it
anymore — see Edge Functions below). Staff then settle the table from
`/staff/tables` with a single-tap `ConfirmCashPayment` control that
always calls `confirmTablePayment(tableId, 'cash')` →
`confirm_table_payment` (migration `0091`). No refunds/disputes support
(handled manually, unchanged assumption from before the rebuild).

### Shift closing — deleted entirely, including the underlying ordering gate (2026-09-19)

Cash reconciliation (`/admin/shift`, open/report/close, Shift History)
is gone — `components/admin/shift-closing.tsx`, `shift-report-detail.tsx`,
`app/[locale]/admin/shift/`, `hooks/useShift.tsx`, and
`lib/supabase/shift-data.ts` are all deleted. **The more consequential
change**: `place_order_legacy` used to refuse to run at all unless a row
in `shifts` had `closed_at is null` — i.e. ordering itself was gated on
a shift being "open." Deleting only the Shift Closing UI would have
deadlocked the entire app (no UI left to ever open a shift, so no one
could ever order again) — migration `0094` removes that `no_open_shift`
guard outright. No shift concept survives anywhere, not even a minimal
open/close toggle. `shifts`/`shift_workers` tables and `orders.paid_at`
stay in the schema, unused, per the never-drop rule. Historical docs:
`docs/superpowers/plans/2026-07-10-shift-closing.md`,
`docs/superpowers/specs/2026-07-10-shift-closing-design.md`.

### Shared table ordering session (real, shipped 2026-08-28 — now the *only* ordering path)

- A live, multi-device shared cart per dine-in table — every phone that
  scans a table's QR sees and edits the same draft cart in real time,
  can place it as a round (kitchen sees it immediately), and keeps a
  running tab across multiple rounds until someone pays. **Since the
  2026-09-19 rebuild, this is the one and only way any order can be
  placed** — the old individual `/cart` → `/checkout` flow and its
  cart-transfer bridge into a table session are both deleted (Decision
  9); there is no Pickup order type left to choose either (Decision 6).
- `table_sessions`/`table_cart_items` (migration `0070`) get a public
  SELECT RLS policy and **zero write policy** — every write goes
  through guest-safe `security definer` RPCs (`get_table_session`,
  `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`,
  `place_table_round`, `abandon_table_session`, migrations `0071`–`0072`,
  `0077`, plus `0085`'s idempotency/optimistic-concurrency additions —
  see the Database section), all keyed on the table's `qr_token` rather
  than its raw `table_id` — `qr_code_token` has zero SELECT grant to
  anon/authenticated (unlike the openly-enumerable `tables.id`), so a
  qr_token-keyed RPC can't be walked table-to-table the way a
  table_id-keyed one could.
- **Check Bill** is now a single cash-only confirm, no picker or promo
  UI at all (Decision 10/14): the customer's only action is
  `requestTableBill` → `checkout_table_session(p_qr_token, p_method:
  'cash', p_promo_code: null)`, called directly from the browser (the
  `checkout-table-session` Edge Function that used to front this is
  deleted). Staff close it out from `/staff/tables` via
  `confirm_table_payment` — see "Cash-only payment" above.
- `hooks/useTableSession.tsx` drives the customer-facing session state:
  Realtime on `table_cart_items`/`orders`/`table_sessions` for fast
  updates, plus a 10s polling fallback covering `orders` status changes
  Realtime can't deliver to a guest at all (`customer_id` is null on a
  guest round, matching neither `orders_select_own` nor
  `orders_select_staff` — see the guest-safe RPC pattern above).
  `/staff/tables`' `ConfirmCashPayment` action lets staff settle a table
  whose guest never tapped Check Bill.
- Design: `docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md`;
  plan: `docs/superpowers/plans/2026-08-28-shared-table-ordering-session.md`.
  What changed for the 2026-09-19 rebuild (cash-only Check Bill, sole
  ordering path):
  `docs/superpowers/specs/2026-09-19-minimal-ordering-rebuild-design.md`
  Decisions 5/6/9/10/14, plan Tasks 5–8B.

## Database (`supabase/migrations/`)

80 migrations applied to the live hosted project (`qhiypdqnrnzndxdwqxbx`)
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

**Resolved by deletion (2026-09-19 rebuild)** — this used to be a "check
later" note about reconciling a not-yet-merged `architecture-deepening`
branch (which wired `confirm_order_payment()` into
`stripe-webhook`/`vnpay-ipn` and deleted `_shared/order-status.ts`'s
`buildPaidUpdate` helper) against the 2026-07-29 security review's P2
pass. Both `stripe-webhook`/`vnpay-ipn` and `_shared/order-status.ts`
are now deleted outright (Stripe/VNPay removed entirely), so there is
nothing left to reconcile.
| `0061` | Revoked the same platform auto-re-grant on `check_rate_limit` (anon/authenticated could otherwise manipulate arbitrary rate-limit counters) |
| `0062` | Defense-in-depth role checks added to `get_dashboard_stats`/`get_order_history`/`get_shift_history`/`get_shift_report`/`find_redemption_by_code` (not currently exploitable — RLS-backstopped — but were missing the check every sibling staff-only function has) |
| `0063` | `menu_item_reviews` direct SELECT scoped to own-or-staff (was `using (true)`, leaking raw `customer_id` UUIDs per review) |
| `0064` | Added matching `WITH CHECK` to 3 UPDATE policies (`profiles_update_admin`, `shop_settings`/`loyalty_settings`) that only had `USING` |
| `0065` | `get_redemption_expiry()` gains an ownership check, closing an existence-oracle side effect too |
| `0066` | Added `set search_path = public` to the two functions missing it (`adjust_ingredient_stock`, `set_order_paid_at`) |
| `0067` | Row-locks (`FOR UPDATE`) the loyalty-balance read in `redeem_reward`/`place_order` to prevent a concurrent-redemption race driving the balance negative |
| `0068` | `promotions` table + `validate_promo_code()` — real coupon system replacing the hardcoded `WELCOME10` previously duplicated in `hooks/useCart.tsx` and `place_order` |
| `0069` | Revoked the same platform auto-re-grant on `validate_promo_code` (grant-hygiene, not independently exploitable — see the gotcha below) |
| `0070` | `table_sessions`/`table_cart_items` schema (shared table ordering session) — public SELECT, no write RLS (guest-safe RPCs only; see feature entry below) |
| `0071` | Guest-safe cart RPCs (`get_table_session`, `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`) — always server-priced |
| `0072` | `place_order` gains `tableSessionId`; new `place_table_round` RPC places a table's draft cart as a `payAt: 'later'` round and clears it |
| `0073` | `sync_table_occupancy` also closes the table's active `table_sessions` row when its last order completes |
| `0074` | `checkout_table_session`/`confirm_table_cash_payment` — aggregate Check Bill payment across every unpaid order under a table's session, at most one promo code applied to the aggregate total |
| `0075` | Follow-up to `0074` — anon auto-re-grant revoke + missing `is null or` role-check guard on `confirm_table_cash_payment` (see the two gotchas below) |
| `0076` | `place_table_round` gains `for update` on its session lookup, closing a concurrent-double-placement race (two devices tapping "Place Order" at once could both place duplicate rounds) |
| `0077` | Every guest-callable table-session RPC switched from raw `table_id` to `qr_token`; fixed an invalid `FOR UPDATE` over an aggregate in `checkout_table_session` (0074) |
| `0078` | Missing FK indexes on `table_cart_items` (performance) |
| `0079` | **CRITICAL** — `increment_table_scan_count`/`notify_table_cleaning` (`return`ed the whole `tables` row, `qr_code_token` included) let any anon caller recover a table's QR token via `tables.id` despite the column having zero direct SELECT grant (see the "`SECURITY DEFINER` returning a full row" gotcha below) |
| `0080` | `confirm_table_cash_payment` also touches `table_sessions` so a guest's existing Realtime subscription picks up staff cash confirmation (full fix is `hooks/useTableSession.tsx`'s polling fallback, see feature entry below) |
| `0081` | `table_cart_imports` table + RPC to transactionally import a whole local cart into the shared table session in one retry-safe step (re-opening dine-in from the old individual checkout without bypassing the shared-cart model) — the application-layer side of this (`lib/table-cart-transfer.ts`, `TableLanding`'s `?cartTransfer=` handling) was deleted by the 2026-09-19 rebuild (Decision 9); the DB objects stay per the never-drop rule |
| `0082` | `order_items.status` (per-item kitchen status) + `orders.status` becomes a server-side rolled-up derivation of its items' statuses, so one ticket with several drinks can advance drink-by-drink instead of one all-or-nothing order status — every downstream trigger keeps reading `orders.status` unmodified (see the "order-status lifecycle" gotcha above) |
| `0083` | `table_sessions.checkout_attempt_id`/`checkout_started_at` + guest-safe `release_table_checkout` — makes a pre-redirect gateway-checkout failure recoverable without clobbering a newer attempt or an already-cash-selected order (now largely dormant since Stripe/VNPay themselves are deleted, but the columns/RPC stay) |
| `0084` | `shop_settings_update_admin`/`loyalty_settings_update_admin` RLS narrowed from manager\|admin to admin-only (matching the `/admin/settings` route gate) + Postgres range constraints on tax rate/loyalty earning rate/redemption value |
| `0085` | Order/table-cart idempotency: `orders.submission_id` (unique) + the original `place_order` renamed to `place_order_legacy` behind a small idempotent wrapper (new `place_order`); `table_cart_items.version` for optimistic-concurrency cart edits; `table_round_submissions` for dedup |
| `0086` | Missing FK indexes (`order_items.order_id`, `orders.customer_id`, `orders.table_id`) + a partial paid-order date index, from a live performance-advisor pass |
| `0087`–`0089` | `recall_last_completed_order()` — lets staff revert the single most recent completed+paid order back onto the KDS board within a short window, plus an anon auto-re-grant revoke and a follow-up making recall also reset the recalled order's item statuses (unrelated to the 2026-09-19 rebuild) |
| `0090` | `menu_item_categories` join table replaces `menu_items.category_id` (many-to-many categories) |
| `0091` | `confirm_table_payment(table_id, method)` replaces the cash-hardcoded `confirm_table_cash_payment` — confirms a table's unpaid balance as paid via any method, matched on `orders.table_id` directly (not just table-session orders); the 2026-09-19 rebuild's staff Tables page always calls it with `'cash'` |
| `0092` | Revoked the same platform auto-re-grant on `confirm_table_payment` (anon) |
| `0093` | **Minimal ordering rebuild, Task 1 reconciliation** — re-applying `0083`–`0086` (found to have been silently skipped on the live database despite being committed in the repo the whole time) re-triggered the platform auto-re-grant gotcha: revoked excess `anon`/`PUBLIC` grants on `get_dashboard_stats()` (low severity, function's own role check still blocks non-staff) and, more seriously, on `record_table_checkout_session()` — an internal service-role-only persistence hook that a guest could otherwise have used to poison a pending table's stored gateway redirect URL |
| `0094` | **Minimal ordering rebuild, Task 1** — removed the `no_open_shift` guard from `place_order_legacy` (ordering no longer requires an open shift; the entire shift concept is deleted from the UI, see "Shift closing" below) and zeroed `shop_settings.tax_rate` to `0` (menu prices are now treated as already tax-inclusive; no tax UI anywhere) |

The live database is caught up through migration `0094` as of the
2026-09-19 rebuild (it had silently drifted to `0080` applied /
`0086` committed-but-unapplied before that rebuild's Task 1 caught and
fixed it — see `0093`'s note above). `supabase/CLAUDE.md`, if present,
may carry its own copy of a similar table for `supabase/`-only work;
treat this file as authoritative for anything referenced from a
customer/staff/admin feature area.

**Live-grant auto-re-grant gotcha, worth remembering:** a migration's own
`revoke all ... from public; grant execute ... to X;` does NOT reliably
survive Supabase's platform-level auto-grant behavior on `CREATE
FUNCTION` — a distinct, LATER follow-up migration is required every
time. Has bitten this project at least nine times now (`0045`, `0047`,
`0060`, `0061`, `0069`, `0075`, `0088`, `0092`, `0093`). Any new
`SECURITY DEFINER` function should have its
`information_schema.role_routine_grants` checked live immediately after
creation, not assumed correct from the migration text alone.

A real admin account (`admin@phadincoffee.dev`) was bootstrapped via
direct SQL insert into `auth.users` (public signup hits the shared email
rate limit). Two throwaway test accounts (staff/customer roles) also
exist — credentials in `.env.local` and the gitignored `test-accounts.md`.

## Edge Functions (`supabase/functions/`)

**Only `create-staff-account` remains** as of the 2026-09-19 rebuild.
`place-order`, `pay-order`, `stripe-webhook`, `vnpay-ipn`,
`vnpay-return`, and `checkout-table-session` are all deleted (Decision
25) — every remaining write goes either through a direct browser
`supabase.rpc(...)` call (`place_table_round`, `checkout_table_session`
called with `p_method: 'cash'`, `confirm_table_payment`, all
`security definer`) or, for staff-account creation, this one surviving
function. `create-staff-account` uses no SDK for anything — raw
`@supabase/supabase-js` client calls with the service-role key, `verify_jwt`
left on (admin-only, no guest use case, see the Login/Cross-cutting
notes above). No Deno test harness exists in this project — Edge
Functions are verified live (curl smoke tests), not with automated
tests. **Undeploying the 6 deleted functions from the live Supabase
project and removing their now-unused Stripe/VNPay secrets is a manual,
external step (Task 22 of the rebuild plan) — confirm with whoever ran
it (`dothanhlong166@gmail.com`) whether that's actually been done yet;
this repo update only deletes the local source, it can't undeploy a
live function or touch a secrets dashboard.**

## Deployment (Vercel)

Live at **https://phadincafe.vercel.app** (project `phadincafe`,
`gnoltd-s-projects` team, linked to `Gnoltd/CoffeeShop` — push to `main`
auto-deploys, no manual `vercel deploy` needed).

- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `SUPABASE_SECRET_KEY` (**check later, 2026-07-29 review I-4** — not
  referenced by any Next.js code, service-role logic lives only in Edge
  Functions with their own separate secret store; safe to remove from
  Vercel to shrink blast radius, just needs someone with dashboard
  access). `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VNPAY_TMN_CODE`,
  `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` are all **dead as of the
  2026-09-19 rebuild** (no code references any Stripe/VNPay gateway
  anymore) but removing them from Vercel/Supabase is a manual dashboard
  step (Task 22 of the rebuild plan) — check `daily.md` for whether
  that's confirmed done before assuming they're actually gone from
  those dashboards.
- **Supabase Auth's "URL Configuration" (Site URL + Redirect URLs) is
  Dashboard-only**, no MCP tool exposes it. Must include
  `https://phadincafe.vercel.app/**`, the Vercel preview-deployment
  wildcard, and `http://localhost:3000/**`.

## Building the rest

The app is intentionally finished at "minimal" as of the 2026-09-19
rebuild — this is not a partially-built product waiting on more
features, it's a deliberately small one. Every application-code task
in `docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md`
(Tasks 1–25, ending with this docs update, Task 26) is done and each
built/tested locally at the time it landed. **Not yet done as of this
docs update**: Task 27 (a final full local `build`/`lint`/`test` pass
across everything Tasks 1–26 touched) and Task 28 (push to `main`,
confirm the Vercel deploy, and live-verify the guest/staff/admin flows
against `https://phadincafe.vercel.app`) — don't describe this rebuild
as "live-verified" until those actually run; check `daily.md`/git log
for whether they have. Everything the design doc calls a non-goal
(customer accounts, loyalty, rewards, address book, reviews,
promotions, shift reconciliation, POS, the landing page, Stripe/VNPay,
tax, Pickup) is deleted from the application layer — not "not yet
built." The underlying DB tables/columns for all of it still exist,
unused, per the rebuild's own never-drop-data rule, so nothing about
this is irreversible if the owner ever wants a feature back;
reintroducing one means writing new application code against
already-live data, not a fresh migration.

Two other items are worth checking before treating the rebuild as fully
closed out — see `daily.md`:
1. Task 22 (Edge Function undeploy + Stripe/VNPay secret removal from
   Supabase/Vercel dashboards) is a manual, external step this repo
   update can't confirm — check with `dothanhlong166@gmail.com`.
2. `daily.md`'s *own*, separate, earlier Reliability/UX/Performance
   Remediation Plan (predates this rebuild — see the top of `daily.md`)
   has its own still-open Task 8 (production acceptance pass: mobile
   device matrix, axe/keyboard/zoom accessibility pass, etc.). Most of
   that task's checklist items reference since-deleted surfaces
   (Stripe/VNPay/POS/shift matrices) and don't need re-running for
   them, but the still-relevant items (real iOS Safari/Android Chrome
   device checks, the accessibility smoke test) were never completed
   and remain open regardless of this rebuild.

When adding anything new: shared brand tokens,
`useTranslations`/`getTranslations` with both message files updated
together, Base UI's `render` prop for polymorphic Buttons, "disabled +
tooltip" for unbacked actions, DI'd query-layer modules, guest-safe
RPCs for anything a logged-out user needs to touch, and — per this
rebuild's own precedent — never drop a DB table/column just because its
application code went away.

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
