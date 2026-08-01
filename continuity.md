# Project: PhaDinCafe — Management & Customer Portal

## Goal

Web app for a single-location coffee shop ("PhaDinCafe"): customer
ordering (pickup + dine-in QR), staff POS + Kitchen Display,
manager/admin menu/inventory/reporting/settings. Full spec:
`docs/superpowers/specs/2026-07-04-coffee-shop-app-design.md`. Bilingual
product: single language per page (VI or EN, default VI), switchable via
a toggle — not a dual-language-at-once display.

## Current status

**CLAUDE.md is the authoritative, actively-maintained structural map —
always check it first.** This file is a historical log only; everything
below is kept for record, not as a live task list. `daily.md` tracks
what's currently open.

**As of 2026-07-07** (this snapshot — now behind current reality, see
CLAUDE.md): the app was fully real end-to-end with 19 DB migrations
live. Substantially more has shipped since (reviews, real menu-image
upload, table status, deferred payment + service lifecycle, payment
method correction, real Profile persistence, real Admin Dashboard
KPIs, shift closing — 32 migrations as of the last CLAUDE.md update).
This paragraph is intentionally left as a dated snapshot rather than
kept live — **always check CLAUDE.md's "Status" section for the
current count/state**, this file is history only.

## Key decisions

- Supabase-only backend (no custom Express/API server) — RLS is the
  real security boundary.
- Single location, no branches table.
- Loyalty: admin-configurable rates, defaults 10,000 VND spent = 1
  point, 100 points = 10,000 VND discount.
- Payments: Stripe (card), Cash, VNPay — all real now (sandbox/test
  mode for Stripe and VNPay).
- `staff` and `admin` are real URL-segment folders, not route groups
  (a route group would collide with `(customer)`'s bare paths).
- Visual style: brick red (#B3341F) + coffee brown (#6F4E37) + caramel
  (#C9A66B) + cream, Be Vietnam Pro font. **As of 2026-07-12, mid
  redesign** (design locked, implementation not yet started — see
  `docs/superpowers/specs/2026-07-12-elevated-warm-redesign-design.md`)
  to a "Neubrutalist Modern" treatment of these same brand colors:
  thick ink-colored borders, flat hard-offset shadows that collapse on
  press instead of soft/blurred shadows, sharper corners than the
  original ~12px, and a first-ever dark mode. Colors/hues are
  unchanged — only shape/depth/typography evolve. Until that redesign
  ships, the shipped app still looks like the original soft, ~12px-
  corner style described above.
- i18n: next-intl with locale-prefixed routing (`/vi/...`, `/en/...`),
  Vietnamese default — chosen over a lightweight cookie-only approach
  despite the bigger route-restructuring cost.
- Middleware fails open to "anonymous" (not a crash) when Supabase is
  unreachable/unconfigured.
- **Guest ordering is intentional**: customer routes (`/menu`, `/cart`,
  `/checkout`, `/orders`, `/profile`, `/loyalty`) are deliberately never
  role-gated — only `/staff/*` and `/admin/*` require a role. Logout
  clears the session and returns to `/menu` as a guest, not `/login`.

## History (condensed — see CLAUDE.md for current reality, git log for detail)

The project went through two broad phases:

1. **FE-only, mock-data phase** (through early July): the full Next.js
   app was scaffolded, made bilingual (next-intl), themed with the real
   brand, and every page — Landing, Auth, the full customer ordering
   flow, staff POS/Kitchen Display, all six admin pages, the table QR
   identity flow, Product Detail pages — was built as real interactive
   UI against `lib/mock-data/*` and local React state/localStorage, not
   a database. Several passes were spent auditing every page against
   its original Stitch mockup for fidelity gaps (missing pagination,
   disconnected mock-data islands like Checkout/Order-Tracking/History
   or POS/Kitchen-Display each holding their own separate copy of data)
   and fixing them with shared Context+Provider hooks
   (`useCart`/`useTables`/`useOrders`/`useKitchenOrders`/`useInventory`).
   This phase closed out with every page genuinely interactive, real
   client-side cart/order/kitchen-board state, and a consistent
   "disabled + tooltip" convention for any action with no backend to
   persist to yet — no fake data pretending to be real.
2. **Backend phase** (as described in CLAUDE.md): the Supabase schema,
   RLS, and Edge Functions were built out feature by feature — Auth,
   Menu, Inventory, Tables, Orders, Staff accounts, then Stripe and
   VNPay payments — each with its own dated design spec + implementation
   plan under `docs/superpowers/`, replacing the mock data from phase 1
   one subsystem at a time until nothing mock remained.

Two structural gotchas from phase 1 are still relevant and documented in
CLAUDE.md's "Cross-cutting conventions" section: Base UI's `render` prop
(not Radix's `asChild`) for polymorphic shadcn Buttons, and the
Destination Rule for focused single-task pages (Checkout, Order
Tracking) hiding the bottom tab bar in favor of their own sticky action
bar.
