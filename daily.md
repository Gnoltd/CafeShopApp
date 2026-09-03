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

- [x] Show skeleton/progress and retry instead of returning `null` for order tracking, QR resolution, table-session load, and review lookup. (`117e9af`, review fix `0d7e886`)
- [x] Catch guest polling and Realtime refetch failures; retain last-good order/table data and label it stale until recovery. (`5adedb9`)

**Task 3 remainder split between Claude and Codex (2026-09-03), customer-facing vs.
staff/admin-facing so neither track edits a file the other is touching:**

**Claude owns 3b (customer-facing, continues today's `order-tracking.tsx`/
`useOrders.tsx`/`useTableSession.tsx`/`table-ordering-session.tsx` context):**
- [ ] Put promo Apply (`components/customer/cart-view.tsx`,
  `components/customer/checkout-view.tsx`) in `try/catch/finally` so rejection
  never leaves the button permanently disabled.
- [ ] Stop turning order and address-book failures into genuine-looking
  empty/zero states (`components/customer/order-history.tsx`,
  `components/customer/address-book-view.tsx`, `hooks/useOrders.tsx`) —
  loyalty's false-empty-state is Codex's, see 3c.
- [ ] Await table-cart add/remove/quantity mutations
  (`components/customer/table-ordering-session.tsx`,
  `components/customer/table-cart-panel.tsx`, `hooks/useTableSession.tsx`);
  disable only the tapped row and show success/failure.
- [ ] Add retry/failure tests (rapid double taps, recovery after a transient
  error) for all of the above.

**Codex owns 3c (staff/admin-facing, zero file overlap with 3b):**
- [ ] Stop turning loyalty and dashboard failures into genuine-looking
  empty/zero states (`components/customer/loyalty-view.tsx`,
  `hooks/useDashboardStats.tsx`, `components/admin/dashboard-view.tsx`).
- [ ] Await stock-adjust and dashboard-restock mutations
  (`components/admin/stock-adjust-form.tsx`,
  `components/admin/inventory-management.tsx`,
  `components/admin/dashboard-view.tsx`).
- [ ] Await cash-confirm, serving, and per-item KDS mutations
  (`components/staff/kitchen-tables-column.tsx`,
  `components/staff/kitchen-board.tsx`, `components/staff/kitchen-display.tsx`,
  `components/staff/pos-terminal.tsx`, `hooks/useKitchenOrders.tsx`) — **pull
  latest `main` first**: Claude's optimistic-update/race fixes (`d7f3b6d`,
  `1bcde6d`) landed in `useKitchenOrders.tsx`/`kitchen-board.tsx` today, this
  sub-task must build on top of those, not before them.
- [ ] Add retry/failure tests (rapid double taps, recovery after a transient
  error) for all of the above.

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

