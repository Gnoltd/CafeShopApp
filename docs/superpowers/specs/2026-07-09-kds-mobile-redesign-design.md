# KDS Mobile Redesign: Segmented-Control Column Switcher — Design

## Problem

The Kitchen Display System is laptop/PC-only, the second of three
sub-projects making staff/admin surfaces phone-adaptable (POS shipped
in `docs/superpowers/specs/2026-07-09-pos-mobile-redesign-design.md`;
Admin queued after this one). Unlike POS's single fixed-width sidebar
bug, KDS has no responsive treatment anywhere in its chrome:

- `kitchen-board.tsx`'s board grid (`components/staff/kitchen-board.tsx:42`)
  is `grid-cols-1 md:grid-cols-4` — below `md` this stacks all 4
  columns (New/Preparing/Ready/Tables) vertically in one grid track,
  but each column's own root is `h-full` inside an `auto`-sized grid
  row, which cannot resolve to a real height — the columns are not
  usably scrollable/sized on a phone today, not just visually cramped.
- `kitchen-sidebar.tsx` (`<aside className="flex w-64 shrink-0 ...">`)
  has no breakpoint at all — a fixed 256px sidebar on a ~390px phone
  viewport leaves almost nothing for the actual board.
- `kitchen-top-bar.tsx` reserves `mr-52` (208px) of margin on its
  right-hand action group to clear the fixed `LanguageSwitcher` pill —
  sized for desktop; at phone width this leaves too little room for
  the header's left+right content and they collide.
- `kitchen-stats-footer.tsx` is a single non-wrapping row
  (`flex ... gap-8`) with four segments (load bar, divider, queue/wait
  text, clock) — this will overflow horizontally on a phone.

## Goals

1. Below `md`, the board shows **one column at a time**
   (New/Preparing/Ready/Tables), switched via a horizontal
   segmented-control — reusing `components/motion/segmented-control.tsx`
   (`SegmentedControl`, `variant="tabs"`), the same primitive already
   used for the customer Menu's category filter. At/above `md`, the
   board is pixel-identical to today's 4-column grid.
2. The sidebar's 2 shift-stats (`completedLabel`, `avgTimeLabel`)
   collapse into a compact strip below `md`, together with its 2 real
   nav links (Live Orders, Order History) — both are real navigation/
   data, not optional chrome, so they need a mobile home, not just
   disappear with the sidebar.
3. The top bar and stats footer both get a mobile layout that doesn't
   overflow or collide with the fixed `LanguageSwitcher`, without
   changing what information they show (aside from Goal 4).
4. The two `kitchen-top-bar.tsx` action buttons (Bell, Settings) are
   already `disabled` with an explanatory `title` (this project's
   "disabled + tooltip" convention for unbacked actions) — hide them
   below `md` to reclaim header space, since they do nothing either way.

## Non-goals

- `/staff/orders/history`'s own content/table layout — out of scope.
  It shares `orders/layout.tsx` (top bar + sidebar chrome) with the
  live board, so it inherits Goals 2/3 for free, but its own page
  content is untouched.
- POS or Admin mobile redesigns — POS shipped, Admin queued next.
- The individual order-card markup inside `kitchen-board.tsx`
  (lines 65–161) — already a simple full-width block, no
  mobile-specific treatment needed; only column/board chrome changes.
- Any new translation keys — every label this redesign needs
  (`columnNew`, `columnPreparing`, `columnReady`, `columnTables`,
  `liveOrders`, `orderHistoryNav`, `completedLabel`, `avgTimeLabel`)
  already exists in the `KitchenDisplay` namespace.
- A real Stitch-generated mockup — abandoned project-wide per the
  Stitch auth dead-end recorded in `daily.md`; not revisited here.

## Design

### 1. Board: flex-column-and-toggle on mobile, unchanged grid on desktop

