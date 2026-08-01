# POS Mobile Redesign: Menu ⇄ Order Page-Swap — Design

## Problem

`components/staff/pos-terminal.tsx` is laptop/PC-only: a `flex h-full`
two-pane layout with the menu grid `flex-1` on the left and the order
ticket pinned at a fixed `w-[380px]` on the right (`pos-terminal.tsx:194`).
On a phone-width viewport the fixed-width aside either pushes the menu
grid off-screen or the two panes squeeze illegibly — there's no
responsive collapse at all. This is the first of three sub-projects
making staff/admin surfaces phone-adaptable (KDS and Admin follow,
each as their own spec/plan cycle).

Live Stitch generation (`generate_screen_from_text`) was explored as a
way to get a real mobile mockup before building, but both MCP
connectors are blocked on broken auth (401 on the API key across all
three places it's stored; 403 on the OAuth/ADC fallback due to a
missing IAM permission on its auto-created GCP project) — both dead
ends requiring a console fix only the user can make. This spec proceeds
without a generated mockup, using the existing desktop Stitch export
(`design/stitch-exports/10-staff-pos.html`) and this project's brand
tokens as the visual reference instead. See `daily.md` for the full
Stitch dead-end narrative.

## Goals

1. Below the `md` breakpoint, POS becomes a single-pane "Menu ⇄ Order"
   page-swap — the same visual/motion language as the customer's
   Menu→Cart flow — instead of a bottom sheet or persistent
   draggable panel (both rejected during brainstorming as harder to
   use one-handed at a busy counter).
2. Above `md`, today's two-pane desktop layout is pixel-identical to
   now — this is a pure additive/responsive change, not a rewrite.
3. The Order view's Charge button is a sticky bottom bar, not
   end-of-scroll — a staff member mid-order shouldn't have to scroll
   past every line item to charge.
4. A staff member always has a one-tap way back to the menu from the
   Order view, and a visible order-count/subtotal affordance from the
   Menu view to know a ticket is in progress without switching views.

## Non-goals

- Any change to POS's known gap (no size/modifier picker, base-price
  only) — out of scope, tracked separately in `CLAUDE.md`.
- KDS or Admin mobile redesigns — queued next, each its own spec/plan.
- `StaffNav` (`components/staff/staff-nav.tsx`) — only 2 links (POS,
  Kitchen Display) in a plain flex row; doesn't overflow at phone
  widths, no hamburger/drawer treatment needed (unlike Admin's 7-link
  sidebar, which does).
- A real Stitch-generated mockup — see Problem section; can be
  revisited later if the user resolves the Stitch auth blockers, but
  isn't a prerequisite for shipping this.

## Design

### 1. Layout: CSS breakpoint owns desktop/mobile split, local state owns which mobile view is showing

`pos-terminal.tsx` gets one new piece of state:

```tsx
const [mobileView, setMobileView] = useState<"menu" | "order">("menu")
```

This state is **only consulted below `md`** — every class that reads it
is paired with an `md:` override that ignores it, so desktop is
guaranteed to always render both panes exactly as today regardless of
`mobileView`'s value. Concretely:

- Menu pane wrapper: `mobileView === "order" ? "hidden md:flex" : "flex"`
  (mobile: menu hidden while Order is showing; desktop: always `flex`).
- Order pane: rendered twice — once as today's `<aside>` with
  `hidden md:flex md:w-[380px] ...` added (always visible ≥`md`, never
  rendered as a layout box below `md`), and once as a mobile-only
  full-screen overlay (`fixed inset-0 z-30 ... md:hidden`) that only
  mounts when `mobileView === "order"`, animated in/out with
  `AnimatePresence`.

Both `<aside>` instances render the same order content — see Section 3
for de-duplication.

### 2. Motion: reuse `RouteTransition`'s exact curve, keyed on local state instead of `pathname`

The customer Menu→Cart swap (`components/motion/route-transition.tsx`)
animates real route changes, keyed on `usePathname()`. POS has no
`/staff/pos/menu` + `/staff/pos/order` routes — adding them would
mean a full page remount losing in-progress ticket state, which is
worse than the current bug. Instead, the mobile Order overlay uses the
identical `AnimatePresence`/`motion.div` shape and timing constants
(`opacity 0→1`, `x 20→0`, `duration: 0.32`, `ease: [0.16, 1, 0.3, 1]`)
inline in `pos-terminal.tsx`, keyed on `mobileView` instead of
`pathname` — same visual language, no route restructuring:

