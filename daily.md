# Reliability, UX, and Performance Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the failure modes, latency, stale-state behavior, and accessibility gaps most likely to lose orders, delay staff, or make customers distrust the app.

**Architecture:** Fix transactional/payment correctness first, then establish one reusable async-state and latest-request pattern for client data. Scope providers and subscriptions to the routes that consume them, keep RLS as the authorization boundary, and finish with an accessibility/i18n pass plus real deployed-device verification.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, Tailwind v4, Base UI, Supabase Postgres/Auth/Realtime/Edge Functions, Vitest.

**Spec:** Current-state rules in `AGENTS.md`; audit performed 2026-09-02 against source, production, tests, TypeScript, lint, and build output. This file is the user-requested plan and replaces the old recap-heavy backlog.

## Global constraints

- Keep `/vi` and `/en` behavior identical; every new message/accessible label goes into both catalogs.
- Keep all money calculations server-authoritative and all guest operations behind narrow QR-token/order-id RPCs.
- Preserve the unfiltered Realtime subscription convention; filter received payloads client-side and refetch safely.
- Do not cache personalized data. Public menu caching may remain at its current 20-second TTL.
- Verify completion on `https://phadincafe.vercel.app`, not only locally.
- Every mutation must have pending, success, and failure behavior; never close a form or clear state before the write succeeds.

## Audit baseline (2026-09-02)

- `npm test -- --reporter=dot`: **233/233 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `npm run lint`: **failed — 23 errors, 11 warnings**.
- Production public-route timing, three warm/cold samples: `/en` TTFB **0.90–2.04s**, `/en/menu` **0.44–0.47s**, `/en/cart` **0.44–0.45s**, `/en/login` **0.42–0.45s**.
- Production emitted React hydration error **#418** on the landing, Menu, Cart, and Login routes.
- Mobile checks at 390×844 found no horizontal overflow on Menu, Cart, or Login. The visual hierarchy is strong and the primary CTAs are clear.
- Production Menu contains an active item named **“test”** with description **“non”**; hide it immediately through Admin Menu until real content exists.
- Previous backlog item claiming static `three`/`xlsx` imports is stale: both are already dynamically imported. The remaining 1.8MB GLB is a measurement item, not a confirmed code-splitting bug.

---

### Task 1: Make table checkout and settings safe (P0)

**Files:**
- Modify: `supabase/config.toml`
- Create: `supabase/migrations/0083_table_checkout_recovery.sql`
- Create: `supabase/migrations/0084_settings_authorization_constraints.sql`
- Modify: `supabase/functions/checkout-table-session/index.ts`
- Modify: `lib/supabase/settings-data.ts`
- Modify: `components/admin/settings-view.tsx`
- Test: `lib/supabase/settings-data.test.ts`

**Interfaces:**
- `checkout_table_session(...)` returns an attempt identifier for gateway checkouts.
- New guest-safe `release_table_checkout(p_qr_token text, p_attempt_id uuid)` only clears the matching unfinished attempt.
- Settings accept tax in the business-approved range `0..100`, earning rate `> 0`, and redemption value `>= 0`; Postgres enforces the same checks.

- [ ] Add `[functions.checkout-table-session] verify_jwt = false`; deploy with that checked-in posture and confirm an anonymous request reaches the handler rather than JWT rejection.
- [x] Persist `checkout_attempt_id` and `checkout_started_at` when locking a table session. Call `release_table_checkout` on every pre-redirect Stripe/VNPay failure; never let an old attempt clear a newer attempt or clear a successful attempt.
- [x] Narrow `shop_settings_update_admin` and `loyalty_settings_update_admin` RLS from `manager|admin` to `admin` in both `USING` and `WITH CHECK`, matching route/product rules.
- [x] Add idempotent Postgres constraints for tax and loyalty ranges, then mirror them in the Settings form with translated field-level errors.
- [x] Test missing gateway secrets, Stripe/VNPay timeout/error, mismatched attempt release, manager update denial, admin success, and invalid numeric values.
- [ ] Verify live with a guest table session and manager/admin accounts; run Supabase security advisors afterward.

### Task 2: Eliminate duplicate/lost order and shared-cart actions (P0)