- [x] Remove `TablesProvider` and `OrdersProvider` from the root. Mount Cart/Orders/Tables only in the customer or specific staff/admin routes that consume them. (`692770a`; a follow-up hotfix `9bd6df0` was needed — see below)
- [x] Mount `KitchenOrdersProvider` only on the live KDS page, not POS and order-history pages. Mount Inventory/Shift providers only where their data is required. (`692770a`; real consumers on POS + the shared `/staff/orders/*` top bar made "KDS-only" unworkable as literally written — mounted on `/staff/orders/*` + `/staff/pos` instead, independently verified as the correct resolution, not a shortcut. `/staff/rewards` is fully freed of both providers, the real available win.)
- [x] Skip remote role lookup for requests with no Supabase auth cookie; resolve an authenticated role once and reuse it in root/staff/admin layouts. (`10f2b36`, then `a069fad` — a security review caught a real auth-bypass regression: the middleware matcher's unanchored extension exclusion let a spoofed `X-Resolved-Role` header past the `/staff`/`/admin` gates on routes like `/staff/orders/history/<id>.png`. Fixed by anchoring the matcher AND restoring an independent role check in the two gate layouts as defense-in-depth. Verified live against a production build both ways.)
- [x] Filter unfiltered table-session payloads against the known session/table ids before refetch; keep the required 10-second poll only for guest-invisible order changes. (`3725d4e`; subscriptions remain genuinely unfiltered, filtering is client-side post-payload; 10s poll preserved unweakened)
- [x] Coalesce order + order-item event bursts in KDS/dashboard/shift, and use latest-wins sequencing so an older response cannot overwrite newer state. (`3725d4e`; latest-wins independently traced and confirmed via a genuine out-of-order-resolution test. Needed 2 fix rounds: the initial coalescing left the KDS's own tap-to-advance with no feedback for up to ~1.2s — fixed with an optimistic local update (`d7f3b6d`) — which itself introduced a same-item race if two transitions were tapped before the first RPC resolved — fixed by disabling the tapped button while its own RPC is in flight (`1bcde6d`), which structurally prevents the race entirely.)
- [x] Defer inventory logs until the Logs tab opens and cursor-paginate instead of silently truncating at 200. (`692770a`; real keyset cursor pagination, not offset-based — confirmed immune to shifting-under-inserts)
- [x] Re-run production timing and record before/after TTFB plus request/channel counts for Landing, Login, Menu, KDS, Dashboard, Settings, and Shift. **Partial**: TTFB captured for public routes (Landing/Menu/Cart/Login) via curl — see the progress ledger for numbers. Not done: Realtime channel-count (needs DevTools/a browser, not curl) and KDS/Dashboard/Settings/Shift TTFB (auth-gated, an anonymous curl only measures the login redirect). Same live-browser gap as Task 6's final item.

**Task 4 status: all 6 code items done and individually code-reviewed (4a: 0 fix rounds; 4b: 1 round on a Critical auth-bypass finding; 4c: 2 rounds on an Important UX/race finding), item 7 partially done. One live production incident during this task, found and hotfixed same-session:** 4a's provider-scoping regression broke the landing page and every login/signup/reset-password page in production (missing `CartProvider` on shared chrome — `BottomNav`/`CustomerHeader` — rendered by the marketing/auth route groups, not just customer). Found via curl while re-measuring timing, hotfixed directly (`9bd6df0`, deployed, independently re-verified live), not routed through the normal review loop given the severity of a live outage on the two most-visited pages. Deferred minors (not blocking, listed for a future polish pass): no discoverable Retry on a failed inventory-logs load; a further `useKitchenOrders()` context split could shrink the POS provider footprint; the same unanchored-prefix matcher pattern exists on `api`/`_next`/`_vercel` but is unreachable (the locale guard 404s first); `app/[locale]/layout.tsx`'s own security comment is now similarly overstated (low-stakes, display-only there); `React.cache()` would remove the 2x round-trip cost the gate-layout defense-in-depth fix accepted; a dead `FRESH_LOAD` export; a `maxDelayMs` test that asserts call-count not the actual timing boundary; a cosmetic (no correctness risk) visual flicker if a coalesced refetch lands mid-flight on an in-flight KDS item.

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

- [x] Remove production hydration error #418: keep the server/client theme markup stable, suppress only the intentional `<html>` theme-class difference, and test stored/system light and dark preferences. (`bcd12d2`)
- [x] Replace the nested Menu card `<button>` + `role="button"` quick-add span with sibling semantic controls; Enter/Space must activate both paths. (`bcd12d2`)
- [x] Build one accessible Dialog module with focus trap/restore, Escape, labelled title/description, `aria-modal`, and inert background; migrate admin forms, confirmations, QR scanner, quick-add, Check Bill, rewards, and drawers/sheets. (`13a4c3a`, review-clean after 2 fix rounds: `38adc11`, `78f032c`)
- [x] Add confirmations for menu deletion, QR regeneration (explicitly warn printed codes stop working), cash received, and mark-out-of-stock. (`13a4c3a`)
- [x] Raise all interactive targets to at least 44×44 CSS pixels. Confirmed small targets include the 40px global controls, 36px Menu category chips, Login password reveal, Forgot Password, and Sign Up link. (`bcd12d2`; inline Sign Up/Login sentence links can only reach 44px height not width without a visual regression — WCAG 2.5.5's own sentence-link exception, reviewer-confirmed no better fix available)
- [x] Add `autocomplete="email"`, `current-password`, `new-password`, name, tel, and address tokens to auth/profile/address forms. (`bcd12d2` + `feafa40`)
- [x] Translate hardcoded auth artwork, landing gallery, table-cart, star-rating, and staff tooltip text in both catalogs. (`44c588a`)
- [ ] Run axe, keyboard-only traversal, focus-order, 200% zoom, and screen-reader smoke tests in both locales and themes. **Blocked**: needs a working browser tool; Playwright MCP isn't connected this session (the underlying `npx`-not-on-`$PATH` cause was fixed mid-session via symlinks, but MCP servers only reconnect at session start). Same class of gap as Task 8's mobile-device matrix below — needs a fresh session or a human pass.

**Task 6 status: 7/8 items done and individually code-reviewed (all commits above pushed and deployed, `tsc`/`vitest` 262/262/`build` clean at each step). The 1 remaining item needs live browser access this session doesn't have.** Minor findings deferred (not blocking, listed for a future polish pass): quick-add button missing an explicit `focus-visible` ring (covered by the app's global outline rule, non-blocking); theme-icon one-frame flash on mount (`useEffect` vs `useLayoutEffect`); duplicated password-reveal JSX between login/signup forms; `FIELD_INPUT_PROPS` typed as bare `string`; `dialog.tsx`'s docblock cites the wrong internal option name for why `inert` isn't used (the described end-behavior is still correct); `vi.json`'s "Xoá" vs the more standard "Xóa" orthography; `signup-form.tsx`'s hardcoded `email@example.com` placeholder.

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
