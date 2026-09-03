# AGENTS.md

Structural map of PhaDinCafe. Full rationale/history lives in
`docs/superpowers/specs/` and `docs/superpowers/plans/` — one dated
design+plan pair per feature (e.g. `2026-07-07-vnpay-payment-integration-{design,}.md`).
This file is the current-state summary; check the dated docs for "why" a
decision was made or the full bug-hunt narrative behind a fix.

## Task split for `daily.md`'s remediation plan (2026-09-02)

The user is running a Claude Code session and a Codex session against
this same checkout in parallel, relaying messages between them by
hand — there is no live channel between the two agents, so this note
is the handoff. Coordination happens through git: commit and push
after each task (or clearly-separable sub-step) so the other side can
see progress via `git log`, and pull/rebase before starting a task
whose file list might have moved.

**Codex owns, in this order: Task 1 -> Task 2 -> Task 5** (table
checkout/settings safety, order/cart idempotency, DB hot-path
indexes — the P0 payment/order-correctness and DB track).

**Claude owns, in this order: Task 6 -> Task 4 -> Task 3** (hydration/
accessibility/bilingual UX, provider scoping + Realtime amplification,
async-state/loading-empty-error-stale handling). Task 6 and Task 4 are
done; Task 3 is in progress.

**Task 3 update (2026-09-03): split between Claude and Codex once both
Task 6/4 (Claude) and Task 1/2/5 (Codex) landed**, since Task 3's own
6 items span both customer-facing and staff/admin-facing surfaces with
no natural single owner. Items 1-2 (skeleton/retry, stale-data
retention) are done. The remainder is split in `daily.md` as **3b
(Claude)** — promo Apply try/catch/finally, order/address-book
false-empty states, and table-cart mutation-awaiting, all in files
Claude already has fresh context in from today's Task 3a/Task 4 work
— and **3c (Codex)** — loyalty/dashboard false-empty states,
stock-adjust/dashboard-restock mutation-awaiting, and cash-confirm/
serving/per-item-KDS mutation-awaiting. Same file-collision logic as
the original split: 3b and 3c touch disjoint files, except 3c's KDS
files (`useKitchenOrders.tsx`, `kitchen-board.tsx`) which Claude
edited today for the optimistic-update/race fix (`d7f3b6d`,
`1bcde6d`) — Codex should pull `main` before starting 3c so that work
isn't built against a stale version of those files.

**Task 7 (lint/tests/CI) and Task 8 (acceptance pass) are unclaimed**
— pick up after Tasks 1-6 land, split by area or done jointly.

Why this split and not some other one: nearly every task in the plan
shares files with at least one other task (`checkout-table-session/
index.ts` is in both Task 1 and Task 2; `useTableSession.tsx`,
`useKitchenOrders.tsx`, `useDashboardStats.tsx`, and `order-tracking.tsx`
each appear in 2-3 tasks across 2/3/4). This split was chosen because
Codex's track (1/2/5) and Claude's first task (6) share zero files, so
both can start immediately without collision. Claude's Task 4 and
Task 3 are deliberately queued behind Codex's Task 2, since both edit
the same hook files Task 2 changes (`useTableSession.tsx` particularly)
— starting them before Task 2 lands risks building on a version of
those hooks that's about to change underneath. If Codex's actual
approach ends up touching different files than the plan's stated file
list, or Task 2 is taking a while, say so in a commit message or back
through the user rather than silently reordering — the other side has
no way to detect a silent reorder except by diffing files it didn't
expect touched.

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
**https://phadincafe.vercel.app**, auto-deploys on push to `main`. See
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
in that folder: `components/customer/AGENTS.md` (ordering flow, landing/
auth/profile/loyalty/order history, reviews), `components/staff/AGENTS.md`
(POS, KDS, reward lookup), `components/admin/AGENTS.md` (dashboard, menu,
inventory, tables, staff accounts, settings). Below are only the feature
areas that span multiple directories.

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

