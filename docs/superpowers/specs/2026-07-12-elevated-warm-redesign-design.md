# "Neubrutalist Modern" Redesign — Motion + Visual System Across All Pages (2026-07-12)

> **Revision note**: this spec originally locked a soft-shadow "Elevated
> Warm" direction (see git history). After live review of 8 full-page
> mockups (published as Artifacts + iterated in the visual-companion
> browser), the actual locked style is **Neubrutalist Modern**: thick
> ink-colored outlines, flat hard-offset shadows that collapse on press,
> bold/uppercase labels — not soft blurred shadows. This revision
> replaces the Design System section below with what was actually
> approved. Everything else (scope, phasing, performance budget,
> out-of-scope) still holds.

## Goal

Redesign the visual finish and interaction feel of every page (Customer,
Staff, Admin) around one consistent system: thick-outline/hard-shadow
cards, confident typography, a warm color system in both light and dark
mode, and motion tuned to feel instant (interaction feedback under
~0.2s). This is a **responsive web app** reached via mobile browsers on
**both iOS and Android** (Safari/Chrome), not a native app — so touch
targets, safe areas, and phone-width layout are first-class requirements
throughout, not an afterthought for one page.

Business logic, routes, RLS, and data layers are untouched — this is a
presentation-layer project, same boundary as the prior
`2026-07-09-starbucks-customer-motion-design.md`.

## How this was validated

Rather than more static wireframe rounds (which stalled — 8+ style
directions shown before the user delegated final shape/depth judgment),
every page was built as a real, interactive, standalone HTML mockup
(published via Artifacts, iterated live against specific pixel-level
feedback) covering: Landing (`/`), Menu (`/menu`), Cart & Checkout,
Orders (Tracking + History), Profile & Loyalty, Staff POS, Kitchen
Display (KDS), and the full Admin shell (Dashboard + all 7 sub-pages:
Menu Management, Inventory, Tables, Food Cost, Shift, Staff, Settings).
Each mockup is theme-toggleable (light/dark) and includes a working
VI/EN language-pill placeholder. Real bugs were found and fixed this way
(listed below as binding component rules) that static wireframes would
not have caught.

## Design System — Neubrutalist Modern

### Color tokens (`app/globals.css`)

