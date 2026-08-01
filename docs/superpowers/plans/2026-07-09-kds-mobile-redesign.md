# KDS Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kitchen Display System (`/staff/orders`) phone-adaptable:
below `md`, the 4-column board becomes a segmented-control single-column
switcher, the sidebar collapses into a compact top strip (nav + shift
stats), and the top bar/stats footer stop overflowing at phone width —
all while the desktop layout stays pixel-identical ≥`md`.

**Architecture:** `kitchen-board.tsx` gets local `activeColumn` state
driving a `SegmentedControl` (reused from `components/motion/`) and a
`hidden`/`flex`/`md:flex` visibility toggle per column, mirroring the
POS mobile redesign's proven pattern; the board container itself
switches `display` by breakpoint (`flex flex-col` mobile, `md:grid
md:grid-cols-4` desktop) rather than relying on CSS Grid's `auto` row
sizing for a single visible child. `kitchen-tables-column.tsx` gets a
matching `active` prop. `orders/layout.tsx` gains a `md:hidden` strip
carrying the sidebar's nav links + shift stats. `kitchen-top-bar.tsx`
and `kitchen-stats-footer.tsx` get breakpoint-scoped layout changes only
— no new state, no new components.

**Tech Stack:** Next.js/TypeScript/Tailwind, `components/motion/segmented-control.tsx`
(already built, already a dependency — used elsewhere for the customer
Menu category filter), next-intl (`KitchenDisplay` namespace — every
key this plan needs already exists, no translation-file changes). No
DB changes, no new routes, no new dependencies.

## Global Constraints

- Desktop (`md:` and up) layout must remain pixel-identical to today —
  every mobile-only class/element must be paired with an `md:`
  override that restores current behavior.
