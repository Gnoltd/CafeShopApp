# Open / not started

0. **`https://phadincafe.vercel.app` currently requires Vercel SSO login
   for every visitor** (Deployment Protection on the Production
   environment), confirmed 2026-08-03 on both a fresh deploy and a
   13-hour-old one — pre-existing, not caused by any recent change.
   Blocks every live-verification item in this file until turned off
   in the Vercel project's Settings → Deployment Protection. Check this
   first before attempting any "live-verify on Vercel" task below.

1. **Shared table ordering session — code complete, security-hardened,
   double-reviewed (per-task + final whole-branch), live-verification
   blocked by item 0.** Design: `docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md`;
   plan: `docs/superpowers/plans/2026-08-28-shared-table-ordering-session.md`;
   full history/rulings: `.superpowers/sdd/2026-08-28-shared-table-ordering-session/progress.md`.
   Live shared cart per dine-in table (scan QR → menu + live cart synced
   across every device at that table), a persistent running tab across
   however many rounds a table orders, and one aggregate "Check Bill"
   payment (Cash/Stripe/VNPay) settling every unpaid round at once. `/cart`/
   `/checkout` are now pickup-only — dine-in only happens through
   `/table/[qrToken]`. New `table_sessions`/`table_cart_items` schema, ~9
   new/changed RPCs (all guest-facing ones keyed on the table's `qr_token`,
   not the enumerable raw `table_id`), 3 modified live
   payment Edge Functions plus 1 new one, `useTableSession` hook with
   Realtime + a 10s poll fallback + an idle-timeout auto-abandon, and a
   staff-side aggregate "Confirm Cash"/"Mark Cash" KDS action.
   **Found and fixed mid-build** (a prior session hit its usage limit
   partway through and had identified but not yet applied these): an
   invalid `FOR UPDATE`-over-an-aggregate in `checkout_table_session`
   that would have errored on every real checkout, and the qr_token
   security retrofit across all 7 guest RPCs. **Found and fixed via the
   final whole-branch review**: a CRITICAL pre-existing leak (migrations
   0012/0021, made load-bearing by this feature) where
   `increment_table_scan_count`/`notify_table_cleaning` returned a
   table's whole row — `qr_code_token` included — to any anon caller
   keyed on the enumerable `table_id`, completely defeating the qr_token
   fix; closed via migration `0079`. Six further Important findings (live
   guest updates, the idle-timer regression it turned out to have,
   staff cash-settlement for a never-picked payment method, a dead Check
   Bill promo input, two small error-handling gaps, stale generated
   types/docs) were fixed in one consolidated pass and independently
   re-reviewed — including one regression the idle-timer fix itself
   introduced (now also fixed). **Still needed**: Task 23's Steps 1-8
   (two-device live sync, idle-clear, running tab, Check Bill against
   real Cash/Stripe/VNPay, promo-at-checkout regression, pickup
   regression) — every one needs the live Vercel URL, blocked by item 0.
   Everything below the browser layer (every migration/RPC/Edge Function)
   was individually exercised live via direct SQL execution and
   Edge-Function deploy-then-fetch-back verification, not just code
   review.

2. **Promotions — real manager-managed discount codes, replacing the
   hardcoded `WELCOME10`. Code shipped and DB-verified, live UI
   verification blocked by item 0 above, not yet performed.**
   Design: `docs/superpowers/specs/2026-08-03-promotions-design.md`;
   plan: `docs/superpowers/plans/2026-08-03-promotions.md`. New
   `promotions` table (percent/fixed discount, active toggle,
   `starts_at`/`ends_at`, `max_redemptions`, `min_subtotal_vnd`,
   `times_used`) + `orders.promo_code` (migration `0068`, plus `0069`
   fixing the platform's auto-re-grant of `validate_promo_code` to
   `PUBLIC` — this project's documented gotcha, caught live). New
   guest-safe `validate_promo_code` RPC for instant Cart feedback;
   `place_order` now looks up the real row (`FOR UPDATE`, race-safe)
   instead of string-matching `WELCOME10`, raising a specific exception
   per failure reason and incrementing `times_used` on success. New
   `/admin/promotions` page (manager+admin, list + add/edit modal,
   modeled on Menu Management) to create/edit/deactivate codes. Cart's
   promo apply is now a real server round trip with a loading state and
   a reason-specific error message (not found / inactive / not started
   / expired / limit reached / below minimum) instead of one generic
   "invalid code" string. `resolvePromoDiscount` (`lib/order-total.ts`)
   and the new `lib/supabase/promotions-data.ts` query layer are
   TDD'd; `validate_promo_code` was verified live via direct SQL
   (success and not-found cases). **Still needed**: the full live UI
   pass from the plan's Task 8 (create a code, apply/fail in Cart with
   each reason, place a real order, confirm `times_used` increments,
   confirm `max_redemptions` actually blocks a second use) — blocked
   by item 0.

