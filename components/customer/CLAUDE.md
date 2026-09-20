# components/customer/CLAUDE.md

Customer-facing UI. Everything here is guest/anonymous — there is no
customer account concept anywhere in this app as of the 2026-09-19
minimal ordering rebuild (see the root `CLAUDE.md`'s Status/Feature
areas for the full rationale). This file only covers what actually
survives in this directory; check `find components/customer -type f`
if it ever looks stale rather than trusting this list from memory.

## What's here

- **`/` (scan-QR landing)** — not a component in this directory; the
  page itself (`app/[locale]/(customer)/page.tsx`) is a small static
  server component with a `QrCode` icon, a "scan the QR code at your
  table" message, and a `/login` link for staff. No marketing content,
  no personalization, nothing from this folder is imported by it.
- **`menu-browser.tsx`** — the shared menu-grid component used by both
  the public `/menu` page and the table ordering session. Fully
  prop-driven (`categories`, `items`, `onAddItem`, `cartItemCount`,
  `cartSubtotal`, `onViewCart`, `canOrder`) — it no longer has any
  internal `useCart()` fallback (that hook is deleted entirely, see
  below). When `canOrder={false}` (the standalone `/menu` page), every
  add-to-cart control renders `disabled` with a `title` tooltip
  ("Scan the table's QR to order" — this project's standard
  "disabled + tooltip" convention for an unbacked action) instead of
  doing nothing silently. When `canOrder` is true (inside a table
  session), tapping an item either adds it directly or opens
  `quick-add-popup.tsx`'s size/extras sheet first.
- **`product-detail.tsx`** — `/menu/[itemId]`'s read-only detail view
  (name/description/image/price/sizes). No reviews (deleted), no
  add-to-cart button (there's no table context on this standalone
  route to attach an order to).
- **`quick-add-popup.tsx`** — size/extras picker sheet for an item that
  needs a choice before it can be added. `onAdd` is a required prop (no
  `useCart()` fallback either); only ever rendered when `canOrder` is
  true.
- **`table-landing.tsx`** — `/table/[qrToken]`'s entry component.
  Resolves the scanned token to a real table via
  `useTables().setActiveTableByToken`, shows a skeleton while loading
  and a retryable error state on failure, an "invalid QR" screen if the
  token doesn't resolve to a real table, and otherwise renders
  `table-ordering-session.tsx`. Deliberately simple — this file used to
  also carry a personal-cart → table-session transfer bridge
  (`?cartTransfer=`) and a `cleaning`-status blocked-scan screen; both
  were removed in the rebuild (the cart-transfer flow's only source,
  the individual `/cart` checkout, is deleted; table status is now
  purely binary and shown on the staff side only — see the root
  `CLAUDE.md`'s "Table status" entry).
- **`table-ordering-session.tsx`** — the real "logged-in-feeling" screen
  for a guest at a table. A two-tab (menu / order) view driven by
  `useTableSession(qrToken)`: adding/removing/adjusting cart items,
  placing a round, an "are you still here?" idle-timeout prompt, and
  opening Check Bill. Per-cart-item pending state (`pendingCartItemIds`)
  disables only the tapped row during its own mutation, so a double-tap
  can't fire two concurrent RPCs for the same line without freezing the
  rest of the cart.
- **`table-cart-panel.tsx`** — renders the draft cart + placed rounds
  list (with per-round/per-order status) and the "Yêu cầu tính tiền"
  (request the bill) button that opens `check-bill-sheet.tsx`.
- **`check-bill-sheet.tsx`** — Check Bill is **cash-only, no picker, no
  promo code field**. The dialog body is just: total due, a
  loading/error state, and a single "Yêu cầu tính tiền" confirm button
  that calls `requestTableBill` (`lib/supabase/table-session-data.ts`)
  → `checkout_table_session(p_qr_token, p_method: 'cash', p_promo_code:
  null)` directly from the browser — no Edge Function fronts this
  anymore (`checkout-table-session` is deleted). Staff settle the table
  from `/staff/tables` afterward; see `components/staff/CLAUDE.md`.
- **`header.tsx`** — the sticky top bar (logo, back button, desktop
  nav to `/` and `/menu`). No cart link, no profile/loyalty/orders
  links — all deleted along with those features. Also had a real,
  pre-existing TypeScript bug fixed along the way during this rebuild
  (unrelated to the rebuild itself — introduced by an earlier
  nav-trimming change): a `never`-narrowing issue in its active-nav-item
  logic. Fixed, not otherwise consequential to this file's structure.
- **`bottom-nav.tsx`** — mobile bottom nav, same trimmed link set as
  `header.tsx`.
- **`item-image.tsx`** — real uploaded photo when set, falling back to
  a category icon (`coffee`/`cup-soda`/`cookie`/`milk`). Unchanged by
  the rebuild.

## Known gap, found but not fixed during the 2026-09-19 rebuild

`qr-scanner-overlay.tsx` (an in-app camera-based QR scanner component)
has no importer anywhere in `app/`/`components/` — it's dead code,
orphaned since an earlier ("Rebuild Home…") commit that predates this
rebuild, not something the rebuild itself broke. `middleware.ts`'s
`camera=(self)` Permissions-Policy comment still references it by name.
Every real path to `/table/[qrToken]` today is a guest's phone camera
app decoding a physically printed QR code and opening the URL directly
— there is no in-app scan button. Flagged here per this project's
"disabled + tooltip"/no-silent-dead-code convention rather than left
unmentioned; not fixed as part of this docs-only task.

## What's deleted (do not re-introduce without re-reading the design doc)

Everything below is gone — application code only, the underlying DB
tables/columns stay per the rebuild's never-drop rule (see root
`CLAUDE.md`'s Database section):
- `hooks/useCart.tsx` and the individual (non-table) `/cart` →
  `/checkout` flow, `cart-view.tsx`, `checkout-view.tsx`, and the
  cart-transfer bridge (`lib/table-cart-transfer.ts`).
- `/profile`, `/profile/settings`, `/profile/addresses` and their views
  (`profile-view.tsx`, `profile-settings-view.tsx`,
  `address-book-view.tsx`).
- `/loyalty`, `/loyalty/redemptions` (`loyalty-view.tsx`,
  `my-redemptions-view.tsx`, `rewards-catalog-modal.tsx`).
- `/orders`, `/orders/[orderId]` order tracking (`order-history.tsx`,
  `order-tracking.tsx`) — a guest's order status is now shown inline on
  their own `/table/[qrToken]` page instead.
- Reviews (`review-form.tsx`, `star-rating.tsx`) — `product-detail.tsx`
  is view-only now.
- `home-view.tsx`, `best-sellers-arc.tsx` — the old merged
  marketing+dashboard Home; replaced by the bare scan-QR page.
- Every account-creation surface: signup, Google OAuth callback,
  self-service password reset (see `components/auth/` — not this
  directory, but the same rebuild removed those too, keeping only
  `/login` for staff/manager/admin).