### Shared table ordering session (real, shipped 2026-08-28)
- A live, multi-device shared cart per dine-in table — every phone that
  scans a table's QR sees and edits the same draft cart in real time,
  can place it as a round (`payAt: 'later'`, kitchen sees it
  immediately), and keeps a running tab across multiple rounds until
  someone pays.
- `table_sessions`/`table_cart_items` (migration `0070`) get a public
  SELECT RLS policy and **zero write policy** — every write goes
  through guest-safe `security definer` RPCs (`get_table_session`,
  `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`,
  `place_table_round`, `abandon_table_session`, migrations `0071`–`0072`,
  `0077`), all keyed on the table's `qr_token` rather than its raw
  `table_id` — `qr_code_token` has zero SELECT grant to anon/
  authenticated (unlike the openly-enumerable `tables.id`), so a
  qr_token-keyed RPC can't be walked table-to-table the way a
  table_id-keyed one could.
- **Check Bill** (`checkout_table_session`/`confirm_table_cash_payment`,
  migration `0074`) is the aggregate payment step: sets a chosen
  payment method on every currently-unpaid order under the table's
  session, applies at most one promo code against the aggregate total,
  and — for Stripe/VNPay — sets `payment_pending` so a new round can't
  be placed mid-checkout.
- `hooks/useTableSession.tsx` drives the customer-facing session state:
  Realtime on `table_cart_items`/`orders`/`table_sessions` for fast
  updates, plus a 10s polling fallback (migration `0080`'s
  `table_sessions` touch on cash-confirm gives a faster guest signal
  for that one case) covering `orders` status changes Realtime can't
  deliver to a guest at all (`customer_id` is null on a guest round,
  matching neither `orders_select_own` nor `orders_select_staff` — see
  the guest-safe RPC pattern above). KDS's `KitchenTablesColumn` gained
  a "Mark Cash" action (`markTableCashPayment`) so staff can still
  settle a table whose guest never tapped Check Bill.
- Design: `docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md`;
  plan: `docs/superpowers/plans/2026-08-28-shared-table-ordering-session.md`.

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

**Check later:** a separate, not-yet-merged branch
(`docs/superpowers/plans/2026-07-29-architecture-deepening.md`, worked
in a `.worktrees/architecture-deepening` git worktree) wires
`confirm_order_payment()` into `stripe-webhook`/`vnpay-ipn` and deletes
`_shared/order-status.ts`'s `buildPaidUpdate` helper. When that branch
merges, reconcile it against the `stripe-webhook` amount-cross-check
(L-2) and multi-`v1=` signature fix (I-5) shipped in the 2026-07-29
security review's P2 pass (`0063`-`0067`, PR #4) — both touched the same
file independently and haven't been merged against each other yet.
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

Live at **https://phadincafe.vercel.app** (project `phadincafe`,
`gnoltd-s-projects` team, linked to `Gnoltd/CoffeeShop` — push to `main`
auto-deploys, no manual `vercel deploy` needed).

- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `SUPABASE_SECRET_KEY` (**check later, 2026-07-29 review I-4** — not
  referenced by any Next.js code, service-role logic lives only in Edge
  Functions with their own separate secret store; safe to remove from
  Vercel to shrink blast radius, just needs someone with dashboard
  access), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VNPAY_TMN_CODE`,
  `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` (dead —
  VNPay's real return URL is built dynamically pointing at the Supabase
  function URL, not this var). The Stripe/VNPay secrets are *also*
  separately required as **Supabase Edge Function secrets** — see
  Cross-cutting conventions above; Vercel and Supabase are two
  different secret stores.
- **Supabase Auth's "URL Configuration" (Site URL + Redirect URLs) is
  Dashboard-only**, no MCP tool exposes it. Must include
  `https://phadincafe.vercel.app/**`, the Vercel preview-deployment
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
