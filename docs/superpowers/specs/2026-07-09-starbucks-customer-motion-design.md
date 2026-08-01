# Starbucks-Style Motion for Customer Pages (2026-07-09)

Add Starbucks-app-inspired **flow and motion** — page transitions, spring
interactions, gesture-driven sheets, animated progress/counters — across
every customer-facing page. Existing brand colors, layout content, and all
business logic (hooks, Supabase/RPC calls, Realtime subscriptions) stay
exactly as they are today. Reference is general knowledge of the Starbucks
iOS app's interaction language (the specific Mobbin case study the user
linked was auth-gated and could not be fetched), not an exact screen-by-
screen port.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Design reference | Mobbin link 403'd (login-gated); user approved working from general knowledge of the Starbucks app's motion language instead of exact screenshots |
| What changes | Flow/motion/interaction only — colors, copy, layout structure, and all function stay as-is |
| Scope | All customer pages (Menu, Product Detail, Cart, Checkout, Orders/Tracking, Order History, Profile, Loyalty) plus Bottom Nav |
| Motion library | Add **Framer Motion** (project currently has zero animation libraries beyond `tw-animate-css`) |
| Architecture | Shared reusable motion primitives (`components/motion/`), wired into existing components — a wrap, not a rewrite. Rejected: bespoke per-page animation (inconsistent feel, more code) and full page rebuilds (unnecessary risk to preserved business logic) |

## Motion primitives (`components/motion/`, new)

All are presentational only — no data dependencies, no knowledge of
Supabase/hooks. Each takes the same prop shape as whatever native element
it replaces, so call sites change by a few lines, not a rewrite.

| Primitive | Replaces / wraps | Behavior |
|---|---|---|
| `route-transition.tsx` | n/a (new, used by `template.tsx`) | Cross-fade + slight slide between pages via `AnimatePresence`. |
| `animated-tab-bar.tsx` | `bottom-nav.tsx`'s active-state styling | Active-tab indicator slides to the tapped icon (layout animation) instead of an instant color swap. |
| `segmented-control.tsx` | category chips, order-type toggle, pay-method toggle | `options`/`value`/`onChange` props; selected segment's background slides under the active label. |
| `bottom-sheet.tsx` | `quick-add-extras-popup.tsx`'s modal | Springs up from bottom, drag-down-to-dismiss with velocity, backdrop fades in sync. |
| `animated-counter.tsx` | cart totals, loyalty points, quantity stepper | Digits tween to the new value instead of snapping. |
| `stagger-list.tsx` | menu grid, cart items, order history rows, loyalty transactions | Children fade/slide in with a small stagger on mount/filter-change. |
| `press-feedback.tsx` | any tappable card/button | `whileTap={{ scale: 0.96 }}`. |
| `progress-ring.tsx` | Loyalty tier/points display | SVG stroke-dashoffset animates from old value to new. |
| `step-progress.tsx` | Order Tracking status bar | Animates the filled segment forward as `order_status` advances (still driven by the existing Realtime/poll state — only the transition between states is animated). |

**Reduced motion**: each primitive checks Framer Motion's `useReducedMotion()` and falls back to instant/opacity-only transitions, respecting the OS setting. The one exception carried over from the spotlight-hero precedent: nothing here is autonomous ambient motion, so there's no separate "disable entirely" case to design for.

## Per-page application

| Page / component | Motion applied |
|---|---|
| **Menu** (`menu-browser.tsx`) | Category chips → `SegmentedControl`. Item grid → `StaggerList` (re-triggers on category filter change). Item cards + quick-add "+" → `PressFeedback`. Header cart badge does a scale-pulse when item count changes. |
| **Product Detail** (`product-detail.tsx`) | Hero image does a shared-layout transition (`layoutId`) from the menu card it was opened from. Size/extras selection → `SegmentedControl`/`PressFeedback`. Sticky Add-to-Cart bar slides up on mount. |
| **Quick-add extras popup** (`quick-add-extras-popup.tsx`) | Rebuilt on `BottomSheet`. |
| **Cart** (`cart-view.tsx`) | Items → `StaggerList` on load. Swipe-to-delete (drag-x reveal) replaces the static remove button; removed items collapse height rather than vanish instantly. Totals → `AnimatedCounter`. |
| **Checkout** (`checkout-view.tsx`) | Pickup/Dine-in and Pay Now/Pay Later toggles → `SegmentedControl`. Sections slide in as they become active/enabled. |
| **Order Tracking** (`order-tracking.tsx`) | Status → `StepProgress`. Deferred-payment method picker → `SegmentedControl`. |
| **Order History** (`order-history.tsx`) | Rows → `StaggerList`; row-to-detail expansion reuses the shared-layout technique where applicable. |
| **Profile** (`profile-view.tsx`) | Inline-editable fields and logout button get `PressFeedback`. No structural change — fields remain local-state-only (existing documented gap). |
| **Loyalty** (`loyalty-view.tsx`) | Points balance → `AnimatedCounter`. Tier/points progress → `ProgressRing`. Transaction history → `StaggerList`. |
| **Bottom Nav** (`bottom-nav.tsx`) | Rebuilt on `AnimatedTabBar`. |
| **`app/[locale]/(customer)/template.tsx`** (new) | Wraps children in `RouteTransition` so navigation between the pages above cross-fades/slides instead of a hard cut. |

## Setup

- Add `framer-motion` to `package.json` — the only new runtime dependency.
- New files: the nine `components/motion/*.tsx` primitives, plus
  `app/[locale]/(customer)/template.tsx`.
- No changes to `hooks/useCart.tsx`, `hooks/useOrders.tsx`,
  `hooks/useTables.tsx`, `hooks/useKitchenOrders.tsx`, or any
  `lib/supabase/*.ts` query layer — motion primitives only wrap the JSX
  these already render.

## Rollout order

Each phase is independently shippable and verifiable:

1. Motion primitives + `template.tsx` route transitions (foundation, no existing page logic touched).
2. Menu + Product Detail + quick-add popup — highest-traffic flow, includes the riskiest piece (the shared-element transition), done early.
3. Cart + Checkout.
4. Order Tracking + Order History.
5. Profile + Loyalty.

## Out of scope

- No color/theme changes (brand tokens in `app/globals.css` untouched).
- No new pages or route structure changes beyond the new `template.tsx`.
- No backend/RPC/schema changes.
- No change to any hook's internal logic or data-fetching behavior.
- Not an exact recreation of the linked Mobbin screens (inaccessible) —
  general Starbucks-app motion language only.
- Staff/Admin pages are untouched — customer-facing pages only.

## Verification

Per this project's standing convention: `npm run build` + `tsc` locally
for fast feedback, then push to `main` and verify on
**https://phadincafe.vercel.app**. For each rollout phase: click through
the flow in both `vi`/`en` locales, confirm existing function is
unchanged (cart math, RLS-gated writes, Realtime order-status updates,
deferred-payment flow), and confirm OS-level reduced-motion collapses
animations correctly. No new automated test framework — this is a
presentational layer over already-tested data logic.