Relying on CSS Grid's `auto` row-sizing for a single visible child (as
today's `grid-cols-1` fallback implicitly does) is fragile — a grid
item's `h-full` cannot resolve against an `auto`-sized track. Instead,
`kitchen-board.tsx` switches `display` itself by breakpoint: `flex
flex-col` below `md` (a single visible flex child naturally fills
available height via `flex-1`, no ambiguity), `md:grid md:grid-cols-4`
at/above `md` (restoring today's exact grid). Only one child is
`display`-visible at a time below `md`; all four are always visible
at/above `md` regardless:

```tsx
type BoardColumnKey = "paid" | "preparing" | "ready" | "tables"

// inside KitchenBoard:
const [activeColumn, setActiveColumn] = useState<BoardColumnKey>("paid")

<div className="flex h-full flex-col gap-4 overflow-hidden p-4 md:grid md:grid-cols-4">
  <SegmentedControl
    variant="tabs"
    layoutId="kds-column-pill"
    className="shrink-0 md:hidden"
    value={activeColumn}
    onChange={setActiveColumn}
    options={[
      { value: "paid", label: t("columnNew") },
      { value: "preparing", label: t("columnPreparing") },
      { value: "ready", label: t("columnReady") },
      { value: "tables", label: t("columnTables") },
    ]}
  />
  {COLUMNS.map((column) => (
    <section
      key={column.status}
      className={cn(
        "h-full flex-col overflow-hidden rounded-xl border bg-muted",
        activeColumn === column.status ? "flex" : "hidden",
        "md:flex"
      )}
    >
      {/* unchanged column contents */}
    </section>
  ))}
  <KitchenTablesColumn active={activeColumn === "tables"} />
</div>
```

`BoardColumnKey` is deliberately narrower than the full `KdsStatus`
union (which also includes non-board statuses like `served`/
`completed`/`cancelled`) — it only names the 4 values this switcher
actually offers.

### 2. `KitchenTablesColumn` gets a visibility prop

Same `hidden`/`flex`/`md:flex` pattern as the status columns, since
it's a sibling grid/flex item with its own component boundary:

```tsx
export function KitchenTablesColumn({ active }: { active: boolean }) {
  // ...
  return (
    <section className={cn("h-full flex-col overflow-hidden rounded-xl border bg-muted", active ? "flex" : "hidden", "md:flex")}>
      {/* unchanged contents */}
    </section>
  )
}
```

### 3. Sidebar hidden below `md`; nav + stats move into a new mobile strip in `orders/layout.tsx`

`kitchen-sidebar.tsx`'s `<aside>` gets `hidden md:flex` added (same
POS-aside pattern), unchanged above `md`. Its 2 nav links and 2
shift-stats are real functionality that can't simply disappear, so
`orders/layout.tsx` (the shared composition point for both `/staff/orders`
and `/staff/orders/history`) grows a new `md:hidden` strip between
`KitchenTopBar` and the content area, reusing the same active/inactive
link styling already in the sidebar (just laid out horizontally
instead of stacked vertically) plus the 2 stats inline:

```tsx
<div className="flex h-full flex-col overflow-hidden">
  <KitchenTopBar />
  <div className="flex items-center justify-between gap-2 overflow-x-auto border-b bg-muted/40 px-3 py-2 md:hidden">
    <nav className="flex shrink-0 gap-1">
      <Link href="/staff/orders" className={cn("rounded-lg px-3 py-1.5 text-xs font-bold", !isHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground")}>
        {t("liveOrders")}
      </Link>
      <Link href="/staff/orders/history" className={cn("rounded-lg px-3 py-1.5 text-xs font-bold", isHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground")}>
        {t("orderHistoryNav")}
      </Link>
    </nav>
    <div className="flex shrink-0 gap-3 text-[11px] text-muted-foreground">
      <span>{t("completedLabel")}: <strong className="text-card-foreground">{completedCount}</strong></span>
      <span>{t("avgTimeLabel")}: <strong className="text-card-foreground">{avgTimeLabel}</strong></span>
    </div>
  </div>
  <div className="flex flex-1 overflow-hidden">
    <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} />
    <div className="flex-1 overflow-hidden">{children}</div>
  </div>
</div>
```

