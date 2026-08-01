# Admin Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Admin section (`/admin/*`) phone-adaptable: below
`md`, the fixed `w-64` sidebar becomes a hamburger-triggered slide-out
drawer with a new compact mobile header, while the desktop layout
stays pixel-identical ≥`md`. No admin page's own content needs
changes — every page already stacks correctly once it has full mobile
width.

**Architecture:** A new `SideDrawer` motion primitive
(`components/motion/side-drawer.tsx`) mirrors the existing
`BottomSheet` primitive's scrim+spring conventions, axis-flipped to
slide in from the left. `admin-sidebar.tsx`'s nav markup is extracted
into a local `AdminNavContent` component shared by the always-visible
desktop `<aside>` and the drawer, same extraction pattern already used
for POS's `OrderPanel` and KDS's column components. A new
`AdminMobileHeader` (left-aligned only, no right-side content) hosts
the hamburger trigger. `admin/layout.tsx` becomes a client component
holding the drawer's open/closed state, shared between the header and
sidebar via props.

**Tech Stack:** Next.js/TypeScript/Tailwind, `framer-motion`
(`AnimatePresence`/`motion.div`, already a dependency — see
`components/motion/bottom-sheet.tsx`), next-intl (`Nav` namespace,
one new key). No DB changes, no new routes, no new dependencies.

## Global Constraints

- Desktop (`md:` and up) layout must remain pixel-identical to today —
  every mobile-only class/element must be paired with an `md:`
  override that restores current behavior.
- **No changes to any admin page's own content file**
  (`dashboard-view.tsx`, `menu-management.tsx`, `tables-management.tsx`,
  `staff-accounts.tsx`, `food-cost-calculator.tsx`) — confirmed during
  design that each already stacks correctly below its existing
  breakpoints. This plan touches only the sidebar/header/layout shell.
- One new translation key, `Nav.openMenu`, added to **both**
  `messages/en.json` and `messages/vi.json` in the same task.
- Verification is against the deployed Vercel URL
  (`https://phadincafe.vercel.app`), not `npm run dev`, per this
  project's standing convention. This project has no component-level
  (`.tsx`) test harness — only `lib/`/`hooks/` query-layer logic is
  unit-tested — so this plan has no new test files, matching the
  pattern already established by the POS and KDS mobile redesign plans.
- Commit directly to `main` after each task, per this project's
  established convention for this session's staff/admin UI work.
- **Explicitly re-verify the new mobile header against the fixed
  `RoleBadge`+`LanguageSwitcher` cluster with exact
  `getBoundingClientRect()` measurement during live verification, not
  a screenshot glance** — the KDS mobile redesign needed 4 iterations
  to get this right, and the lesson (documented in `daily.md`) was
  that neither `margin` nor `padding` fixes an overlap once two flex
  items' combined content already exceeds the available space; the
  actual fix is keeping content narrow enough that slack exists. This
  header is left-aligned-only by design specifically to avoid that
  trap, but must still be measured, not assumed.

---

### Task 1: `SideDrawer` motion primitive

**Files:**
- Create: `components/motion/side-drawer.tsx`

**Interfaces:**
- Produces: `SideDrawer({ onClose: () => void, children: React.ReactNode })`
  — consumed by Task 4.

- [ ] **Step 1: Create the file**

```tsx
"use client"

import { AnimatePresence, motion, type PanInfo } from "framer-motion"

export function SideDrawer({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.x < -80 || info.velocity.x < -500) onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-stretch justify-start bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="flex h-full w-72 max-w-[80vw] flex-col overflow-hidden bg-card shadow-xl"
          initial={{ x: "-100%" }}
          animate={{ x: 0 }}
          exit={{ x: "-100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0.5, right: 0 }}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/motion/side-drawer.tsx
git commit -m "Add SideDrawer motion primitive (mirrors BottomSheet, axis-flipped to slide from the left)"
```

---

### Task 2: `Nav.openMenu` translation key

**Files:**
- Modify: `messages/en.json` (`Nav` namespace, line 18)
- Modify: `messages/vi.json` (`Nav` namespace, line 18)

**Interfaces:**
- Produces: `Nav.openMenu`, consumed by Task 4 (`AdminMobileHeader`).

- [ ] **Step 1: Add the key to `messages/en.json`**

Replace:

```json
    "foodCost": "Food Cost"
  },
```

with:

```json
    "foodCost": "Food Cost",
    "openMenu": "Open menu"
  },
```

- [ ] **Step 2: Add the key to `messages/vi.json`**

Replace:

```json
    "foodCost": "Chi Phí Thực Phẩm"
  },
```

with:

```json
    "foodCost": "Chi Phí Thực Phẩm",
    "openMenu": "Mở menu"
  },
```

- [ ] **Step 3: Verify both files still parse as valid JSON**

Run: `node -e "require('./messages/en.json'); require('./messages/vi.json'); console.log('ok')"`
Expected: prints `ok` with no error.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add Nav.openMenu translation key for the Admin mobile hamburger button"
```

---

### Task 3: `AdminMobileHeader`

**Files:**
- Create: `components/admin/admin-mobile-header.tsx`

**Interfaces:**
- Consumes: `Nav.openMenu` from Task 2.
- Produces: `AdminMobileHeader({ onOpenMenu: () => void })` — consumed
  by Task 4. Standalone and unreferenced until then — an unused
  exported component doesn't fail `tsc`/Next's build, so this is safe
  to land on its own first.

- [ ] **Step 1: Create the file**

```tsx
"use client"

import { useTranslations } from "next-intl"
import { Coffee, Menu } from "lucide-react"
import { Link } from "@/i18n/navigation"

export function AdminMobileHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 md:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={tNav("openMenu")}
        className="rounded-lg p-2 text-card-foreground transition-colors hover:bg-muted"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/" className="flex items-center gap-2 font-bold text-primary">
        <Coffee className="h-5 w-5" />
        {tBrand("name")}
      </Link>
    </header>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/admin-mobile-header.tsx
git commit -m "Add AdminMobileHeader: left-aligned hamburger + brand, md:hidden"
```

---

### Task 4: `admin-sidebar.tsx` + `admin/layout.tsx` — extract shared nav content, add drawer, wire up state

These two files must land in the same commit: `AdminSidebar`'s
signature changes from no-args to `{ open, onClose }`, and
`admin/layout.tsx` is its only call site. Landing them separately would
leave `main` non-typechecking (and therefore failing its Vercel build)
between commits, since this project pushes to `main` after every task.

**Files:**
- Modify: `components/admin/admin-sidebar.tsx`
- Modify: `app/[locale]/admin/layout.tsx`

**Interfaces:**
- Consumes: `SideDrawer` from Task 1; `AdminMobileHeader({ onOpenMenu })`
  from Task 3.
- Produces: `AdminSidebar({ open: boolean, onClose: () => void })` —
  signature changes from no-args.

- [ ] **Step 1: Replace the full contents of `admin-sidebar.tsx`**

Replace the entire contents of `components/admin/admin-sidebar.tsx`
(currently):

```tsx
"use client"

import { useTranslations } from "next-intl"
import {
  Coffee,
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  Table2,
  Users,
  Calculator,
  Settings,
  ShoppingCart,
  CookingPot,
} from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/admin/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/admin/inventory", labelKey: "inventory", icon: Package },
  { href: "/admin/tables", labelKey: "tables", icon: Table2 },
  { href: "/admin/staff", labelKey: "staff", icon: Users },
  { href: "/admin/food-cost", labelKey: "foodCost", icon: Calculator },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const

const FULFILLMENT_NAV_ITEMS = [
  { href: "/staff/pos", labelKey: "pos", icon: ShoppingCart },
  { href: "/staff/orders", labelKey: "kitchenDisplay", icon: CookingPot },
] as const

