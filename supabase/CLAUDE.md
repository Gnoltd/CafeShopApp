Database and Edge Function detail. Migrated out of the root `CLAUDE.md`
(2026-07-13) so it only loads when working under `supabase/` — see the
root file for cross-cutting conventions and the feature areas that span
multiple directories (payments, table status, deferred-payment
lifecycle, shift closing all touch this directory too, but stay
documented in the root file since they aren't `supabase/`-only).

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
| `0024` | fixed `sync_table_occupancy`'s trigger column-scope gap (see gotcha in root `CLAUDE.md`) |
| `0025` | `tables_update_staff` RLS policy (staff-role gap, see gotcha in root `CLAUDE.md`) |
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
| `0069` | Revoked the same platform auto-re-grant on `validate_promo_code` (grant-hygiene, not independently exploitable — see the auto-re-grant gotcha below) |
| `0070` | `table_sessions`/`table_cart_items` schema (shared table ordering session) — public SELECT, no write RLS (guest-safe RPCs only; see root `CLAUDE.md`'s feature entry) |
| `0071` | Guest-safe cart RPCs (`get_table_session`, `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`) — always server-priced |
| `0072` | `place_order` gains `tableSessionId`; new `place_table_round` RPC places a table's draft cart as a `payAt: 'later'` round and clears it |
| `0073` | `sync_table_occupancy` also closes the table's active `table_sessions` row when its last order completes |
| `0074` | `checkout_table_session`/`confirm_table_cash_payment` — aggregate Check Bill payment across every unpaid order under a table's session, at most one promo code applied to the aggregate total |
| `0075` | Follow-up to `0074` — anon auto-re-grant revoke + missing `is null or` role-check guard on `confirm_table_cash_payment` |
| `0076` | `place_table_round` gains `for update` on its session lookup, closing a concurrent-double-placement race |
| `0077` | Every guest-callable table-session RPC switched from raw `table_id` to `qr_token`; fixed an invalid `FOR UPDATE` over an aggregate in `checkout_table_session` (0074) |
| `0078` | Missing FK indexes on `table_cart_items` (performance) |
| `0079` | **CRITICAL** — `increment_table_scan_count`/`notify_table_cleaning` (`return`ed the whole `tables` row, `qr_code_token` included) let any anon caller recover a table's QR token via `tables.id` despite the column having zero direct SELECT grant (see root `CLAUDE.md`'s "`SECURITY DEFINER` returning a full row" gotcha) |
| `0080` | `confirm_table_cash_payment` also touches `table_sessions` so a guest's existing Realtime subscription picks up staff cash confirmation |

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

## Storage buckets

One bucket per distinct upload purpose — never share a bucket across
unrelated content types. Each bucket answers three questions
independently: who can write (RLS on `storage.objects`, same
`current_user_role()` pattern used everywhere else), is it public or
private, and what's actually allowed in it.

- **Every bucket must set `allowed_mime_types`/`file_size_limit` at
  creation** (`storage.buckets` columns, plain `UPDATE`/`INSERT` via
  migration — no dashboard-only step needed). A client-side `accept=`
  attribute or a JS size check (e.g. `menu-item-form.tsx`'s
  `selectFile()`) is UX only — it stops nothing from a direct API call.
  Found and fixed live 2026-07-21 (migration `0050`): `menu-item-images`
  had zero server-side enforcement despite the client claiming
  `image/*` + 5MB, meaning any manager/admin session (the only
  write-capable role) could've uploaded arbitrary content — including
  an HTML/SVG file with embedded script — to a public-read bucket.
- **Public vs private is a one-way content-sensitivity decision, not a
  convenience toggle.** Public (`storage.objects` SELECT policy
  `using (true)`) only for content that's *meant* to be openly served
  with no auth check at all — menu photos, category icons, anything
  already shown on the guest-browsable `/menu`. Anything with real
  sensitivity (a hypothetical customer-uploaded document, a staff file)
  must be a private bucket, a narrow RLS SELECT policy (owner-scoped,
  same shape as `profiles_select_own`), and `createSignedUrl()` for
  time-limited access — never public just to avoid writing that policy.
- **Object key convention**: `${crypto.randomUUID()}-{original filename}`
  (current pattern in `menu-item-form.tsx`) is sufficient — Supabase
  itself restricts stored filenames to a safe character set project-wide,
  so no extra path-traversal sanitization is needed on top of this.

| Bucket | Public | Write role | Allowed MIME types | Size limit |
|---|---|---|---|---|
| `menu-item-images` | yes | manager/admin | `image/jpeg`, `image/png`, `image/webp`, `image/gif` | 5 MB |

When a future feature needs a new upload type (video, a customer-facing
upload, a staff document), start a new bucket with this same
three-question process — don't add it to an existing bucket, and don't
skip the MIME/size restriction "for now."

## Edge Functions (`supabase/functions/`)

All real: `place-order` (routes to Stripe/VNPay/cash based on payload),
`stripe-webhook`, `vnpay-ipn`, `vnpay-return`, `create-staff-account`.
None use an SDK for their respective gateway — raw `fetch`/Web Crypto
throughout, matching this project's dependency-free convention. No Deno
test harness exists in this project — Edge Functions are verified live
(curl smoke tests + real sandbox transactions), not with automated tests.
