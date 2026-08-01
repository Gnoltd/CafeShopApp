# Admin/KDS/POS Nav Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two missing cross-navigation links (KDS → POS, and POS/KDS → Admin for manager/admin) so all three of Admin/KDS/POS can reach each other when the current user has permission, matching what Admin → POS/KDS already does today.

**Architecture:** A new shared `canAccessAdmin(role)` predicate in `lib/roles.ts` gates the Admin link consistently across three call sites. `StaffNav` and `KitchenSidebar` both gain a `role` prop and use it to conditionally render an Admin link; `KitchenSidebar` also gains an unconditional POS link. `app/[locale]/staff/orders/layout.tsx` is split into a thin async server layout (fetches role via the existing `getCurrentRole`) plus a new `StaffOrdersLayoutClient` component (all the existing client logic, now taking `role` as a prop). `staff/pos/page.tsx` (already async/server) fetches role the same way and passes it to `StaffNav`.

**Tech Stack:** Next.js App Router (server/client component split), existing `lib/get-current-role.ts` helper, Vitest for the one new pure-function test.

## Global Constraints

- Role is always re-resolved server-side per request, never cached client-side (CLAUDE.md convention).
- New/changed user-facing strings go in both `messages/en.json` and `messages/vi.json` — **not needed here**, this plan reuses the existing `Nav.dashboard` key.
- Follow each surface's existing nav idiom rather than introducing a new shared "switcher" component — `StaffNav`'s pill row, `KitchenSidebar`'s icon list + bordered section (mirroring `AdminSidebar`'s own Fulfillment section), and the mobile pill strip all stay as they are, just gain items.
- Verify against the deployed Vercel URL (`https://phadincafe.vercel.app`), not just `npm run dev`.

---

### Task 1: `canAccessAdmin` helper in `lib/roles.ts`

**Files:**
- Modify: `lib/roles.ts`
- Test: `lib/roles.test.ts` (new)

**Interfaces:**
- Produces: `canAccessAdmin(role: string | null): boolean` — consumed by Tasks 2, 3, and 4.

- [ ] **Step 1: Write the failing test**

Create `lib/roles.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { canAccessAdmin } from "./roles"

describe("canAccessAdmin", () => {
  it("returns true for manager", () => {
    expect(canAccessAdmin("manager")).toBe(true)
  })

  it("returns true for admin", () => {
    expect(canAccessAdmin("admin")).toBe(true)
  })

  it("returns false for staff", () => {
    expect(canAccessAdmin("staff")).toBe(false)
  })

  it("returns false for customer", () => {
    expect(canAccessAdmin("customer")).toBe(false)
  })

  it("returns false for null (logged out)", () => {
    expect(canAccessAdmin(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/roles.test.ts`
Expected: FAIL — `canAccessAdmin` is not exported from `./roles`.

- [ ] **Step 3: Add the implementation**

In `lib/roles.ts`, add below the existing `ROLE_HOME` export:

```ts
export const ROLE_HOME: Record<string, string> = {
  customer: "/menu",
  staff: "/staff/pos",
  manager: "/admin/dashboard",
  admin: "/admin/dashboard",
}

export function canAccessAdmin(role: string | null): boolean {
  return role === "manager" || role === "admin"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/roles.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/roles.ts lib/roles.test.ts
git commit -m "Add canAccessAdmin helper for nav-link role gating"
```

---

### Task 2: `StaffNav` gains a role-gated Admin link

**Files:**
- Modify: `components/staff/staff-nav.tsx`

**Interfaces:**
- Consumes: `canAccessAdmin` from `@/lib/roles` (Task 1).
- Produces: `StaffNav({ role }: { role: string | null })` — consumed by Task 5 (`pos/page.tsx`).

- [ ] **Step 1: Add the `role` prop and conditional nav item**

Replace the full contents of `components/staff/staff-nav.tsx`:

```tsx
"use client"

import { useTranslations } from "next-intl"
import { Coffee } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { canAccessAdmin } from "@/lib/roles"

const NAV_ITEMS = [
  { href: "/staff/pos", labelKey: "pos" },
  { href: "/staff/orders", labelKey: "kitchenDisplay" },
] as const

export function StaffNav({ role = null }: { role?: string | null }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()

  const navItems = canAccessAdmin(role)
    ? [...NAV_ITEMS, { href: "/admin/dashboard", labelKey: "dashboard" } as const]
    : NAV_ITEMS

  return (
    <header className="flex min-h-14 shrink-0 flex-col items-start gap-5 border-b bg-card px-4 py-2 md:flex-row md:items-center md:gap-6 md:py-0">
      <Link href="/" className="flex items-center gap-2 font-semibold text-primary">
        <Coffee className="h-5 w-5" />
        {tBrand("name")}
      </Link>
      <nav className="flex gap-2">
        {navItems.map(({ href, labelKey }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              pathname === href
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {tNav(labelKey)}
          </Link>
        ))}
      </nav>
    </header>
  )
}
```