- No new translation keys — every label used below already exists in
  `messages/en.json`/`messages/vi.json`'s `KitchenDisplay` namespace
  (`columnNew`, `columnPreparing`, `columnReady`, `columnTables`,
  `liveOrders`, `orderHistoryNav`, `completedLabel`, `avgTimeLabel`,
  plus the stats footer's existing keys) — confirm with a grep before
  using any key, don't invent new ones.
- Verification is against the deployed Vercel URL
  (`https://phadincafe.vercel.app`), not `npm run dev`, per this
  project's standing convention. This project has no component-level
  (`.tsx`) test harness — only `lib/`/`hooks/` query-layer logic is
  unit-tested — so this plan has no new test files, matching the
  pattern already established by the POS mobile redesign plan
  (`docs/superpowers/plans/2026-07-09-pos-mobile-redesign.md`).
- Commit directly to `main` after each task, per this project's
  established convention for this session's staff/admin UI work.

---

### Task 1: Board — segmented-control column switcher

**Files:**
- Modify: `components/staff/kitchen-board.tsx`
- Modify: `components/staff/kitchen-tables-column.tsx`

**Interfaces:**
- Consumes: `SegmentedControl` from `components/motion/segmented-control.tsx`
  (`{ options, value, onChange, layoutId, variant, className }`, already
  exists — no changes to that file).
- Produces: `KitchenTablesColumn({ active: boolean })` — the `active`
  prop is new; every existing call site must be updated (only one
  exists, inside `kitchen-board.tsx`, updated in this same task).

- [ ] **Step 1: Add imports and the `activeColumn` state to `kitchen-board.tsx`**

Replace the import block:

```tsx
import { useLocale, useTranslations } from "next-intl"
import { Play, CheckCircle2, PackageCheck, Utensils, ShoppingBag, ListTodo, RefreshCw, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatOrderId } from "@/lib/format"
import { KitchenTablesColumn } from "@/components/staff/kitchen-tables-column"
import type { KdsStatus, KdsOrder } from "@/hooks/useKitchenOrders"
```

with:

```tsx
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Play, CheckCircle2, PackageCheck, Utensils, ShoppingBag, ListTodo, RefreshCw, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatOrderId } from "@/lib/format"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { KitchenTablesColumn } from "@/components/staff/kitchen-tables-column"
import type { KdsStatus, KdsOrder } from "@/hooks/useKitchenOrders"
```

After the `COLUMNS` array's closing `]`, add a new type:

```tsx
type BoardColumnKey = "paid" | "preparing" | "ready" | "tables"
```

Inside `KitchenBoard`, replace:

```tsx
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
```

with:

```tsx
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const [activeColumn, setActiveColumn] = useState<BoardColumnKey>("paid")
```

- [ ] **Step 2: Restructure the container and add the mobile `SegmentedControl`**

Replace:

```tsx
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden p-4 md:grid-cols-4">
      {COLUMNS.map((column) => {
```

with:

```tsx
  return (
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
      {COLUMNS.map((column) => {
```

- [ ] **Step 3: Gate each column's visibility on `activeColumn`**

Replace:

```tsx
          <section
            key={column.status}
            className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted"
          >
```

with:

```tsx
          <section
            key={column.status}
            className={cn(
              "h-full flex-col overflow-hidden rounded-xl border bg-muted",
              activeColumn === column.status ? "flex" : "hidden",
              "md:flex"
            )}
          >
```

- [ ] **Step 4: Pass `active` to `KitchenTablesColumn`**

Replace:

```tsx
      <KitchenTablesColumn />
    </div>
  )
}
```

with:

```tsx
      <KitchenTablesColumn active={activeColumn === "tables"} />
    </div>
  )
}
```

- [ ] **Step 5: Add the `active` prop to `kitchen-tables-column.tsx`**

Replace:

```tsx
export function KitchenTablesColumn() {
```

with:

```tsx
export function KitchenTablesColumn({ active }: { active: boolean }) {
```

Replace:

```tsx
    <section className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted">
```

with:

```tsx
    <section
      className={cn(
        "h-full flex-col overflow-hidden rounded-xl border bg-muted",
        active ? "flex" : "hidden",
        "md:flex"
      )}
    >
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/staff/kitchen-board.tsx components/staff/kitchen-tables-column.tsx
git commit -m "KDS: mobile segmented-control column switcher (New/Preparing/Ready/Tables)"
```

---

### Task 2: Sidebar collapse + mobile nav/stats strip

**Files:**
- Modify: `components/staff/kitchen-sidebar.tsx`
- Modify: `app/[locale]/staff/orders/layout.tsx`

**Interfaces:**
- Consumes: `KitchenSidebar({ completedCount, avgTimeLabel })` (unchanged
  signature); `useKitchenOrders()`'s `completedCount`/`avgTimeLabel`
  (already consumed by `orders/layout.tsx` today).

- [ ] **Step 1: Hide the sidebar below `md`**

In `components/staff/kitchen-sidebar.tsx`, replace:

```tsx
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/40 py-4">
```

with:

```tsx
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/40 py-4 md:flex">
```

- [ ] **Step 2: Add the mobile nav/stats strip to `orders/layout.tsx`**

Replace the full contents of `app/[locale]/staff/orders/layout.tsx`:

```tsx
"use client"

import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export default function StaffOrdersLayout({ children }: { children: React.ReactNode }) {
  const { completedCount, avgTimeLabel } = useKitchenOrders()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KitchenTopBar />
      <div className="flex flex-1 overflow-hidden">
        <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
```

with:

```tsx
"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Link, usePathname } from "@/i18n/navigation"
import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"

export default function StaffOrdersLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("KitchenDisplay")
  const pathname = usePathname()
  const isHistoryActive = pathname === "/staff/orders/history"
  const { completedCount, avgTimeLabel } = useKitchenOrders()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KitchenTopBar />
      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b bg-muted/40 px-3 py-2 md:hidden">
        <nav className="flex shrink-0 gap-1">
          <Link
            href="/staff/orders"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              !isHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground"
            )}
          >
            {t("liveOrders")}
          </Link>
          <Link
            href="/staff/orders/history"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              isHistoryActive ? "bg-secondary/20 text-secondary" : "text-muted-foreground"
            )}
          >
            {t("orderHistoryNav")}
          </Link>
        </nav>
        <div className="flex shrink-0 gap-3 text-[11px] text-muted-foreground">
          <span>
            {t("completedLabel")}: <strong className="text-card-foreground">{completedCount}</strong>
          </span>
          <span>
            {t("avgTimeLabel")}: <strong className="text-card-foreground">{avgTimeLabel}</strong>
          </span>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/staff/kitchen-sidebar.tsx "app/[locale]/staff/orders/layout.tsx"
git commit -m "KDS: hide sidebar below md, add mobile nav + shift-stats strip"
```

---

### Task 3: Top bar — responsive margin, hide inert buttons below `md`

**Files:**
- Modify: `components/staff/kitchen-top-bar.tsx`

**Interfaces:**
- None new — pure layout change, same props (`KitchenTopBar()` takes
  no arguments, unchanged).

- [ ] **Step 1: Replace the right-side action group**

Replace:

```tsx
      <div className="mr-52 flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <span className="text-xs text-muted-foreground">{t("systemOnline")}</span>
        </div>
        <button
          type="button"
          disabled
          title="Not implemented yet — no notification system"
          className="rounded-full p-2 text-muted-foreground opacity-50"
        >
          <Bell className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled
          title="Not implemented yet — no staff settings page"
          className="rounded-full p-2 text-muted-foreground opacity-50"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
```

with:

```tsx
      <div className="mr-16 flex items-center gap-3 md:mr-52">
        <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <span className="text-xs text-muted-foreground">{t("systemOnline")}</span>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            disabled
            title="Not implemented yet — no notification system"
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            title="Not implemented yet — no staff settings page"
            className="rounded-full p-2 text-muted-foreground opacity-50"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-top-bar.tsx
git commit -m "KDS top bar: responsive right-margin, hide inert Bell/Settings below md"
```

---

### Task 4: Stats footer — two rows below `md`

**Files:**
- Modify: `components/staff/kitchen-stats-footer.tsx`

**Interfaces:**
- None new — pure layout change, same props
  (`KitchenStatsFooter({ orders, now })`, unchanged).

- [ ] **Step 1: Replace the footer JSX**

Replace:

```tsx
  return (
    <footer className="flex h-12 shrink-0 items-center gap-8 rounded-xl border bg-muted px-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-muted-foreground">{t("currentLoad")}:</span>
        <div className="h-2 w-32 overflow-hidden rounded-full bg-border">
          <div className={cn("h-full transition-all", LOAD_STYLES[level].bar)} style={{ width: `${barWidth}%` }} />
        </div>
        <span className={cn("text-xs font-bold", LOAD_STYLES[level].text)}>{t(LOAD_STYLES[level].labelKey)}</span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {t("queueLabel")}: <strong className="text-card-foreground">{t("queueOrders", { count: activeCount })}</strong>
        </span>
        <span className="text-sm text-muted-foreground">
          {t("waitTimeLabel")}: <strong className="text-card-foreground">{t("waitTimeValue", { minutes: avgWaitMinutes })}</strong>
        </span>
      </div>
      <span className="ml-auto text-lg font-bold text-primary">{clock}</span>
    </footer>
  )
```

with:

```tsx
  return (
    <footer className="flex shrink-0 flex-col gap-2 rounded-xl border bg-muted px-4 py-3 md:h-12 md:flex-row md:items-center md:gap-8 md:px-6 md:py-0">
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
  )
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-stats-footer.tsx
git commit -m "KDS stats footer: two-row mobile layout, single row unchanged at md+"
```

---

### Task 5: Full verification

- [ ] **Step 1: Grep for stray unscoped margin/width values**

Run: `grep -n "mr-52\|w-64" components/staff/kitchen-top-bar.tsx components/staff/kitchen-sidebar.tsx`
Expected: `kitchen-top-bar.tsx` shows `mr-16 ... md:mr-52` (both present,
`mr-52` now `md:`-scoped); `kitchen-sidebar.tsx` shows `hidden w-64 ...
md:flex` (confirms the sidebar is never a layout box below `md`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests still PASS (this plan added no new test
files, per Global Constraints — this just confirms nothing else broke).

- [ ] **Step 4: Push to `main`**

```bash
git push
```

- [ ] **Step 5: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app/en/staff/orders`
(log in as `admin@phadincoffee.dev` or the staff test account):

- **Desktop regression check** (browser window ≥768px wide): confirm
  the 4-column grid (New/Preparing/Ready/Tables) and the full-width
  `w-64` sidebar look and behave exactly as before — no segmented
  control visible, top bar/stats footer unchanged.
- **Mobile board** (resize below 768px, or use device emulation):
  confirm the segmented control shows 4 options and only the New
  column's orders are visible initially; tap each option in turn and
  confirm exactly one column's content is visible at a time and it
  fills the available height (not squished); confirm the Tables
  column (reached via the "Tables" segment) shows the same table cards
  as desktop.
- **Mobile nav/stats strip**: confirm "Live Orders"/"Order History"
  links are visible below the top bar, the active one is visually
  highlighted, tapping "Order History" navigates and highlights
  correctly, and the two shift-stats (Completed, Avg. Time) are
  visible and legible.
- **Top bar**: confirm the online-status pill and the header's left
  content (brand + station label) don't visually collide with the
  fixed language-switcher pill in the top-right corner. If they still
  overlap in the screenshot, reduce `mr-16` (e.g. to `mr-20`/`mr-24`)
  in `kitchen-top-bar.tsx`, redeploy, and re-check — this was flagged
  in the design spec as needing live confirmation rather than a
  precomputed value.
- **Stats footer**: confirm all four data points (load bar/label,
  queue count, wait time, clock) are visible without any text clipping
  or horizontal overflow at 375–430px widths.