**Files:**
- Create: `supabase/migrations/0085_order_idempotency_and_table_cart_concurrency.sql`
- Modify: `supabase/functions/place-order/index.ts`
- Modify: `supabase/functions/pay-order/index.ts`
- Modify: `supabase/functions/checkout-table-session/index.ts`
- Modify: `supabase/functions/_shared/stripe.ts`
- Modify: `components/customer/checkout-view.tsx`
- Modify: `components/customer/order-tracking.tsx`
- Modify: `components/customer/check-bill-sheet.tsx`
- Modify: `hooks/useCart.tsx`
- Modify: `hooks/useTableSession.tsx`
- Modify: `lib/supabase/table-session-data.ts`
- Modify: `lib/supabase/order-mapping.ts`
- Modify: `lib/supabase/orders-data.ts`
- Modify: `components/customer/order-history.tsx`
- Test: corresponding `*.test.ts` files plus concurrent live RPC checks.

**Interfaces:**
- Order creation accepts a client-generated `submissionId` and returns the existing order/session on an exact retry.
- Stripe receives a stable `Idempotency-Key` derived from the stored submission/attempt id.
- Shared-cart quantity changes use an atomic delta or optimistic version, not an absolute last-writer-wins value.

- [x] Generate and retain one submission id per checkout attempt; add a unique stored submission id and make `place_order` return the existing matching order on retry without double-counting promotions, inventory, loyalty, or payment sessions.
- [x] Apply the same stable-attempt/idempotency behavior to deferred `pay-order` and aggregate table checkout, including reuse of an already-created hosted session when safe.
- [x] Make first `table_sessions` creation atomic by locking the resolved table row before create/read (consistent lock order) or using a conflict-safe insert.
- [x] Replace absolute shared-cart increments with an atomic delta/versioned mutation; reject stale edits with a visible refetch/retry result.
- [x] Preserve size, modifiers, and notes in order mapping and Reorder. If a historic option no longer exists, route that item back through configuration instead of silently changing it.
- [x] Test duplicate/retry and metadata paths locally; concurrent hosted-RPC checks remain pending.

### Task 3: Replace blank, frozen, and false-empty screens (P1)

**Files:**
- Create: `components/shared/async-state.tsx`
- Modify: `components/customer/order-tracking.tsx`
- Modify: `components/customer/table-landing.tsx`
- Modify: `components/customer/table-ordering-session.tsx`
- Modify: `components/customer/cart-view.tsx`
- Modify: `components/customer/review-form.tsx`
- Modify: `components/customer/address-book-view.tsx`
- Modify: `components/customer/loyalty-view.tsx`
- Modify: `hooks/useOrders.tsx`
- Modify: `hooks/useTableSession.tsx`
- Modify: `hooks/useKitchenOrders.tsx`
- Modify: `hooks/useDashboardStats.tsx`
- Modify: `components/admin/stock-adjust-form.tsx`
- Add route-group `loading.tsx` and `error.tsx` boundaries under customer, staff, and admin.

**Interfaces:**
- Async views distinguish `loading | data | empty | error | stale`; refresh failure retains last-good data.
- Mutations expose per-entity pending state and a translated, screen-reader-announced error.

- [ ] Show skeleton/progress and retry instead of returning `null` for order tracking, QR resolution, table-session load, and review lookup.
- [ ] Catch guest polling and Realtime refetch failures; retain last-good order/table data and label it stale until recovery.
- [ ] Put promo Apply in `try/catch/finally` so rejection never leaves the button permanently disabled.
- [ ] Stop turning order, loyalty, dashboard, and address-book failures into genuine-looking empty/zero states.
- [ ] Await table-cart, stock-adjust, dashboard-restock, cash-confirm, serving, and per-item KDS mutations; disable only the affected control and show success/failure.
- [ ] Add retry/failure tests for every state above, including rapid double taps and recovery after a transient error.

### Task 4: Stop unnecessary requests and Realtime amplification (P1)