(`role` defaults to `null` so any not-yet-updated caller doesn't break — Task 5 will pass the real value.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/staff/staff-nav.tsx
git commit -m "StaffNav: add role-gated Admin link"
```

---

### Task 3: `KitchenSidebar` gains a POS link + role-gated Admin link

**Files:**
- Modify: `components/staff/kitchen-sidebar.tsx`

**Interfaces:**
- Consumes: `canAccessAdmin` from `@/lib/roles` (Task 1).
- Produces: `KitchenSidebar({ completedCount, avgTimeLabel, role }: { completedCount: number; avgTimeLabel: string; role: string | null })` — consumed by Task 4.

- [ ] **Step 1: Add the `role` prop and a new bordered nav section**

Replace the full contents of `components/staff/kitchen-sidebar.tsx`:

```tsx
"use client"

import { useTranslations } from "next-intl"
import { CookingPot, Gauge, History, Boxes, ShoppingCart, LayoutDashboard } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { canAccessAdmin } from "@/lib/roles"

export function KitchenSidebar({
  completedCount,
  avgTimeLabel,
  role,
}: {
  completedCount: number
  avgTimeLabel: string
  role: string | null
}) {
  const t = useTranslations("KitchenDisplay")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()
  const isHistoryActive = pathname === "/staff/orders/history"

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/40 py-4 md:flex">
      <div className="flex items-center gap-3 px-6 pb-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary">
          <CookingPot className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-card-foreground">{t("terminalName")}</p>
          <p className="text-xs text-muted-foreground">{t("terminalSubtitle")}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        <Link
          href="/staff/orders"
          className={
            !isHistoryActive
              ? "flex items-center gap-3 rounded-lg bg-secondary/20 px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <Gauge className="h-4 w-4" />
          {t("liveOrders")}
        </Link>
        <Link
          href="/staff/orders/history"
          className={
            isHistoryActive
              ? "flex items-center gap-3 rounded-lg bg-secondary/20 px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <History className="h-4 w-4" />
          {t("orderHistoryNav")}
        </Link>
        <button
          type="button"
          disabled
          title="Not implemented yet — Inventory is manager/admin-only"
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground opacity-60"
        >
          <Boxes className="h-4 w-4" />
          {t("inventoryNav")}
        </button>
      </nav>

      <nav className="space-y-1 border-t px-2 pt-3">
        <Link
          href="/staff/pos"
          className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
        >
          <ShoppingCart className="h-4 w-4" />
          {tNav("pos")}
        </Link>
        {canAccessAdmin(role) && (
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          >
            <LayoutDashboard className="h-4 w-4" />
            {tNav("dashboard")}
          </Link>
        )}
      </nav>

      <div className="mx-2 mt-auto rounded-xl border bg-card p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t("shiftStats")}
        </p>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("completedLabel")}:</span>
          <span className="font-bold text-card-foreground">{completedCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("avgTimeLabel")}:</span>
          <span className="font-bold text-card-foreground">{avgTimeLabel}</span>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails at this point with a missing-prop error at `KitchenSidebar`'s call site in `orders/layout.tsx` — expected, Task 4 fixes it. Confirm the error is exactly that (a missing `role` prop), not something else.

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-sidebar.tsx
git commit -m "KitchenSidebar: add POS link and role-gated Admin link"
```

---

### Task 4: Split `orders/layout.tsx` into server + client, wire `role` through

**Files:**
- Create: `components/staff/staff-orders-layout-client.tsx`
- Modify: `app/[locale]/staff/orders/layout.tsx` (replaced entirely — becomes the server wrapper)

**Interfaces:**
- Consumes: `getCurrentRole` from `@/lib/get-current-role`, `canAccessAdmin` from `@/lib/roles` (Task 1), `KitchenSidebar` with its new `role` prop (Task 3).
- Produces: `StaffOrdersLayoutClient({ children, role }: { children: React.ReactNode; role: string | null })`.

- [ ] **Step 1: Create the client component with the existing layout's logic, plus mobile nav additions**

Create `components/staff/staff-orders-layout-client.tsx`:

```tsx
"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Link, usePathname } from "@/i18n/navigation"
import { KitchenTopBar } from "@/components/staff/kitchen-top-bar"
import { KitchenSidebar } from "@/components/staff/kitchen-sidebar"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { canAccessAdmin } from "@/lib/roles"

export function StaffOrdersLayoutClient({
  children,
  role,
}: {
  children: React.ReactNode
  role: string | null
}) {
  const t = useTranslations("KitchenDisplay")
  const tNav = useTranslations("Nav")
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
          <Link href="/staff/pos" className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground">
            {tNav("pos")}
          </Link>
          {canAccessAdmin(role) && (
            <Link href="/admin/dashboard" className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground">
              {tNav("dashboard")}
            </Link>
          )}
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
        <KitchenSidebar completedCount={completedCount} avgTimeLabel={avgTimeLabel} role={role} />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace `layout.tsx` with a thin async server wrapper**

Replace the full contents of `app/[locale]/staff/orders/layout.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"

export default async function StaffOrdersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  return <StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — this resolves the missing-prop error from Task 3, Step 2.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no test touches these files directly, but confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add components/staff/staff-orders-layout-client.tsx app/[locale]/staff/orders/layout.tsx
git commit -m "Split staff/orders layout into server (role fetch) + client, add mobile nav links"
```

---

### Task 5: `pos/page.tsx` passes real role to `StaffNav`

**Files:**
- Modify: `app/[locale]/staff/pos/page.tsx`

**Interfaces:**
- Consumes: `getCurrentRole` from `@/lib/get-current-role`; `StaffNav`'s `role` prop (Task 2).

- [ ] **Step 1: Fetch role alongside the existing menu data and pass it to `StaffNav`**

Replace the full contents of `app/[locale]/staff/pos/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { StaffNav } from "@/components/staff/staff-nav"
import { PosTerminal } from "@/components/staff/pos-terminal"
import { createClient } from "@/lib/supabase/server"
import { getCategories, getMenuItems } from "@/lib/supabase/menu-data"
import { getCurrentRole } from "@/lib/get-current-role"

export default async function PosPage() {
  const t = await getTranslations("Staff")
  const supabase = await createClient()
  const [categories, items, role] = await Promise.all([
    getCategories(supabase),
    getMenuItems(supabase),
    getCurrentRole(supabase),
  ])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{t("posTitle")}</h1>
      <StaffNav role={role} />
      <div className="flex-1 overflow-hidden">
        <PosTerminal categories={categories} items={items} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and production build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx next build`
Expected: builds clean, no new warnings beyond the pre-existing "middleware deprecated" one.

- [ ] **Step 3: Commit**

```bash
git add "app/[locale]/staff/pos/page.tsx"
git commit -m "POS page: pass real server-resolved role to StaffNav"
```

---

### Task 6: Live verification and daily.md update

**Files:**
- Modify: `daily.md`

- [ ] **Step 1: Push and wait for the Vercel deploy**

```bash
git push
```

Wait ~60-90s for `main`'s auto-deploy to finish.

- [ ] **Step 2: Live-verify on `https://phadincafe.vercel.app`**

Using the accounts in `test-accounts.md` (credentials via `.env.local` — never hardcode a password into a script file):

1. **Staff account**, at `/staff/pos`: confirm the nav shows only POS/KDS pills, no Admin.
2. **Staff account**, at `/staff/orders`: confirm the desktop sidebar's new bottom section shows only a POS link (no Admin), and the mobile-width nav strip (resize to ~390px) shows the same — POS pill present, no Admin pill.
3. **Admin account**, at `/staff/pos`: confirm the nav now shows POS/KDS/Admin, and clicking Admin lands on `/admin/dashboard`.
4. **Admin account**, at `/staff/orders`: confirm the desktop sidebar's new section shows POS + Admin, both navigate correctly; confirm the mobile strip (resize to ~390px) shows the same two pills.
5. **Admin account**, at `/admin/dashboard`: confirm the existing Fulfillment section (POS/KDS links) is visually unchanged.

- [ ] **Step 3: Update `daily.md`**

Add a new dated entry at the top of `daily.md` (matching its existing newest-first convention) describing: what was missing (KDS had no POS link at all; POS/KDS had no Admin link), what turned out to already exist (Admin→POS/KDS, POS→KDS), the `canAccessAdmin` role gate, the server/client layout split for KDS's role resolution, and the live verification steps confirmed above.

- [ ] **Step 4: Commit and push**

```bash
git add daily.md
git commit -m "Docs: log Admin/KDS/POS nav switcher feature"
git push
```