```tsx
<AnimatePresence>
  {mobileView === "order" && (
    <motion.div
      key="order"
      className="fixed inset-0 z-30 flex flex-col bg-muted md:hidden"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <OrderPanel onBack={() => setMobileView("menu")} {...panelProps} />
    </motion.div>
  )}
</AnimatePresence>
```

### 3. De-duplication: extract `OrderPanel` as a local subcomponent

Today's order-ticket JSX (`pos-terminal.tsx:194–351`: header, line-item
list, type/table selector, payment method picker, subtotal/tax, Charge
button) is extracted into an `OrderPanel` component in the same file,
taking the existing local state/handlers as props (`order`,
`updateQuantity`, `orderType`, `setOrderType`, `selectedTableId`,
`setSelectedTableId`, `tables`, `paymentMethod`, `setPaymentMethod`,
`subtotal`, `tax`, `total`, `chargeError`, `isCharging`, `handleCharge`,
`clearOrder`) plus one new optional prop:

```tsx
function OrderPanel({ onBack, ...existingProps }: { onBack?: () => void; /* ... */ }) {
  return (
    <>
      <div className="flex items-center justify-between border-b bg-card p-4">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t("backToMenu")} className="...">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h2 className="text-lg font-bold text-card-foreground">{t("orderTitle")}</h2>
        {/* existing clear-order button */}
      </div>
      {/* existing line-item list, unchanged */}
      {/* existing type/table/payment/totals footer, unchanged */}
    </>
  )
}
```

`onBack` is only passed by the mobile overlay call site — the desktop
`<aside>` call site omits it, so the back arrow never renders ≥`md`
(matching today's header exactly). This is a pure extraction: no
behavior changes to charging, quantity editing, or payment-method
selection — same handlers, same RPC call, same `handle-order` Edge
Function path.

### 4. Mobile-only "View Order" sticky bar on the Menu view

When `mobileView === "menu"` and `order.length > 0`, a sticky bottom
bar appears over the menu grid (`fixed bottom-0 inset-x-0 z-20 md:hidden`,
matching the brand's primary-color CTA treatment used elsewhere,
e.g. the customer cart's sticky checkout bar):

```tsx
{mobileView === "menu" && order.length > 0 && (
  <button
    type="button"
    onClick={() => setMobileView("order")}
    className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg md:hidden"
  >
    <span className="text-sm font-bold">
      {t("viewOrder", { count: order.reduce((n, l) => n + l.quantity, 0) })}
    </span>
    <span className="text-sm font-bold">{formatVND(total)}</span>
  </button>
)}
```

The menu grid's scroll container gets bottom padding (`pb-24`) below
`md` only, so the last row of items isn't hidden behind this bar.

### 5. New translation keys

Flat additions to the existing `"Pos"` namespace (both `messages/en.json`
and `messages/vi.json`, matching its current un-nested shape):
`backToMenu`, `viewOrder` (ICU plural/count-interpolated, e.g.
`"View Order ({count})"` / `"Xem đơn ({count})"`).

### 6. Testing

Frontend-only, no schema/RPC changes — verified live per this
project's convention (`https://phadincafe.vercel.app`, not
`npm run dev`): resize to a phone width, confirm the two-pane desktop
layout is untouched ≥`md` (no regression), add items from the Menu
view below `md`, confirm the sticky "View Order" bar appears with the
correct count/total, tap it, confirm the swap animation and that the
Order view shows the same ticket state, tap back, confirm return to
Menu with scroll position/category selection preserved (both views
share the same component tree — no remount), complete a full Charge
flow from the mobile Order view and confirm the order lands correctly
(same `place-order` Edge Function path as desktop, so this is mainly
confirming the UI wiring didn't break the existing call).

## Open questions resolved during brainstorming (prior sessions)

- **"Menu ⇄ Order" page-swap over a bottom-sheet or persistent
  draggable panel** — approved layout approach, carried over unchanged
  from the pre-Stitch brainstorming session recorded in `daily.md`.
- **Charge as a sticky bottom bar, not end-of-scroll** — locked in
  alongside the page-swap decision.
- **Scope is POS first, KDS and Admin queued after** — reverting to
  this original one-sub-project-at-a-time sequencing now that the
  "all three in one Stitch-generation pass" plan (which depended on
  live generation working) is moot.