**Files:**
- Modify: `app/[locale]/layout.tsx`
- Modify: `app/[locale]/(customer)/layout.tsx`
- Modify: `app/[locale]/staff/layout.tsx`
- Modify: `app/[locale]/admin/layout.tsx`
- Modify: `components/admin/admin-layout-client.tsx`
- Modify: `middleware.ts`
- Modify: `lib/get-current-role.ts`
- Create: `hooks/useLatestRefetch.ts`
- Modify: `hooks/useTableSession.tsx`
- Modify: `hooks/useKitchenOrders.tsx`
- Modify: `hooks/useDashboardStats.tsx`
- Modify: `hooks/useShift.tsx`
- Modify: `hooks/useInventory.tsx`
- Modify: `lib/supabase/inventory-data.ts`

**Interfaces:**
- `useLatestRefetch(load, delayMs)` coalesces event bursts, allows one active fetch, and ignores stale completions.
- Middleware overwrites a private resolved-role request header; downstream layouts reuse that trusted result instead of repeating auth/profile queries.

- [ ] Remove `TablesProvider` and `OrdersProvider` from the root. Mount Cart/Orders/Tables only in the customer or specific staff/admin routes that consume them.
- [ ] Mount `KitchenOrdersProvider` only on the live KDS page, not POS and order-history pages. Mount Inventory/Shift providers only where their data is required.
- [ ] Skip remote role lookup for requests with no Supabase auth cookie; resolve an authenticated role once and reuse it in root/staff/admin layouts.
- [ ] Filter unfiltered table-session payloads against the known session/table ids before refetch; keep the required 10-second poll only for guest-invisible order changes.
- [ ] Coalesce order + order-item event bursts in KDS/dashboard/shift, and use latest-wins sequencing so an older response cannot overwrite newer state.
- [ ] Defer inventory logs until the Logs tab opens and cursor-paginate instead of silently truncating at 200.
- [ ] Re-run production timing and record before/after TTFB plus request/channel counts for Landing, Login, Menu, KDS, Dashboard, Settings, and Shift.

### Task 5: Fix database hot paths with measured indexes (P1)

**Files:**
- Create after measurement: `supabase/migrations/0086_order_hot_path_indexes.sql`
- Recreate the canonical `get_dashboard_stats()` function inside that new migration; do not edit an already-applied migration.

- [x] Run live performance advisors and the missing-FK-index query before choosing indexes.
- [x] Run baseline `EXPLAIN (ANALYZE, BUFFERS)` for KDS nested order reads, per-item rollup, table-session assembly, customer order history, and dashboard date ranges.
- [x] Add only evidenced indexes: `order_items(order_id)`, `orders(table_id)`, `orders(customer_id)`, and a partial paid-order time index.
- [x] Rewrite dashboard day filters from casts on `created_at` to explicit Asia/Ho_Chi_Minh day boundaries expressed as UTC timestamp ranges so an index remains usable.
- [ ] Re-run plans/advisors and record row counts, scan type, buffers, and execution time before/after.

### Task 6: Repair hydration, accessibility, and bilingual UX (P1/P2)

**Files:**
- Modify: `app/[locale]/layout.tsx`
- Modify: `hooks/useTheme.tsx`
- Modify: `components/shared/theme-toggle.tsx`
- Create: `components/ui/dialog.tsx` using `@base-ui/react/dialog`
- Modify: `components/motion/bottom-sheet.tsx`, `components/motion/side-drawer.tsx`
- Modify: all admin/staff/customer modal and sheet callers.
- Modify: `components/customer/menu-browser.tsx`
- Modify: `components/auth/login-form.tsx`, `components/auth/signup-form.tsx`
- Modify: `messages/vi.json`, `messages/en.json`
- Add component test dependencies/config only as part of the first tested UI fix.