3. **"Neubrutalist Modern" full-app redesign — all 4 phases shipped to
   `main`, live verification is the one remaining step.**
   Design spec: `docs/superpowers/specs/2026-07-12-elevated-warm-redesign-design.md`
   (title says "Elevated Warm" but the actual locked style is
   Neubrutalist Modern — thick ink-colored borders, flat hard-offset
   shadows that collapse on press, first-ever dark mode; see the spec's
   revision note). Validated via 8 full interactive HTML mockups
   (Artifacts, ephemeral to that conversation, not in the repo) with
   live pixel-level iteration, not static wireframes, before any real
   code was touched.
   - **Phase 1** (plan: `...phase1-foundation-landing-menu.md`, pushed `934e72c`):
     design tokens, working dark mode (`hooks/useTheme.tsx`,
     `ThemeToggle`, no-flash init script), additive `neubrutal` variant
     on shared `Button`/`Badge`, Landing + Menu.
   - **Phase 2** (plan: `...phase2-cart-orders-profile-loyalty.md`, pushed `099133b`):
     Cart, Checkout, Order Tracking, Order History, Profile, Loyalty.
     Fixed `components/motion/step-progress.tsx` so a completed step
     shows a green checkmark instead of its own icon re-colored.
   - **Phase 3** (plan: `...phase3-pos-kds.md`, pushed `b9af9aa`):
     `StaffNav`, POS, all five KDS components, at the denser
     `nb-border-sm`/`nb-shadow-sm` Staff/Admin scale.
   - **Phase 4** (plan: `...phase4-admin.md`, pushed `7090e90`): Admin
     sidebar/mobile drawer + all 8 views (Dashboard, Menu Mgmt,
     Inventory, Tables, Food Cost, Shift, Staff, Settings).
   `tsc --noEmit` and the full test suite (140 tests) passed after every
   task across all four phases — no regressions to the underlying
   business logic anywhere.
   **Three assumptions from the design spec turned out wrong once
   grounded against the real code** (worth remembering as a pattern —
   mockup-review findings don't always carry over to the real
   codebase): the Cart+Checkout/Tracking+History/Profile+Loyalty
   tab-switcher pairing was a mockup-review convenience only, not a
   real navigation change (all six stayed separate routes); the
   "POS/KDS/Admin app-switcher" was already shipped as
   `components/staff/staff-nav.tsx`, not new UI; and Shift's Cash/Card/
   VNPay breakdown already existed in `shift-report-detail.tsx`, not
   outstanding work. All three were corrected in the relevant phase's
   plan doc rather than built again from scratch.
   **Post-phase-4 consistency sweep** (pushed `2753459`, 2026-07-12):
   the 4 phases covered every *page*, but a follow-up audit
   ("Browse Menu" in Cart, "Go to Admin Dashboard" in Profile still
   plain-styled) found ~30 more files the phase plans hadn't listed —
   mostly modals/forms/panels reached from an already-migrated page
   (address book, profile settings, my redemptions, rewards catalog
   modal, review form, reset password, every admin add/edit modal,
   staff order history, reward lookup) plus shared chrome (role badge,
   language switcher, theme toggle). All re-skinned to match. Also
   found and fixed a real latent bug while doing this: the shared
   `Input` primitive (`components/ui/input.tsx`) still shipped
   Tailwind's own `border border-input` utility classes, which — same
   as the ROLE_STYLES bug from Phase 4 — always beat the custom
   `.nb-border-sm` component-layer class per Tailwind's layer cascade
   (utilities > components). Any `<Input>` a phase had given an
   `nb-border*` className (e.g. Cart's promo code field) was silently
   still rendering with a thin default border, never the intended thick
   ink one. Fixed at the primitive so every current and future `<Input>`
   is correct with no per-callsite override needed; the same fix was
   applied to `SegmentedControl`, `AnimatedTabBar`, `SideDrawer`, and
   `BottomSheet`.
   **The one remaining step**: live-verify the whole redesign on
   **https://phadincafe.vercel.app** — colors, dark mode toggle/
   persistence, both locales, real mobile devices (iOS Safari + Android
   Chrome, not just a resized desktop browser) — across all pages in
   one pass now that everything (including this sweep) is shipped, per
   the spec's own verification plan. Deliberately deferred by explicit
   user request; do it as a single pass, not phase-by-phase.

4. **Live-verify the Admin Dashboard by hand** — KPIs are real
   (`get_dashboard_stats()`, migration `0026`), but a full manual
   walkthrough hasn't been confirmed: real KPI numbers (cross-check
   Orders Today against Staff Order History), the 7-day chart's
   bars/weekday labels, Best Sellers reflecting real orders, a
   Realtime update after placing a new paid order, and the Excel
   export (all 5 sheets, correct Vietnamese text, real numeric cells
   for revenue/quantity columns — not text). Two automated attempts at
   this check (cloud routine, 2026-07-10/11) both stalled without
   landing a result — try a manual pass instead of another automated
   retry.