Hue family is unchanged from today's brand tokens — brick red, coffee
brown, caramel, cream. New: a dark mode (none exists in the app today)
and a few new surface-level tokens.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#fff8f2` (unchanged) | `#1c1712` |
| `--card` (new) | `#fffaf5` | `#2b2118` |
| `--foreground` | `#2b2118` (near-black ink, slightly darker than today's `#3a2e22` for stronger outline contrast) | `#fff8f2` |
| `--muted-foreground` | `#6f4e37` (coffee brown, unchanged) | `#c9a66b` (caramel) |
| `--primary` | `#b3341f` (unchanged) | `#e0663f` (lightened for AA contrast on dark) |
| `--accent` | `#c9a66b` (unchanged) | `#f2c88f` (lightened) |
| `--chip` (new, cream card/pill fill) | `#f9e9d4` | `#241b14` |
| `--price` (new, always-bold price/highlight color) | `#b3341f` | `#ff8a5c` |
| `--ink` (border/shadow color — **not** always `--foreground`; see below) | `#2b2118` | `#f2c88f` |
| `--success` | `#3f7d4e` | `#6bbf80` |
| `--warn` | `#c48a1f` | `#e0b04a` |

`--ink` is its own token, not reused from `--foreground`, because dark
mode needs the outline/shadow color to be the *light* caramel (`#f2c88f`)
for contrast against a near-black card, while `--foreground` (body text)
stays the light cream. Conflating them was tried and looked wrong in the
first dark-mode mockup pass — kept separate ever since.

Theme switching: `prefers-color-scheme` as the default signal, with a
`data-theme="dark"|"light"` override on `<html>` for an explicit
in-app toggle (every mockup has a ☀/☾ button; the real app needs the
equivalent — likely on Profile Settings, plus the existing fixed
`LanguageSwitcher` pill gets a sibling theme pill).

### Shape & depth — Neubrutalist, not soft-shadow

- **Thick ink borders**: `--ink-border` is `2.5px` on Customer pages,
  `2px` on Staff/Admin (denser). Every card, button, chip, and input
  gets this border in `--ink`.
- **Flat hard-offset shadows**, not blurred: `Npx Npx 0 var(--ink)` —
  `4-5px` offset on Customer cards, `2-3px` on Staff/Admin (denser
  scale). No `blur-radius`, ever — that reads as "soft," which was
  explicitly rejected.
- **Press feedback = shadow collapse**, not scale: on `:active`,
  `transform: translate(Npx, Npx)` (matching the shadow offset) +
  `box-shadow: 0 0 0 var(--ink)` — the element visually "pushes into"
  the page as the shadow disappears. This is the primary tap-feedback
  mechanism everywhere (buttons, cards, chips, pills) — cheap
  (transform + box-shadow only, GPU-friendly) and inherently fast,
  which is why it satisfies the ≤100ms tap-feedback budget without
  extra tuning.
- Radius: `--radius-lg` ~`0.55-0.65rem` (cards), `--radius` ~`0.4-0.5rem`
  (buttons/inputs/chips), `--radius-pill` for pills/switchers. Smaller
  than the original spec's 12-16px soft-UI numbers — sharper corners
  read as more "modern," per direct feedback.
- Photography gets real estate (large rounded-square crops), but photo
  *placeholders* in every mockup are CSS gradients (`--accent` →
  `--primary`), not real images — real implementation swaps these for
  actual menu photos via the existing Storage-bucket upload flow
  (already real, see CLAUDE.md's Menu Management section).

### Typography

Be Vietnam Pro stays (hard requirement — Vietnamese diacritic support
rules out most trendy display fonts; confirmed again this pass since
several category/item names are genuinely Vietnamese, e.g. "Cà Phê Sữa
Đá," "Bạc Xỉu"). Mockups substitute a system sans (`Segoe UI` / `Roboto`
/ `-apple-system`) since the Artifact sandbox can't load a custom
webfont — note this substitution when reviewing mockups; it is **not**
a font change for the real app.

Headings 800-900 weight (heavier than the original spec's 700-800 —
"Bold Block"-style confidence was part of what got the Neubrutalist
direction approved). Section labels/eyebrows: uppercase, `0.03-0.06em`
letter-spacing, 800-900 weight, small (10-13px). Prices always bold
(`--price` token), using `font-variant-numeric: tabular-nums` project-
wide so digit columns (prices, KPI values, order totals) never jitter.

### Motion (extends `components/motion/*`, no new library)

Same as originally specified — reuse the nine existing Framer Motion
primitives, extend to Staff/Admin, tighten durations:

| Interaction | Target |
|---|---|
| Tap/press visual feedback | ≤100ms (shadow-collapse technique above satisfies this natively) |
| Route/section transition | 150-200ms |
| Counter/progress tween | ≤200ms |
| Loading skeleton threshold | only shown past 300ms wait |

Staff/Admin motion stays functional-only (stagger on KDS board/Admin
table mount, press feedback everywhere) — no decorative/marketing
motion on operational screens, per the original spec's reasoning
(clarity and speed win over delight when it's a tool used all shift).

## Binding component rules (bugs found + fixed during mockup review)

These are not style preferences — they're specific defects discovered
building the 8 mockups, written as rules so the real implementation
doesn't reintroduce them.

- **Every `<button>` needs an explicit `color`.** Buttons do not
  inherit page text color like normal elements (browser default is
  `ButtonText`, effectively black) — found on the Menu category pills,
  which stayed black in dark mode until `color: var(--foreground)` was
  added explicitly. Audit every button for this before shipping a page.
- **A tab/segment "sliding thumb" indicator must not assume equal-width
  siblings.** The Cart/Checkout tab switcher's active-state highlight
  was hardcoded to `width: calc(50% - Npx)`, which broke because "Cart"
  and "Checkout" are different text lengths and the buttons weren't
  `flex: 1`. Fix: give every button in a segmented control `flex: 1`
  (equal width guaranteed), *then* the 50%-width thumb math is safe.
- **Centering a dot/mark inside a ring must use
  `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%)`**,
  not `inset:Npx` — `inset` centering broke under certain border/
  box-sizing combinations (the payment-method radio button). The
  transform technique is pure math against the element's own size and
  is immune to border-width or box-sizing changes.
- **`gap` between flex siblings does not account for `box-shadow`
  overflow.** A hard-offset shadow paints outside the element's layout
  box; a `gap` sized only for visual comfort (found: `6-8px`) let
  neighboring pills' shadows visually bleed into each other. Rule of
  thumb: gap ≥ (shadow offset × 2) + a few px, e.g. a 2-3px shadow
  offset wants ≥10-14px gap, not 6-8px.
- **Icon buttons under ~30px need their hit area extended, not their
  visual size.** Several controls in the dense mockups (quantity
  steppers, small icon buttons) are visually 20-28px — under the
  44×44pt (iOS)/48×48dp (Android) minimum touch target. Do **not**
  grow these visually (breaks the dense Neubrutalist scale that was
  specifically approved for Staff/Admin and compact list rows) —
  instead extend the *clickable* area via padding on an invisible
  wrapper, or `min-width`/`min-height` on the interactive element with
  the visual glyph centered inside, keeping the drawn circle small.
  This must be verified per-component during implementation, not
  assumed from the mockup's CSS alone (mockups draw the visual size;
  real components need the hit-slop layer added on top).

## Mobile / iOS / Android web requirements

This is a responsive **web** app opened in mobile browsers (Safari on
iOS, Chrome on Android) — not a native app, so there's no native safe-
area API, but the same physical constraints apply:

- `viewport-fit=cover` + `env(safe-area-inset-*)` padding on any fixed
  top/bottom UI (the existing fixed `LanguageSwitcher` pill and
  `RoleBadge` cluster already need this treatment — CLAUDE.md's "The
  fixed `LanguageSwitcher`" gotcha is the same class of bug).
- Every page's layout is mobile-first: single column below the first
  breakpoint (typically 640-860px depending on content), multi-column
  only above it. All 8 mockups follow this; the one gap found and fixed
  during review was Admin's Tables cards reusing the narrow `kpi-grid`
  (2-column even on a 375px phone, squeezing the QR box) — now a
  dedicated `tables-grid` that's single-column below 560px.
- Admin's sidebar becomes a slide-out drawer (scrim + spring-in panel)
  below ~860px — already the real app's shipped pattern (2026-07-09
  admin-mobile-redesign); the mockup reproduces it faithfully, tapping
  a nav link both navigates and closes the drawer.
- POS/KDS single-column-stack on mobile rather than forcing a fixed-
  height split-pane — deliberate: nested independently-scrolling panes
  fight the OS's own scroll gesture on mobile web, so a single page-
  level scroll (content stacks: item grid, then order panel) is the
  correct mobile pattern even though desktop uses a fixed-height split
  view with two independent scroll regions.
- Minimum touch target: 44×44pt for any **customer-facing primary
  action** (add-to-cart, checkout CTA, nav items) — verified via hit-
  slop per the component rule above, not by inflating visual size.
  Staff/Admin dense controls (used by trained staff, not the general
  public) can go smaller (28-32px minimum) matching the existing real
  POS/KDS mobile-redesign precedent.

## Per-Surface Application

*(unchanged from the original spec's structure — restated for
completeness now that every page has a concrete mockup to point to)*

### Customer
- **Landing (`/`)**: hero, "Xem Menu"/"Quét mã QR bàn" CTAs, promo
  cards, a "Popular Picks" preview rail, QR-scan callout. No ordering
  interactions here — kept structurally separate from Menu (confirmed
  explicitly: Landing and Menu stay two routes, not merged into one hub
  page, matching today's `(marketing)` vs `(customer)` route groups).
- **Menu (`/menu`)**: no hero — a compact promo strip, category pills,
  ordering grid with add-to-cart. Mirrors today's `MenuBrowser`
  structure, re-skinned.
- **Cart & Checkout**: tab-switcher between the two (utility-first, no
  marketing chrome), item rows, order-summary panel, Pay Now/Later +
  payment method picker, rewards toggle — matches existing real feature
  set (deferred payment, redemption at checkout, tax line).
- **Orders (Tracking + History)**: tab-switcher. Tracking's 4-step
  status stepper uses a **unique icon per step** (receipt = Confirmed,
  coffee cup = Preparing, bell = Ready, plate = Served) that flips to a
  green checkmark once that step completes — not a generic circle/
  checkmark for every step. "Confirmed" (not "Paid") is the first-step
  label since the order can be Pay Now or Pay Later.
- **Profile & Loyalty**: tab-switcher. Profile: avatar, Member ID,
  editable phone (pencil-edit affordance), Settings/Addresses/Language/
  Logout rows. Loyalty: points balance, tier progress ring, redeem
  button, transaction history.

### Staff
- **POS**: category pills + dense item grid + order panel (line items,
  totals, Cash/Card/VNPay picker, Charge button). Denser spacing/radius
  than Customer.
- **KDS**: 4-column board (Pending Payment / Preparing / Ready /
  Tables), "System Online" Realtime connection indicator, table cards
  with Mark Cash/Undo/Cleaning Done actions matching the real 3-state
  table model.
- Both carry a **POS/KDS/Admin app-switcher** pill in the top bar so
  staff can jump between the three tools without a separate nav — new
  UI surface, not previously specified; addresses a direct request
  during review.

### Admin
- Sidebar shell (Dashboard/Menu/Inventory/Tables/Food Cost/Shift/Staff/
  Settings), collapsing to a mobile drawer below ~860px.
- **Dashboard**: KPI row (Revenue/Orders/AOV/Loyalty Points, each with
  a trend delta), single-hue 7-day revenue bar chart (today highlighted,
  hover reveals value, one axis, direct-labeled peak instead of every
  bar — basic dataviz hygiene applied even though it's a simple chart),
  Table Status card (3-state counts + attention alert), Best Sellers,
  Export button.
- **Menu Management**: item rows (thumb, name, category, price, active
  toggle, edit/delete).
- **Inventory**: ingredient rows with stock level, low-stock badge,
  ±adjust; a Recent Activity log panel.
- **Tables**: one row per table (name, location, status badge, rename)
  with the **QR code box on the right edge, vertically centered** —
  explicit placement request during review — plus a small overlapping
  "regenerate" action button.
- **Food Cost**: per-item recipe breakdown (ingredient/qty/cost rows) +
  a margin summary panel with a margin bar.
- **Shift**: Current/History tab-switcher. Current shows the existing
  cash-reconciliation KPIs (Starting Cash/Cash Sales/Expected Cash)
  **plus a Payment Breakdown panel** (Cash/Card/VNPay, each with amount
  + order count, and a Total Revenue line) — the mockup initially only
  showed cash figures; per-method breakdown was flagged as missing and
  added, matching the real app's `shift-report-detail.tsx` which
  already renders a per-method breakdown for the live shift. History
  got the same treatment: clicking a past shift row updates a detail
  panel with that shift's own Cash/Card/VNPay split (mirrors the real
  `get_shift_report(p_shift_id)` RPC already returning this data).
- **Staff**: account rows (avatar, name, email, role badge, active
  toggle) + Add Staff Account button.
- **Settings**: Shop Info form (name/phone/address/hours/tax rate) +
  Loyalty section (enable toggle, earn/redeem rate fields) + Save.

## Rollout Order

1. Landing + Menu (the pilot — first real deploy, confirm live before
   continuing).
2. Cart/Checkout, Orders, Profile/Loyalty.
3. Staff: POS, then KDS.
4. Admin: Dashboard first, then the 7 sub-pages in roughly the order
   above (Menu Mgmt/Inventory/Tables are highest-traffic; Food Cost/
   Shift/Staff/Settings lower priority per earlier explicit ranking,
   though all 7 are in scope).

Each phase independently deployable/verifiable, dark mode ships within
each phase (not a trailing pass), matching this project's existing
phased-rollout convention.

## Out of Scope

- No backend/RPC/schema changes — purely presentational. (Exception:
  none needed — Shift's payment-breakdown-by-method and per-shift
  history detail are UI-only, since `get_shift_report()` already
  returns per-method data per CLAUDE.md; this is a "wire up data
  already available" task, not new backend work.)
- No color/hue changes — palette is fixed, only depth/shadow/typography/
  spacing evolve.
- No route/IA changes beyond what's already true today (Landing and
  Menu explicitly confirmed to stay separate routes).

## Verification Plan

- `npm run build` + `tsc` locally per phase.
- Push to `main`, verify each phase live at
  **https://phadincafe.vercel.app** — this project's standing
  convention over `npm run dev`.
- Per phase: both `vi`/`en` locales, dark/light toggle, existing
  function unchanged (cart math, RLS writes, Realtime, deferred
  payment), `prefers-reduced-motion` still collapses animations, actual
  phone-width testing (not just browser devtools resize) on at least
  one iOS Safari and one Android Chrome device given the explicit
  mobile-web requirement above, tap targets checked with a finger not
  just a mouse cursor.