- [ ] Remove production hydration error #418: keep the server/client theme markup stable, suppress only the intentional `<html>` theme-class difference, and test stored/system light and dark preferences.
- [ ] Replace the nested Menu card `<button>` + `role="button"` quick-add span with sibling semantic controls; Enter/Space must activate both paths.
- [ ] Build one accessible Dialog module with focus trap/restore, Escape, labelled title/description, `aria-modal`, and inert background; migrate admin forms, confirmations, QR scanner, quick-add, Check Bill, rewards, and drawers/sheets.
- [ ] Add confirmations for menu deletion, QR regeneration (explicitly warn printed codes stop working), cash received, and mark-out-of-stock.
- [ ] Raise all interactive targets to at least 44×44 CSS pixels. Confirmed small targets include the 40px global controls, 36px Menu category chips, Login password reveal, Forgot Password, and Sign Up link.
- [ ] Add `autocomplete="email"`, `current-password`, `new-password`, name, tel, and address tokens to auth/profile/address forms.
- [ ] Translate hardcoded auth artwork, landing gallery, table-cart, star-rating, and staff tooltip text in both catalogs.
- [ ] Run axe, keyboard-only traversal, focus-order, 200% zoom, and screen-reader smoke tests in both locales and themes.

### Task 7: Restore quality gates and cover real failure behavior (P2)

**Files:**
- Modify the 20 files currently reported by ESLint.
- Modify: `vitest.config.ts` or module format so the Vite native-loader warning is removed.
- Create: component/hook tests for customer checkout/tracking/table session and KDS/admin mutation flows.
- Create: `.github/workflows/quality.yml`

- [ ] Fix all 23 lint errors and 11 warnings; do not disable React purity/compiler rules globally to make the command green.
- [ ] Specifically remove render-time `Date.now()`, render-time ref mutation, cascading effect state, and the Cart memoization pattern that prevents React compiler optimization.
- [ ] Add tests for OAuth initiation failure, payment/promo pending reset, stale-data presentation, Realtime disconnect/recovery, modal keyboard behavior, and settings authorization/constraints.
- [ ] Make `lint`, `tsc --noEmit`, `test`, and `build` required pre-merge checks.
- [ ] Add localized route error boundaries so an unexpected render/server failure offers Retry/Home instead of Next.js’s generic English 500 page.

### Task 8: Production acceptance pass and content cleanup (release gate)

- [ ] Remove/disable the live **“test / non”** menu item and audit every public menu item for both-locale name, description, image, price, availability, sizes, and modifiers.
- [ ] Mobile matrix: real iOS Safari + Android Chrome; Landing, Menu search/filter/quick-add, pickup cart/checkout, QR shared cart on two devices, running tab, Check Bill, payment return, tracking, profile, loyalty.
- [ ] Staff matrix: POS, per-item KDS progression, table serve/cleaning, cash confirmation, Realtime disconnect/reconnect, pickup Pay Later edge case, shift join/open/close/history.
- [ ] Admin matrix: dashboard KPI cross-check + Excel export, menu/inventory/tables/promotions/staff/settings permissions, invalid values, destructive confirmations, dark mode, both locales.
- [ ] Payment matrix: Cash, Stripe, VNPay success/cancel/timeout/retry, duplicate-submit protection, gateway-setup failure unlock, stale webhook, and amount cross-check.
- [ ] Performance budgets to approve before release: no hydration/console errors; no public-route unused Supabase channels; no blank loading state; no indefinitely disabled action; establish LCP/INP/CLS and route-TTFB baselines on a mid-tier Android connection before deciding whether to mesh-compress the 1.8MB GLB.

## Carry-over business decisions/manual checks

- Set the real tax rate and shop name/address/phone/hours after Task 1 adds safe validation; current tax is intentionally `0`.
- Complete the real emailed password-reset link round trip.
- Decide whether staff need a pickup Pay Later Cash/Undo control; dine-in already has the table-card equivalent.
- Remove the dead `VNPAY_RETURN_URL` variable if confirmed unused, and later migrate deprecated `middleware.ts` to Next.js `proxy.ts` as a separate low-risk cleanup.
- Legacy table-session rows with `table_session_id is null` remain a data-migration-only edge case; cover them only if production data contains such rows.
- Root `AGENTS.md` refers to `components/customer/AGENTS.md`, `components/staff/AGENTS.md`, and `components/admin/AGENTS.md`, but those files are absent in this checkout; restore them or correct the structural map before the next area-specific agent task.

## Completion gate

This plan is complete only when Tasks 1–8 are checked, all four local gates pass, Supabase security/performance advisors have no new actionable findings, and the deployed two-locale/two-device/payment matrix is recorded with no P0/P1 issue left open.