`isHistoryActive` (currently computed inside `kitchen-sidebar.tsx` via
`usePathname()`) is duplicated into `orders/layout.tsx` with the same
`usePathname() === "/staff/orders/history"` check — cheap, avoids
threading it as a prop for a one-line computation already sourced from
a hook available in both places.

### 4. Top bar: responsive margin, hide inert buttons below `md`

```tsx
<div className="mr-16 flex items-center gap-3 md:mr-52">
  <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-1.5">
    <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
    <span className="text-xs text-muted-foreground">{t("systemOnline")}</span>
  </div>
  <div className="hidden items-center gap-3 md:flex">
    {/* existing disabled Bell + Settings buttons, unchanged */}
  </div>
</div>
```

`mr-16` (64px) is a reasonable starting clearance for the fixed
`LanguageSwitcher` pill at phone width — confirmed/adjusted during live
verification (Section 6) rather than guessed further, since this is
an inherently visual fit that's cheap to eyeball on a real screenshot.

### 5. Stats footer: two rows below `md`, unchanged single row at/above `md`

```tsx
<footer className="flex flex-col gap-2 rounded-xl border bg-muted px-4 py-3 md:h-12 md:flex-row md:items-center md:gap-8 md:px-6 md:py-0">
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <span className="text-sm font-bold text-muted-foreground">{t("currentLoad")}:</span>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-border md:w-32">
        <div className={cn("h-full transition-all", LOAD_STYLES[level].bar)} style={{ width: `${barWidth}%` }} />
      </div>
      <span className={cn("text-xs font-bold", LOAD_STYLES[level].text)}>{t(LOAD_STYLES[level].labelKey)}</span>
    </div>
    <span className="text-base font-bold text-primary md:hidden">{clock}</span>
  </div>
  <div className="hidden h-4 w-px bg-border md:block" />
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    <span className="text-sm text-muted-foreground">
      {t("queueLabel")}: <strong className="text-card-foreground">{t("queueOrders", { count: activeCount })}</strong>
    </span>
    <span className="text-sm text-muted-foreground">
      {t("waitTimeLabel")}: <strong className="text-card-foreground">{t("waitTimeValue", { minutes: avgWaitMinutes })}</strong>
    </span>
  </div>
  <span className="ml-auto hidden text-lg font-bold text-primary md:block">{clock}</span>
</footer>
```

The clock renders in exactly one place per breakpoint (`md:hidden`
inline next to the load bar on mobile; `hidden md:block` at its
original `ml-auto` position at/above `md`) — never both, never neither.

### 6. Testing

Frontend-only, no schema/RPC changes — verified live per this
project's convention, same approach as the POS redesign (Playwright
against `https://phadincafe.vercel.app`, temporary/not committed):
confirm the desktop 4-column grid and full-width sidebar are pixel-
unchanged at ≥`md`; at phone width, confirm the segmented control
switches between New/Preparing/Ready/Tables with the right column
becoming visible each time (and only that one), confirm the mobile nav
strip's Live Orders/Order History links work and reflect the active
route, confirm the top bar's action group no longer collides with the
`LanguageSwitcher` pill (adjust `mr-16` if the screenshot still shows
overlap), and confirm the stats footer's two mobile rows don't
overflow or clip any of the four data points.

## Open questions resolved during brainstorming (prior sessions)

- **Segmented-control column switcher over any other collapse
  strategy**, reusing the customer Menu's category-filter primitive —
  locked in during the pre-Stitch brainstorming session recorded in
  `daily.md`, carried over unchanged.
- **Sidebar shift-stats collapse into a compact top strip** — also
  locked in from that session; extended during this design (not a new
  decision, a necessary consequence of the locked one) to include the
  sidebar's 2 nav links alongside the stats, since hiding the sidebar
  can't silently drop real navigation.
- **Top bar margin and stats footer overflow** — not called out in the
  original brainstorming (which focused on the board/sidebar), but
  both block KDS from being usable at phone width at all, so they're
  in scope as necessary side effects of "make KDS phone-adaptable,"
  not new design territory.
