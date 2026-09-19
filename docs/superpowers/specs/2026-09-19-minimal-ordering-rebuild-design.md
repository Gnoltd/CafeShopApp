# Minimal Ordering Rebuild — Design

## Problem

PhaDinCafe has grown into a full-featured cafe platform — customer
accounts, loyalty/rewards, address book, shift cash-reconciliation, a
landing page, three payment gateways, POS, per-order deferred payment,
table 3-state occupancy — but the owner only wants the actual daily
operation: a guest scans a table's QR code, orders from the menu, and
staff/manager run the kitchen and settle the bill in cash. Everything
else is overhead to build, explain, and maintain for a shop this size.
This spec (reached via a `grilling` session, 2026-09-19) cuts the app
down to that operation and nothing else.

## Goals — what the rebuilt app is

1. **Guest (no account, ever)**: scans a table's QR → one page (menu +
   shared table cart + placed rounds, live-synced across every device at
   that table) → orders in rounds → taps "Yêu cầu tính tiền" to flag the
   table for staff → staff settles in cash. A separate `/menu` page is
   viewable without a QR scan (read-only — no add-to-cart until a table
   is active).
2. **Staff/Manager/Admin**: still log in (email/password, Supabase Auth).
   One "vận hành" (operations) area with two pages — **KDS** (ticket
   board) and **Tables** (table list, open sessions, create table/QR,
   confirm cash) — switchable via tabs/nav, not crammed into one screen.
3. **Admin**: `/admin/menu` (items/prices/images/availability) and
   `/admin/staff` (create staff accounts) only, plus a trimmed
   `/admin/settings` (shop name/phone/address — no tax, no loyalty, no
   landing-hero).
4. **Language switcher**: unchanged, untouched.

## Non-goals / explicitly removed

Customer accounts, login/signup/Google sign-in/forgot-password, Profile
+ Profile Settings, Address Book, Loyalty (tier/points), Rewards
catalog/redemption + staff redemption lookup, Reviews, Promotions/promo
codes, individual (non-table) cart + checkout, Pickup order type, Pay
Now/Pay Later choice, Stripe, VNPay, Admin Dashboard (KPI page), Admin
Inventory, Shift Closing (cash reconciliation UI/report — but see
Decision 8 below, the underlying `shifts`-open **gate** is a separate
thing that also has to go), Food Cost calculator, POS, Order Tracking as
a separate route, the landing/marketing page, table 3-state
occupancy/cleaning UI, tax calculation.

**Explicit non-goal for this pass**: dropping DB tables/columns for the
removed features. They stay in the schema, unused, so existing
production data (loyalty balances, past orders, reviews, etc.) is never
destroyed and the change stays reversible. The **one exception** is
Decision 8 (the shift-open gate), which is not just "unused" — it
actively blocks ordering and must be defused.

## Decisions (numbered, from the grilling transcript)

1. Hard-delete application code/routes for removed features; never drop
   DB tables/columns in this pass.
2. `/admin/*` keeps only `menu` and `staff`; drops `dashboard`,
   `inventory`, `shift`, `food-cost`, `promotions`, `tables` (table
   management moves into the staff Tables page, Decision 11/17).
3. Staff/manager/admin login stays (Supabase Auth, email/password).
   Customer accounts are gone entirely — every customer-facing page is
   guest/anonymous.
4. Checkout is folded into the table cart flow (see Decision 9) — there
   is no separate `/checkout`.
5. Payment methods: **Cash only**. Stripe and VNPay, and every piece of
   infra built for them, are removed.
6. Order type: **Dine-in only**, always tied to a scanned table. Pickup
   is removed.
7. Guest order status is shown inline on the table page (live rounds +
   per-item status) — no separate `/orders/[orderId]` tracking route.
8. Removed entirely: Loyalty, Rewards + staff redemption lookup, Address
   Book, Shift Closing UI, Reviews, Profile/Profile Settings,
   Promotions/promo codes. **Follow-up finding (not in the original
   grilling round, surfaced during codebase research):** `place_order`
   (the function every round placement ultimately calls) refuses to run
   at all unless a row in `shifts` has `closed_at is null` — i.e.
   ordering is currently gated on a shift being "open". Deleting the
   Shift Closing UI with nothing else would deadlock the entire app (no
   one could ever open a shift again, so no one could ever order again).
   Decision: **remove this gate outright** — no shift concept survives
   anywhere, not even a minimal open/close toggle.
9. Shared Table Ordering Session (multi-device live cart per table,
   shipped 2026-08-28) is the **one and only** ordering path. The
   pre-existing individual `/cart` → `/checkout` flow is deleted
   entirely, along with the cart-transfer bridge that let a personal
   cart hand off into a table session (dead once `/cart` is gone).
10. Payment/Check Bill has **no customer-facing payment UI at all** — no
    method picker, no promo code field. The customer's only action is a
    "Yêu cầu tính tiền" (request the bill) button; staff collects cash in
    person and taps "Đã thu tiền" on the Tables page to close it out.