5. **Shift closing feature — live verification not confirmed done.**
   Code for Tasks 1-4 is committed and pushed (`shifts` table +
   `orders.paid_at` + RPCs, query layer, i18n, `/admin/shift` page +
   nav entries), but Task 5 (live-verify the open/report/close flow +
   this file's entry) has no recorded evidence of having run. Same two
   stalled automated attempts as item 3 above. Plan:
   `docs/superpowers/plans/2026-07-10-shift-closing.md`.
6. **Set the real tax rate.** Admin Settings now genuinely persists
   (migration `0042`, 2026-07-11) and POS/checkout both apply
   `shop_settings.tax_rate` for real — but it's deliberately left at
   `0` since no real rate was ever specified (previously a hardcoded,
   never-actually-charged `8%` in POS only). Set the real rate via
   `/admin/settings` whenever convenient — also a good moment to fill
   in shop name/address/phone/hours, which were never persisted either.
7. **Forgot password — real-email round trip unconfirmed.** Shipped and
   live-verified end-to-end except for the actual emailed link: request
   flow (email entry → "check your email" screen, works regardless of
   whether the address is registered), navigation between views, and
   `/reset-password`'s expired-link handling with no valid session all
   confirmed live. Clicking a real reset email, setting a new password,
   and confirming login with it afterward hasn't been confirmed — same
   documented shared-email-sender rate-limit risk as signup confirmation
   and Google-linking. Plan: `docs/superpowers/plans/2026-07-11-forgot-password.md`.
8. **Per-item KDS ticking — code complete and test-verified, only live
   browser verification (Task 5) remains.** Prompted by a user
   question: today `order_items` has no `status` column at all, so one
   order (e.g. a table round with several drinks) can only ever advance
   as a whole block on the KDS board — there's no way to tick one drink
   done while others in the same round stay pending. Design:
   `docs/superpowers/specs/2026-09-02-per-item-kitchen-status-design.md`;
   plan: `docs/superpowers/plans/2026-09-02-per-item-kitchen-status.md`.
   New `order_items.status` enum (`preparing/ready/served`, migration
   `0082`) with a roll-up trigger (`sync_order_status_from_items`) that
   derives `orders.status` from its items — every existing completion/
   table-cleaning trigger needed zero changes. Staff-only RLS policy
   column-scoped to `status` (revoked the blanket `anon`/`authenticated`
   UPDATE grant first, per this project's migration-0047 pattern).
   `order_items` added to the `supabase_realtime` publication so a tick
   that doesn't flip the parent order's own status still reaches other
   devices. KDS UI (`kitchen-board.tsx`) now shows a per-item tick
   control on every line item instead of one button per order; the
   table's bulk "Mark Served" (`kitchen-tables-column.tsx`, unchanged)
   now bulk-updates items instead of orders via a new
   `markOrderItemsServed` query function. Applies uniformly to
   dine-in/pickup/POS. Migration applied live via Supabase MCP and
   behaviorally verified against real order data inside a rolled-back
   transaction (partial-progress → `preparing`, full-served → `served`,
   both confirmed). Full test suite (226/226) and `npx tsc --noEmit`
   both verified clean after Node.js was installed mid-session (nvm,
   v24.20.0) — the plan's Tasks 1-4 are all checked off. **Still
   needed**: Task 5's live browser pass (partial item progress visible
   cross-device, column auto-advance, table bulk "Mark Served", pickup
   parity) — no working browser automation this session (Playwright MCP
   failed to connect). Also note item 0 above: the whole Vercel
   deployment may still be behind SSO, which would block this entirely
   until that's resolved.

## Known gaps (documented, not hidden — pick up whenever that area is next touched)

- `VNPAY_RETURN_URL` (synced to Vercel) is dead — VNPay's actual return
  URL is built dynamically in `place-order` pointing at the Supabase
  function URL instead. Worth removing the unused Vercel var, or
  documenting why it's kept, next time env vars are audited.
- `next build` still prints the "middleware deprecated, use proxy"
  warning (Next.js 16.2.10). Renaming `middleware.ts` → `proxy.ts` also
  touches `lib/middleware-rules.ts`, which it depends on. Not urgent.
- No Vitest/RTL coverage beyond the `lib/supabase/*.ts` query layers and
  `lib/middleware-rules.ts`/`lib/get-current-role.ts` — component-level
  tests were never added (skipped so far, not a regression).
- POS (`components/staff/pos-terminal.tsx`) always collects payment in
  person (`paymentCollected: true`) — Pay Later is a self-checkout-only
  concept, deliberately (POS staff are standing right there).
- A **pickup** Pay Later order sitting at `served`/unpaid has no
  staff-side "Mark Cash"/"Undo" surface (unlike dine-in's table card in
  KDS) — only the customer's own tracking page can choose/change a
  method for it. Pickup has no table to attach that control to.
- **Shared table ordering session, parked from the final review** (see
  `.superpowers/sdd/2026-08-28-shared-table-ordering-session/progress.md`
  for full detail): (1) `markTableCashPayment` is table-scoped while
  `confirm_table_cash_payment` is session-scoped — a legacy order with
  `table_session_id is null` could silently no-op Confirm Cash with zero
  feedback; not reachable from any current code path (checkout is
  pickup-only, POS always pays in person), data-migration risk only.
  (2) The KDS table card's `awaitingPaymentOrders[0]?.paymentMethod`
  heuristic could theoretically hide both the Mark Cash and Confirm Cash
  buttons under a mixed-payment-method scenario across one table's
  rounds — same unreachable-today legacy-data precondition as (1).
  (3) `useTableSession`'s Realtime-triggered refetch failures are
  silently swallowed with no error-state signal to the guest (the 10s
  poll self-heals transient failures, so this is a display gap, not a
  functional one). (4) `kitchen-tables-column.tsx` has a few pre-existing
  unused destructured bindings from the KDS table-card rework
  (`confirmCashPayment`/`markCashPayment`/`undoCashPayment`/
  `awaitingPaymentTotal`) — harmless (warn-only lint), not build-blocking.
  (5) The regenerated `types/database.types.ts` correctly reflects
  `increment_table_scan_count`/`notify_table_cleaning`'s new
  set-returning shape, but nothing in `lib/supabase/` actually
  parameterizes `createClient` with `Database` anywhere in this project
  — the generated types are documentation-only today, a pre-existing gap
  this just made newly visible.

Two throwaway test accounts (staff/customer roles, credentials in
`.env.local` and the gitignored `test-accounts.md`) are kept
deliberately for the user's ongoing manual testing — not a cleanup gap,
don't remove or flag these.