export function AdminSidebar() {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-card py-4">
      <Link href="/" className="mb-6 flex items-center gap-2 px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Coffee className="h-5 w-5" />
        </div>
        <span className="font-bold text-primary">{tBrand("name")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
      <nav className="space-y-1 border-t px-2 pt-3">
        {FULFILLMENT_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

with:

```tsx
"use client"

import { useTranslations } from "next-intl"
import {
  Coffee,
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  Table2,
  Users,
  Calculator,
  Settings,
  ShoppingCart,
  CookingPot,
} from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { SideDrawer } from "@/components/motion/side-drawer"

const NAV_ITEMS = [
  { href: "/admin/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/admin/inventory", labelKey: "inventory", icon: Package },
  { href: "/admin/tables", labelKey: "tables", icon: Table2 },
  { href: "/admin/staff", labelKey: "staff", icon: Users },
  { href: "/admin/food-cost", labelKey: "foodCost", icon: Calculator },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const

const FULFILLMENT_NAV_ITEMS = [
  { href: "/staff/pos", labelKey: "pos", icon: ShoppingCart },
  { href: "/staff/orders", labelKey: "kitchenDisplay", icon: CookingPot },
] as const

function AdminNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()

  return (
    <>
      <Link href="/" className="mb-6 flex items-center gap-2 px-4" onClick={onNavigate}>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Coffee className="h-5 w-5" />
        </div>
        <span className="font-bold text-primary">{tBrand("name")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
      <nav className="space-y-1 border-t px-2 pt-3">
        {FULFILLMENT_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-card py-4 md:flex">
        <AdminNavContent />
      </aside>
      {open && (
        <SideDrawer onClose={onClose}>
          <div className="flex h-full flex-col overflow-y-auto py-4">
            <AdminNavContent onNavigate={onClose} />
          </div>
        </SideDrawer>
      )}
    </>
  )
}
```

- [ ] **Step 2: Replace the full contents of `admin/layout.tsx`**

Replace the entire contents of `app/[locale]/admin/layout.tsx`
(currently):

```tsx
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { InventoryProvider } from "@/hooks/useInventory"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <InventoryProvider>
      <div className="flex h-screen overflow-hidden">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6 pt-16">{children}</main>
      </div>
    </InventoryProvider>
  )
}
```

with:

```tsx
"use client"

import { useState } from "react"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminMobileHeader } from "@/components/admin/admin-mobile-header"
import { InventoryProvider } from "@/hooks/useInventory"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  return (
    <InventoryProvider>
      <div className="flex h-screen flex-col overflow-hidden md:flex-row">
        <AdminMobileHeader onOpenMenu={() => setIsDrawerOpen(true)} />
        <AdminSidebar open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6 md:pt-16">{children}</main>
      </div>
    </InventoryProvider>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit both files together**

```bash
git add components/admin/admin-sidebar.tsx "app/[locale]/admin/layout.tsx"
git commit -m "Admin: sidebar becomes mobile drawer (AdminNavContent extraction), layout wires up open/close state"
```

---

### Task 5: Full verification

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests still PASS (this plan added no new test
files, per Global Constraints — this just confirms nothing else broke).

- [ ] **Step 3: Push to `main`**

```bash
git push
```

- [ ] **Step 4: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app/en/admin/dashboard`
(log in as `admin@phadincoffee.dev`):

- **Desktop regression check** (browser window ≥768px wide): confirm
  the fixed sidebar and its 9 links look and behave exactly as before
  — no hamburger button, no mobile header visible, `pt-16` clearance
  from the fixed badge cluster unchanged.
- **Mobile drawer** (resize below 768px, or use device emulation):
  confirm the new compact header (hamburger + brand) is visible with
  no sidebar; tap the hamburger, confirm the drawer slides in from the
  left with a scrim behind it and shows all 9 links (7 admin sections
  + 2 fulfillment shortcuts); tap a link, confirm it both navigates
  and closes the drawer; reopen the drawer and tap the scrim, confirm
  it closes without navigating; reopen and swipe the drawer left,
  confirm it dismisses.
- **Mobile header vs. fixed badge cluster**: using a Playwright script
  (temporary, not committed — same convention as the POS/KDS sessions),
  measure `getBoundingClientRect()` for both the header's rightmost
  content (the brand `Link`) and the fixed `RoleBadge`+`LanguageSwitcher`
  cluster (`div.fixed.top-2.right-2` in `app/[locale]/layout.tsx`).
  Confirm the header content's right edge is measurably less than the
  badge cluster's left edge (a real numeric comparison, not a visual
  glance) at a 390px-wide viewport. If they overlap, this is the same
  class of bug the KDS top bar hit — the fix is shrinking header
  content further (e.g. hiding the brand *text* below some width,
  keeping just the logo mark), not adding more margin/padding, per the
  Global Constraints note above.
- **Dashboard content at mobile width**: on the same mobile viewport,
  scroll through `/admin/dashboard` and confirm the KPI cards, revenue
  chart, best-sellers list, Inventory Status table, and Table Status
  card all render as a single readable column with no horizontal
  overflow or clipped text — confirming the Non-goals section's claim
  that this page needed no code changes, not just assuming it.