11. KDS and Tables are two separate pages in one staff/manager/admin
    "operations" area (tab/nav switch between them) — not merged into a
    single screen, and not scattered as disconnected "KDS" vs "admin
    dashboard" concepts the way the old structure had them.
12. Table state simplifies from the 3-state enum
    (available/occupied/cleaning) to a binary concept in the UI: does
    this table have an open session or not. The DB enum/trigger stays
    (Decision 1) but nothing in the rebuilt UI reads or displays
    `cleaning`/`occupied` as distinct states anymore.
13. Table creation + QR code viewing/printing lives inside the staff
    Tables page (absorbing the old `/admin/tables` CRUD) rather than a
    separate admin route.
14. Check Bill applies no promo code (Promotions is removed — Decision
    8) — it is purely "sum of unpaid rounds, confirm cash".
15. POS (`/staff/pos`) is removed — every order goes through a customer
    scanning a QR; staff never places an order on a guest's behalf
    through a separate terminal.
16. Nothing customer-facing ever asks the customer to choose a payment
    method or method-adjacent detail — see Decision 10.
17. See Decision 2/13 — Admin Tables management is absorbed into the
    staff Tables page, not kept as its own admin route.
18. Size/extras picker stays for customers adding items to the shared
    table cart. The admin Sizes editor (`/admin/menu`) stays.
19. No self-service "forgot password" flow for anyone. A staff member
    who forgets their password gets it reset manually via the Supabase
    Dashboard.
20. No separate `/orders/[orderId]` guest tracking route — folded into
    the table page (Decision 7).
21. Root `/` (no QR scanned) shows a minimal "Scan the QR code at your
    table to order" screen with a small "Staff sign in" link — no
    landing/marketing content.
22. `/menu` stays as a public, read-only page (no QR needed) — "Add to
    cart" is disabled with a tooltip ("Scan the table's QR to order")
    when there's no active table session. `/menu/[itemId]` similarly
    becomes a read-only detail view (reviews removed along with it).
23. Staff/Manager/Admin stay as three distinct roles in the DB/RLS
    (`profiles.role`, `current_user_role()`) even though staff and
    manager currently end up with identical access (both reach
    KDS+Tables; menu editing stays manager/admin-only, unchanged) —
    changing the role schema is a much bigger, riskier change than the
    value it would add here.
24. No tax calculation anywhere — menu prices already include tax.
    `/admin/settings` drops the tax-rate field entirely, and the
    production `shop_settings.tax_rate` value gets zeroed out via
    migration so the existing pricing function (which still multiplies
    by it) produces `tax_amount = 0` without needing its body rewritten.
25. `place_order`/`place-order`/`pay-order`/`stripe-webhook`/
    `vnpay-ipn`/`vnpay-return` Edge Functions and RPC paths tied
    exclusively to the old non-table ordering flow and payment gateways
    are deleted, along with their Vercel/Supabase secrets (manual
    dashboard steps — no MCP tool manages secrets).

## Current-state facts this design relies on (verified against the live
repo on 2026-09-19, migrations through `0092`, since `CLAUDE.md` itself
was stale at `0080`)

- `place_table_round` → `place_table_round_legacy` → `place_order`
  (idempotent wrapper) → `place_order_legacy`, whose body opens with the
  `no_open_shift` guard (Decision 8).
- `checkout_table_session(p_qr_token, p_method, p_promo_code default
  null)` already handles `method = 'cash'` as a same-request no-gateway
  path (no Stripe/VNPay session created) — it does not need a new RPC,
  just a caller that always passes `'cash'` and `null` promo, called
  directly from the browser instead of through the
  `checkout-table-session` Edge Function (which becomes deletable).
- `confirm_table_payment(p_table_id, p_method)` (migration `0091`,
  replacing the old `confirm_table_cash_payment`) already accepts any
  method generically — the staff Tables page just always calls it with
  `'cash'`.
- `tables.status` stays a 3-state enum at the DB/trigger level; only the
  UI stops treating it as 3 meaningfully-different states.
- `MenuBrowser` and `QuickAddPopup` currently call `useCart()` directly
  (not just importing its types) as a fallback when no `onAddItem` prop
  is passed — this must be untangled *before* `useCart.tsx` can be
  deleted, or the standalone `/menu` page (which needs `MenuBrowser` with
  no personal cart at all) breaks.
- `TableLanding` currently carries a personal-cart→table-session transfer
  bridge (`?cartTransfer=` query param, `lib/table-cart-transfer.ts`,
  `useCart().consumeTransfer`) that only exists to bridge the
  soon-to-be-deleted `/checkout` flow into a table session, and a
  `status === 'cleaning'` full-screen block — both dead weight once
  Decisions 9 and 12 land.
- The staff area currently mounts a `ShiftProvider`/`useShift()` (join/
  leave shift, shown in `KitchenTopBar`) purely to reflect the same
  shift-open concept Decision 8 removes at the DB level — it goes too,
  it would otherwise show a meaningless "shift" toggle with no backing
  gate.

## Plan

See `docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md`.
