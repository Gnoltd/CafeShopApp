# Starbucks-Style Customer Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Starbucks-app-inspired flow/motion (page transitions, springy interactions, gesture sheets, animated counters/progress) across every customer-facing page, per `docs/superpowers/specs/2026-07-09-starbucks-customer-motion-design.md`, without changing any color, copy, layout content, or business logic.

**Architecture:** A new `components/motion/` folder holds nine framework-agnostic (no data/hook dependencies) Framer Motion primitives. Each existing customer component is wired to use them by replacing plain JSX elements with the primitive that has an equivalent prop shape — never touching the surrounding hooks (`useCart`, `useOrders`, `useTables`) or Supabase calls. Reduced motion is handled once, globally, via Framer Motion's `<MotionConfig reducedMotion="user">`.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, `framer-motion` (new dependency), next-intl.

## Global Constraints

- No color/theme changes — every className string that isn't motion-related is copied verbatim from the current file.
- No changes to hook internals: `hooks/useCart.tsx`, `hooks/useOrders.tsx`, `hooks/useTables.tsx` are read-only for this plan.
- No changes to any Supabase/RPC/Edge Function call.
- Every primitive lives in `components/motion/` and takes props shaped like the native element it replaces (documented per-primitive below).
- Reduced motion is handled once, in `app/[locale]/(customer)/layout.tsx`, via `<MotionConfig reducedMotion="user">` — no per-primitive `useReducedMotion()` checks needed.
- Verification source of truth is the live Vercel deployment (https://phadincafe.vercel.app), per project convention — `npm run build` + `tsc` locally are fast-feedback only.
- **Deviation from the design doc**: the design doc names a new `app/[locale]/(customer)/template.tsx` for route transitions. On closer inspection, Next.js `template.tsx` fully remounts per navigation, which defeats `AnimatePresence`'s need for a stable parent to animate an exit before removal. Task 3 instead wraps `{children}` directly in the existing (already-stable) `app/[locale]/(customer)/layout.tsx`. Functionally identical outcome, more correct implementation.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `framer-motion` dependency |
| `components/motion/press-feedback.tsx` | Create | `PressFeedback` (motion.button) + shared `TAP_SCALE`/`TAP_TRANSITION` constants for non-button tap targets |
| `components/motion/segmented-control.tsx` | Create | `SegmentedControl` — animated pill/background that slides between selected options, "tabs" and "chips" variants |
| `components/motion/stagger-list.tsx` | Create | `StaggerList` + `StaggerItem` — staggered mount-in and animated exit for list items |
| `components/motion/bottom-sheet.tsx` | Create | `BottomSheet` — spring-up sheet with drag-to-dismiss |
| `components/motion/animated-counter.tsx` | Create | `AnimatedCounter` — tweens a formatted number between values |
| `components/motion/progress-ring.tsx` | Create | `ProgressRing` — animated circular SVG progress |
| `components/motion/step-progress.tsx` | Create | `StepProgress` — animated horizontal step/status bar |
| `components/motion/animated-tab-bar.tsx` | Create | `AnimatedTabBar` — bottom nav with a sliding active-tab pill |
| `components/motion/route-transition.tsx` | Create | `RouteTransition` — cross-fade/slide wrapper keyed on pathname |
| `app/[locale]/(customer)/layout.tsx` | Modify | Wrap `{children}` in `MotionConfig` + `RouteTransition` |
| `components/customer/bottom-nav.tsx` | Modify | Rebuilt on `AnimatedTabBar` |
| `components/customer/menu-browser.tsx` | Modify | Category chips → `SegmentedControl`; item grid → `StaggerList`/`StaggerItem`; quick-add "+" tap feedback; cart badge pulse; hero-image `layoutId` |
| `components/customer/product-detail.tsx` | Modify | Hero image `layoutId` shared transition; size picker → `SegmentedControl`; modifier/add-to-cart buttons → `PressFeedback` |
| `components/customer/quick-add-extras-popup.tsx` | Modify | Rebuilt on `BottomSheet` |
| `components/customer/cart-view.tsx` | Modify | `StaggerList`/`StaggerItem` with swipe-to-delete drag; totals → `AnimatedCounter` |
| `components/customer/checkout-view.tsx` | Modify | Order-type and Pay-timing toggles → `SegmentedControl`; payment method buttons → `PressFeedback` |
| `components/customer/order-tracking.tsx` | Modify | Status bar → `StepProgress`; payment-method buttons → `PressFeedback` |
| `components/customer/order-history.tsx` | Modify | Filter toggle → `SegmentedControl`; rows → `StaggerList`/`StaggerItem` |
| `components/customer/profile-view.tsx` | Modify | Edit/save/cancel/logout buttons → `PressFeedback` |
| `components/customer/loyalty-view.tsx` | Modify | Balance → `AnimatedCounter`; tier progress → `ProgressRing`; transactions → `StaggerList`/`StaggerItem` |

---

### Task 1: Add `framer-motion` dependency

**Files:**
- Modify: `package.json:12-29`

**Interfaces:**
- Consumes: nothing.
- Produces: the `framer-motion` package, importable by every later task.

- [ ] **Step 1: Install the package**

Run: `npm install framer-motion`
Expected: `package.json`'s `"dependencies"` gains a `"framer-motion": "^..."` line; `package-lock.json` updates.

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build`
Expected: build succeeds (package installed but unused so far).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add framer-motion dependency for customer-page motion"
```

---

### Task 2: `PressFeedback`, `SegmentedControl`, `StaggerList` primitives

**Files:**
- Create: `components/motion/press-feedback.tsx`
- Create: `components/motion/segmented-control.tsx`
- Create: `components/motion/stagger-list.tsx`

**Interfaces:**
- Consumes: `framer-motion` (Task 1).
- Produces:
  - `PressFeedback` — a `forwardRef` motion button accepting all native `<button>` props (`type`, `onClick`, `disabled`, `className`, `children`, etc.) plus `TAP_SCALE`/`TAP_TRANSITION` constants exported for non-button tap targets.
  - `SegmentedControl<T extends string>({ options, value, onChange, layoutId, variant, className })` where `options: { value: T; label: string; disabled?: boolean; title?: string }[]`.
  - `StaggerList({ children, staggerKey?, className })` and `StaggerItem({ children, className })` (caller must set `key` on `StaggerItem` itself, same as any mapped React child).
  - Consumed by Tasks 5–13.

- [ ] **Step 1: Create `components/motion/press-feedback.tsx`**

```tsx
"use client"

import { forwardRef } from "react"
import { motion, type HTMLMotionProps } from "framer-motion"

export const TAP_SCALE = { scale: 0.96 }
export const TAP_TRANSITION = { duration: 0.12 }

export const PressFeedback = forwardRef<HTMLButtonElement, HTMLMotionProps<"button">>(
  function PressFeedback({ children, ...props }, ref) {
    return (
      <motion.button ref={ref} whileTap={TAP_SCALE} transition={TAP_TRANSITION} {...props}>
        {children}
      </motion.button>
    )
  }
)
```

- [ ] **Step 2: Create `components/motion/segmented-control.tsx`**

```tsx
"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type SegmentOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

const VARIANT_STYLES = {
  tabs: {
    container: "flex gap-1 rounded-lg bg-muted p-1",
    option: "relative flex-1 rounded-md py-3 text-sm font-bold transition-colors",
    activeText: "text-card-foreground",
    inactiveText: "text-muted-foreground",
    pill: "absolute inset-0 rounded-md bg-card shadow-sm",
  },
  chips: {
    container: "flex gap-2 overflow-x-auto pb-1",
    option: "relative shrink-0 rounded-full bg-muted px-4 py-2 text-sm font-medium transition-colors",
    activeText: "text-primary-foreground",
    inactiveText: "text-muted-foreground hover:bg-accent/40",
    pill: "absolute inset-0 rounded-full bg-primary shadow-sm",
  },
} as const

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  variant = "tabs",
  className,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  layoutId: string
  variant?: "tabs" | "chips"
  className?: string
}) {
  const styles = VARIANT_STYLES[variant]
  return (
    <div className={cn(styles.container, className)}>
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            title={option.title}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              styles.option,
              isActive ? styles.activeText : styles.inactiveText,
              option.disabled && "opacity-50"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className={styles.pill}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/motion/stagger-list.tsx`**

```tsx
"use client"

import { AnimatePresence, motion } from "framer-motion"

const CONTAINER_VARIANTS = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.2 } },
}

export function StaggerList({
  children,
  staggerKey,
  className,
}: {
  children: React.ReactNode
  staggerKey?: string | number
  className?: string
}) {
  return (
    <motion.div key={staggerKey} variants={CONTAINER_VARIANTS} initial="hidden" animate="show" className={className}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div layout variants={ITEM_VARIANTS} exit="exit" className={className}>
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds (new files exist but aren't imported yet).

- [ ] **Step 5: Commit**

```bash
git add components/motion/press-feedback.tsx components/motion/segmented-control.tsx components/motion/stagger-list.tsx
git commit -m "Add PressFeedback, SegmentedControl, StaggerList motion primitives"
```

---

### Task 3: `BottomSheet`, `AnimatedCounter`, `ProgressRing`, `StepProgress` primitives

**Files:**
- Create: `components/motion/bottom-sheet.tsx`
- Create: `components/motion/animated-counter.tsx`
- Create: `components/motion/progress-ring.tsx`
- Create: `components/motion/step-progress.tsx`

**Interfaces:**
- Consumes: `framer-motion` (Task 1).
- Produces:
  - `BottomSheet({ onClose, children })` — replaces a fixed-overlay modal div; consumed by Task 7.
  - `AnimatedCounter({ value, format, className })` — `format: (n: number) => string`; consumed by Tasks 8, 13.
  - `ProgressRing({ percent, size?, strokeWidth?, className, children? })`; consumed by Task 13.
  - `StepProgress({ steps, currentStep })` where `steps: { key: string; label: string; icon: ComponentType<{className?:string}> }[]`; consumed by Task 10.

- [ ] **Step 1: Create `components/motion/bottom-sheet.tsx`**

```tsx
"use client"

import { AnimatePresence, motion, type PanInfo } from "framer-motion"

export function BottomSheet({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="flex w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
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

- [ ] **Step 2: Create `components/motion/animated-counter.tsx`**

```tsx
"use client"

import { useEffect } from "react"
import { animate, motion, useMotionValue, useTransform } from "framer-motion"

export function AnimatedCounter({
  value,
  format,
  className,
}: {
  value: number
  format: (n: number) => string
  className?: string
}) {
  const motionValue = useMotionValue(value)
  const display = useTransform(motionValue, (v) => format(Math.round(v)))

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.4, ease: [0.16, 1, 0.3, 1] })
    return controls.stop
  }, [value, motionValue])

  return <motion.span className={className}>{display}</motion.span>
}
```

- [ ] **Step 3: Create `components/motion/progress-ring.tsx`**

```tsx
"use client"

import { motion } from "framer-motion"

export function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 8,
  className,
  children,
}: {
  percent: number
  size?: number
  strokeWidth?: number
  className?: string
  children?: React.ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className={className} style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} className="fill-none stroke-muted" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="fill-none stroke-accent"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - percent / 100) }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Create `components/motion/step-progress.tsx`**

```tsx
"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type ProgressStep = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export function StepProgress({ steps, currentStep }: { steps: ProgressStep[]; currentStep: number }) {
  const progressPercent = currentStep < 0 ? 0 : (currentStep / (steps.length - 1)) * 100

  return (
    <div className="relative flex items-start justify-between">
      <div className="absolute top-5 left-0 -z-0 h-1 w-full bg-border" />
      <motion.div
        className="absolute top-5 left-0 -z-0 h-1 bg-primary"
        initial={false}
        animate={{ width: `${progressPercent}%` }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
      {steps.map((step, index) => {
        const Icon = step.icon
        const isDone = index <= currentStep
        return (
          <div key={step.key} className="z-10 flex w-1/4 flex-col items-center gap-2">
            <motion.div
              animate={{ scale: isDone ? 1 : 0.92 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full shadow-sm",
                isDone ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </motion.div>
            <p
              className={cn(
                "text-center text-[10px] font-bold leading-tight",
                isDone ? "text-primary" : "text-muted-foreground"
              )}
            >
              {step.label}
            </p>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/motion/bottom-sheet.tsx components/motion/animated-counter.tsx components/motion/progress-ring.tsx components/motion/step-progress.tsx
git commit -m "Add BottomSheet, AnimatedCounter, ProgressRing, StepProgress motion primitives"
```

---

### Task 4: `RouteTransition` + wire into the customer layout

**Files:**
- Create: `components/motion/route-transition.tsx`
- Modify: `app/[locale]/(customer)/layout.tsx:1-12` (full file, only 12 lines)

**Interfaces:**
- Consumes: `framer-motion`, `usePathname` from `@/i18n/navigation`.
- Produces: every customer page now cross-fades/slides on navigation. No other task depends on this directly, but Task 5/6's `layoutId` shared transition (Product Detail hero) relies on `AnimatePresence` being mounted here.

- [ ] **Step 1: Create `components/motion/route-transition.tsx`**

```tsx
"use client"

import { AnimatePresence, motion } from "framer-motion"
import { usePathname } from "@/i18n/navigation"

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Wire it into the customer layout**

Replace the full contents of `app/[locale]/(customer)/layout.tsx`:

```tsx
import { MotionConfig } from "framer-motion"
import { CustomerHeader } from "@/components/customer/header"
import { BottomNav } from "@/components/customer/bottom-nav"
import { RouteTransition } from "@/components/motion/route-transition"

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <CustomerHeader showBack />
      <div className="min-h-screen pb-20">
        <RouteTransition>{children}</RouteTransition>
      </div>
      <BottomNav />
    </MotionConfig>
  )
}
```

(`MotionConfig` renders its children directly with no wrapper DOM element, so this is a safe drop-in replacement for the old `<>...</>` fragment.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manually verify in dev server**

Run: `npm run dev`, open `http://localhost:3000/menu`, click into a few customer pages (`/cart`, `/orders`, `/profile`, `/loyalty`) via the bottom nav.
Expected: each navigation shows a brief cross-fade/slide instead of an instant cut. No console errors.

- [ ] **Step 5: Commit**

```bash
git add components/motion/route-transition.tsx "app/[locale]/(customer)/layout.tsx"
git commit -m "Add RouteTransition and wire into customer layout with MotionConfig"
```

---

### Task 5: `AnimatedTabBar` + wire into `BottomNav`

**Files:**
- Create: `components/motion/animated-tab-bar.tsx`
- Modify: `components/customer/bottom-nav.tsx` (full file, only 62 lines)

**Interfaces:**
- Consumes: `framer-motion`.
- Produces: `AnimatedTabBar({ items, activeHref, renderLink })` where `items: TabItem[] = { href, label, icon, badge? }[]` and `renderLink(item, isActive, content) => ReactNode` lets the caller supply its own locale-aware `Link`. No other task depends on this.

- [ ] **Step 1: Create `components/motion/animated-tab-bar.tsx`**

```tsx
"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type TabItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

export function AnimatedTabBar({
  items,
  activeHref,
  renderLink,
}: {
  items: TabItem[]
  activeHref: string
  renderLink: (item: TabItem, isActive: boolean, content: React.ReactNode) => React.ReactNode
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around rounded-t-xl bg-card px-2 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      {items.map((item) => {
        const isActive = item.href === activeHref
        const Icon = item.icon
        const content = (
          <span
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-center text-[11px] font-medium",
              isActive ? "text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {isActive && (
              <motion.span
                layoutId="tab-bar-active-pill"
                className="absolute inset-0 rounded-xl bg-primary shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">
              <Icon className="h-5 w-5" />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white ring-2 ring-card">
                  {item.badge}
                </span>
              )}
            </span>
            <span className="relative">{item.label}</span>
          </span>
        )
        return renderLink(item, isActive, content)
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Rewrite `components/customer/bottom-nav.tsx`**

```tsx
"use client"

import { useTranslations } from "next-intl"
import { UtensilsCrossed, ShoppingBasket, ReceiptText, User, Star } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { useCart } from "@/hooks/useCart"
import { AnimatedTabBar, type TabItem } from "@/components/motion/animated-tab-bar"

const NAV_ITEMS = [
  { href: "/menu", labelKey: "menu", icon: UtensilsCrossed } as const,
  { href: "/cart", labelKey: "cart", icon: ShoppingBasket } as const,
  { href: "/orders", labelKey: "orders", icon: ReceiptText } as const,
  { href: "/loyalty", labelKey: "loyalty", icon: Star } as const,
  { href: "/profile", labelKey: "profile", icon: User } as const,
]

/** Focused, single-task pages hide the tab bar rather than compete with their own primary action. */
function isFocusedPage(pathname: string): boolean {
  return (
    pathname === "/checkout" ||
    (pathname.startsWith("/orders/") && pathname !== "/orders") ||
    (pathname.startsWith("/menu/") && pathname !== "/menu")
  )
}

export function BottomNav() {
  const t = useTranslations("Nav")
  const pathname = usePathname()
  const { itemCount } = useCart()

  if (isFocusedPage(pathname)) return null

  const items: TabItem[] = NAV_ITEMS.map(({ href, labelKey, icon }) => ({
    href,
    label: t(labelKey),
    icon,
    badge: labelKey === "cart" ? itemCount : undefined,
  }))

  return (
    <AnimatedTabBar
      items={items}
      activeHref={pathname}
      renderLink={(item, _isActive, content) => (
        <Link key={item.href} href={item.href}>
          {content}
        </Link>
      )}
    />
  )
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manually verify in dev server**

Run: `npm run dev`, tap between Menu/Cart/Orders/Loyalty/Profile tabs.
Expected: the active-tab background pill slides smoothly to the tapped icon instead of instantly appearing; cart badge count still shows/updates correctly.

- [ ] **Step 5: Commit**

```bash
git add components/motion/animated-tab-bar.tsx components/customer/bottom-nav.tsx
git commit -m "Rebuild BottomNav on AnimatedTabBar with sliding active-tab pill"
```

---

### Task 6: Wire Menu (`menu-browser.tsx`)

**Files:**
- Modify: `components/customer/menu-browser.tsx` (full file, 186 lines)

**Interfaces:**
- Consumes: `SegmentedControl` (Task 2), `StaggerList`/`StaggerItem` (Task 2).
- Produces: each menu item's image container carries `layoutId={`product-image-${item.id}`}`, consumed by Task 7 (Product Detail) for the shared hero transition.

- [ ] **Step 1: Rewrite `components/customer/menu-browser.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { Coffee, CupSoda, Cookie, Milk, Search, Plus, Ban } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { useCart } from "@/hooks/useCart"
import { QuickAddExtrasPopup } from "@/components/customer/quick-add-extras-popup"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"
import { TAP_SCALE, TAP_TRANSITION } from "@/components/motion/press-feedback"
import type { MenuCategory, MenuIcon, MenuItem } from "@/lib/supabase/menu-data"

const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

function ItemImage({ item, className }: { item: MenuItem; className?: string }) {
  if (item.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.imageUrl} alt="" className={cn("object-cover", className)} />
  }
  const Icon = ICONS[item.icon]
  return (
    <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
      <Icon className="h-8 w-8" />
    </div>
  )
}

export function MenuBrowser({ categories, items }: { categories: MenuCategory[]; items: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const router = useRouter()
  const { addItem, itemCount, subtotal } = useCart()

  const [selectedCategory, setSelectedCategory] = useState(categories[0]?.id ?? "")
  const [searchQuery, setSearchQuery] = useState("")
  const [extrasPopupItem, setExtrasPopupItem] = useState<MenuItem | null>(null)

  const name = (item: MenuItem) => (locale === "vi" ? item.nameVi : item.nameEn)
  const description = (item: MenuItem) => (locale === "vi" ? item.descriptionVi : item.descriptionEn)
  const categoryLabel = (c: MenuCategory) => (locale === "vi" ? c.nameVi : c.nameEn)

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesCategory = item.categoryId === selectedCategory
      const matchesQuery =
        query === "" ||
        item.nameVi.toLowerCase().includes(query) ||
        item.nameEn.toLowerCase().includes(query)
      return matchesCategory && matchesQuery
    })
  }, [items, selectedCategory, searchQuery])

  function openItem(item: MenuItem) {
    if (!item.isAvailable) return
    router.push(`/menu/${item.id}`)
  }

  function quickAdd(item: MenuItem) {
    if (!item.isAvailable) return
    const needsSizeDecision = item.hasSizeOptions && item.sizes.length > 0
    if (needsSizeDecision) {
      openItem(item)
      return
    }
    if (item.modifierGroups.length > 0) {
      setExtrasPopupItem(item)
      return
    }
    addItem({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      modifiers: [],
      unitPrice: item.basePrice,
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 rounded-xl pl-9"
        />
      </div>

      <SegmentedControl
        variant="chips"
        layoutId="menu-category-pill"
        className="mb-6"
        value={selectedCategory}
        onChange={setSelectedCategory}
        options={categories.map((category) => ({ value: category.id, label: categoryLabel(category) }))}
      />

      {visibleItems.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("emptyResults")}</p>
      )}

      <StaggerList staggerKey={selectedCategory + searchQuery} className="flex flex-col gap-3">
        {visibleItems.map((item) => (
          <StaggerItem key={item.id}>
            <button
              type="button"
              onClick={() => openItem(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border bg-card p-2 text-left shadow-sm transition-shadow hover:shadow-md",
                !item.isAvailable && "opacity-70"
              )}
            >
              <motion.div layoutId={`product-image-${item.id}`} className="shrink-0">
                <ItemImage item={item} className={cn("h-20 w-20 rounded-lg", !item.isAvailable && "grayscale")} />
              </motion.div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 font-semibold text-card-foreground">{name(item)}</span>
                  {item.isPopular && (
                    <Badge className="shrink-0 bg-primary text-primary-foreground hover:bg-primary">
                      {t("popular")}
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground">{description(item)}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-bold text-primary">{formatVND(item.basePrice)}</span>
                  {item.isAvailable ? (
                    <motion.span
                      role="button"
                      whileTap={TAP_SCALE}
                      transition={TAP_TRANSITION}
                      onClick={(e) => {
                        e.stopPropagation()
                        quickAdd(item)
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Ban className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
            </button>
          </StaggerItem>
        ))}
      </StaggerList>

      {itemCount > 0 && (
        <Link
          href="/cart"
          className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center justify-between rounded-2xl bg-secondary px-5 py-4 text-secondary-foreground shadow-xl transition-colors hover:opacity-95"
        >
          <span className="font-semibold">
            {t("viewCart")} · {t("itemCount", { count: itemCount })}
          </span>
          <span className="text-lg font-bold">{formatVND(subtotal)}</span>
        </Link>
      )}

      {extrasPopupItem && (
        <QuickAddExtrasPopup item={extrasPopupItem} onClose={() => setExtrasPopupItem(null)} />
      )}
    </div>
  )
}
```

Notes baked into this rewrite:
- `SegmentedControl`'s `onChange` type is `(value: T) => void` with `T` inferred as `string` here since `categories.map(...)`'s `value` is `category.id: string` — matches `useState<string>` for `selectedCategory`, no cast needed.
- `StaggerList`'s `staggerKey` combines category + search so the stagger-in replays when the visible set changes (matches design: "re-triggers on category filter change").
- The quick-add "+" keeps `role="button"` (it's nested inside the card's own `<button>`, so it must stay a non-`<button>` element) — swapped `span`/`active:scale-90` for `motion.span`/`whileTap`, same visual result, using the shared `TAP_SCALE`/`TAP_TRANSITION` constants instead of a duplicate hardcoded transition.
- The `layoutId={`product-image-${item.id}`}` on the image wrapper is the anchor for Task 7's shared hero-image transition into Product Detail.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, open `/menu`.
Expected: category chips show a sliding pill background on selection; switching categories/search re-triggers a staggered fade-in of the item cards; quick-add "+" gives tap feedback; view-cart bar and empty/unavailable states unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/customer/menu-browser.tsx
git commit -m "Wire Menu page to SegmentedControl/StaggerList motion primitives"
```

---

### Task 7: Wire Product Detail (`product-detail.tsx`)

**Files:**
- Modify: `components/customer/product-detail.tsx` (full file, 231 lines)

**Interfaces:**
- Consumes: `SegmentedControl` (Task 2), `PressFeedback`/`TAP_SCALE`/`TAP_TRANSITION` (Task 2), `product-image-${item.id}` `layoutId` (Task 6).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Rewrite `components/customer/product-detail.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { Coffee, CupSoda, Cookie, Milk, Check } from "lucide-react"
import { useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { useCart, type CartModifier } from "@/hooks/useCart"
import { StarRating } from "@/components/customer/star-rating"
import { MOCK_REVIEWS, MOCK_RATING, MOCK_REVIEW_COUNT } from "@/lib/mock-data/reviews"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PressFeedback, TAP_SCALE, TAP_TRANSITION } from "@/components/motion/press-feedback"
import type { MenuItem, MenuIcon } from "@/lib/supabase/menu-data"

const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

export function ProductDetail({ item }: { item: MenuItem }) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const tProduct = useTranslations("ProductDetail")
  const router = useRouter()
  const { addItem } = useCart()

  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(
    item.hasSizeOptions ? item.sizes?.find((s) => s.priceDelta === 0)?.id ?? item.sizes?.[0]?.id ?? null : null
  )
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    item.modifierGroups?.forEach((group) => {
      if (group.required) defaults[group.id] = group.options[0].id
    })
    return defaults
  })
  const [note, setNote] = useState("")

  const name = locale === "vi" ? item.nameVi : item.nameEn
  const description = locale === "vi" ? item.descriptionVi : item.descriptionEn
  const Icon = ICONS[item.icon]

  const sizeDelta = item.sizes?.find((s) => s.id === selectedSizeId)?.priceDelta ?? 0
  const modifierDelta = Object.entries(selectedModifiers).reduce((sum, [groupId, optionId]) => {
    const group = item.modifierGroups?.find((g) => g.id === groupId)
    const option = group?.options.find((o) => o.id === optionId)
    return sum + (option?.priceDelta ?? 0)
  }, 0)
  const price = item.basePrice + sizeDelta + modifierDelta

  function handleAddToCart() {
    const size = item.sizes?.find((s) => s.id === selectedSizeId)
    const modifiers: CartModifier[] = Object.entries(selectedModifiers).map(([groupId, optionId]) => {
      const group = item.modifierGroups!.find((g) => g.id === groupId)!
      const option = group.options.find((o) => o.id === optionId)!
      return {
        groupId,
        optionId,
        labelVi: option.nameVi,
        labelEn: option.nameEn,
        priceDelta: option.priceDelta,
      }
    })
    const trimmedNote = note.trim()
    addItem({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      size: size ? { id: size.id, label: size.name, priceDelta: size.priceDelta } : undefined,
      modifiers,
      note: trimmedNote || undefined,
      unitPrice: price,
    })
    router.push("/menu")
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <motion.div
        layoutId={`product-image-${item.id}`}
        className="flex h-64 w-full items-center justify-center bg-muted text-muted-foreground sm:h-80"
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-20 w-20" />
        )}
      </motion.div>

      <div className="px-4 pt-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-card-foreground">{name}</h1>
          <span className="whitespace-nowrap text-xl font-bold text-primary">{formatVND(price)}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <StarRating rating={MOCK_RATING} />
          <span className="text-sm text-muted-foreground">
            {MOCK_RATING.toFixed(1)} · {tProduct("reviewCount", { count: MOCK_REVIEW_COUNT })}
          </span>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{description}</p>

        {item.hasSizeOptions && item.sizes.length > 0 && (
          <section className="mt-6 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("size")}
            </span>
            <SegmentedControl
              variant="tabs"
              layoutId="product-size-pill"
              value={selectedSizeId ?? ""}
              onChange={setSelectedSizeId}
              options={item.sizes.map((size) => ({ value: size.id, label: size.name }))}
            />
          </section>
        )}

        {item.modifierGroups?.map((group) => (
          <section key={group.id} className="mt-6 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </PressFeedback>
                )
              })}
            </div>
          </section>
        ))}

        <section className="mt-6 flex flex-col gap-2">
          <label
            htmlFor="product-note"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {t("noteLabel")}
          </label>
          <textarea
            id="product-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            rows={2}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </section>

        <section className="mt-8 border-t pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-card-foreground">{tProduct("reviewsTitle")}</h2>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary">{MOCK_RATING.toFixed(1)}</span>
              <StarRating rating={MOCK_RATING} size="lg" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {MOCK_REVIEWS.map((review) => (
              <div key={review.id} className="rounded-xl border bg-card p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                    {review.reviewerName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-card-foreground">{review.reviewerName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {tProduct("daysAgo", { days: review.daysAgo })}
                      </span>
                    </div>
                    <StarRating rating={review.rating} />
                  </div>
                </div>
                <p className="mt-2 text-sm text-card-foreground">
                  {locale === "vi" ? review.commentVi : review.commentEn}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t bg-card px-6 py-4 shadow-[0_-4px_12px_-1px_rgba(0,0,0,0.1)]"
      >
        <span className="text-xl font-bold text-primary">{formatVND(price)}</span>
        <motion.div whileTap={item.isAvailable ? TAP_SCALE : undefined} transition={TAP_TRANSITION}>
          <Button
            onClick={handleAddToCart}
            disabled={!item.isAvailable}
            className="h-12 gap-2 rounded-xl px-8 text-base font-bold"
          >
            {tProduct("addToCart")}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  )
}
```

Notes baked into this rewrite:
- `SegmentedControl`'s generic `T` here is `string` (size ids); `selectedSizeId ?? ""` handles the `null` initial-state case (an item can theoretically have no default size match) without changing the component's public type.
- The `Button` (Base UI, not a native `<button>` — see CLAUDE.md's Base UI gotcha) can't be passed directly as `HTMLMotionProps<"button">`'s `ref`/`children` shape, so it's wrapped in a plain `motion.div` for tap feedback instead of using `PressFeedback` directly here.
- `layoutId={`product-image-${item.id}`}` matches Task 6's menu card image exactly — this is what produces the shared "image flows into detail" transition when `AnimatePresence` (Task 4, in the customer layout) keeps both pages briefly mounted during the route change.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, tap a menu item from `/menu` into its Product Detail page.
Expected: size picker (if present) shows the sliding pill; modifier options give tap feedback; sticky Add-to-Cart bar slides up on mount. Watch the hero image specifically — check whether it visibly morphs from the card's position/size into the full-width hero (the shared transition). If it does not animate smoothly (just cross-fades instead), that is an acceptable fallback per the design doc's "riskiest piece" note — do not spend more than one debugging pass on it; a plain cross-fade (already provided by `RouteTransition`) is a fine outcome here.

- [ ] **Step 4: Commit**

```bash
git add components/customer/product-detail.tsx
git commit -m "Wire Product Detail to SegmentedControl/PressFeedback and shared hero-image transition"
```

---

### Task 8: Rebuild `quick-add-extras-popup.tsx` on `BottomSheet`

**Files:**
- Modify: `components/customer/quick-add-extras-popup.tsx` (full file, 121 lines)

**Interfaces:**
- Consumes: `BottomSheet` (Task 3), `PressFeedback` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Rewrite `components/customer/quick-add-extras-popup.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { useCart, type CartModifier } from "@/hooks/useCart"
import { BottomSheet } from "@/components/motion/bottom-sheet"
import { PressFeedback } from "@/components/motion/press-feedback"
import type { MenuItem } from "@/lib/supabase/menu-data"

/**
 * Quick-add path for an item with extras but no size decision to make —
 * lets a customer pick extras without leaving the Menu grid for the full
 * Product Detail Page. Tapping the item itself (not this "+" popup)
 * still opens the full page. Extras are always non-required single-
 * option modifier_groups (see menu-data.ts), so the same toggle-any-
 * count-independently selection logic as Product Detail applies.
 */
export function QuickAddExtrasPopup({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const { addItem } = useCart()
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string>>({})

  const modifierDelta = Object.entries(selectedModifiers).reduce((sum, [groupId, optionId]) => {
    const group = item.modifierGroups.find((g) => g.id === groupId)
    const option = group?.options.find((o) => o.id === optionId)
    return sum + (option?.priceDelta ?? 0)
  }, 0)
  const price = item.basePrice + modifierDelta

  function handleAdd() {
    const modifiers: CartModifier[] = Object.entries(selectedModifiers).map(([groupId, optionId]) => {
      const group = item.modifierGroups.find((g) => g.id === groupId)!
      const option = group.options.find((o) => o.id === optionId)!
      return {
        groupId,
        optionId,
        labelVi: option.nameVi,
        labelEn: option.nameEn,
        priceDelta: option.priceDelta,
      }
    })
    addItem({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      modifiers,
      unitPrice: price,
    })
    onClose()
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="font-bold text-card-foreground">
          {locale === "vi" ? item.nameVi : item.nameEn}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label={t("close")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {item.modifierGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t px-5 py-4">
        <span className="text-lg font-bold text-primary">{formatVND(price)}</span>
        <Button onClick={handleAdd} className="h-11 rounded-xl px-6 font-bold">
          {t("add")}
        </Button>
      </div>
    </BottomSheet>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, on `/menu` tap the "+" quick-add on an item that has extras but no size options.
Expected: sheet springs up from the bottom; dragging it down past ~100px or flicking down dismisses it; tapping the backdrop also dismisses it; extras selection and Add button behave exactly as before.

- [ ] **Step 4: Commit**

```bash
git add components/customer/quick-add-extras-popup.tsx
git commit -m "Rebuild quick-add extras popup on BottomSheet primitive"
```

---

### Task 9: Wire Cart (`cart-view.tsx`)

**Files:**
- Modify: `components/customer/cart-view.tsx` (full file, 186 lines)

**Interfaces:**
- Consumes: `StaggerList`/`StaggerItem` (Task 2), `AnimatedCounter` (Task 3).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Rewrite `components/customer/cart-view.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { motion, useMotionValue, type PanInfo } from "framer-motion"
import { Minus, Plus, Trash2, ArrowRight, ShoppingBasket, Ticket, X } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVND } from "@/lib/format"
import { useCart, type CartItem } from "@/hooks/useCart"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"
import { AnimatedCounter } from "@/components/motion/animated-counter"

function lineLabel(item: CartItem, locale: string): string {
  const parts: string[] = []
  if (item.size) parts.push(item.size.label)
  item.modifiers.forEach((m) => parts.push(locale === "vi" ? m.labelVi : m.labelEn))
  return parts.join(", ")
}

const SWIPE_DISMISS_THRESHOLD = -80

function CartRow({
  item,
  locale,
  t,
  onRemove,
  onUpdateQuantity,
}: {
  item: CartItem
  locale: string
  t: ReturnType<typeof useTranslations>
  onRemove: (id: string) => void
  onUpdateQuantity: (id: string, quantity: number) => void
}) {
  const x = useMotionValue(0)
  const name = locale === "vi" ? item.nameVi : item.nameEn
  const label = lineLabel(item, locale)

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.x < SWIPE_DISMISS_THRESHOLD) onRemove(item.cartItemId)
  }

  return (
    <motion.div
      style={{ x }}
      drag="x"
      dragConstraints={{ left: -96, right: 0 }}
      dragElastic={{ left: 0.15, right: 0 }}
      onDragEnd={handleDragEnd}
      className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm"
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ShoppingBasket className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight text-card-foreground">{name}</h3>
            <button
              type="button"
              onClick={() => onRemove(item.cartItemId)}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={t("remove")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {label && <p className="mt-1 text-xs text-muted-foreground">{label}</p>}
          {item.note && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {t("noteLabel")}: {item.note}
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-bold text-primary">
              {formatVND(item.unitPrice * item.quantity)}
            </span>
            {item.quantity > 1 && (
              <span className="text-[10px] text-muted-foreground">
                {formatVND(item.unitPrice)} × {item.quantity}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-muted px-1 py-1">
            <button
              type="button"
              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-background"
              aria-label={t("decrease")}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
            <button
              type="button"
              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-background"
              aria-label={t("increase")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function CartView() {
  const locale = useLocale()
  const t = useTranslations("Cart")
  const { items, updateQuantity, removeItem, subtotal, promoCode, promoDiscount, applyPromoCode, clearPromoCode } =
    useCart()
  const [promoInput, setPromoInput] = useState("")
  const [promoError, setPromoError] = useState(false)

  function handleApplyPromo() {
    const success = applyPromoCode(promoInput)
    setPromoError(!success)
    if (success) setPromoInput("")
  }

  const total = Math.max(subtotal - promoDiscount, 0)

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
        <ShoppingBasket className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("empty")}</p>
        <Button className="h-11" render={<Link href="/menu" />} nativeButton={false}>
          {t("browseMenu")}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6">
      <StaggerList className="flex flex-col gap-3">
        {items.map((item) => (
          <StaggerItem key={item.cartItemId}>
            <CartRow item={item} locale={locale} t={t} onRemove={removeItem} onUpdateQuantity={updateQuantity} />
          </StaggerItem>
        ))}
      </StaggerList>

      {promoCode ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium text-accent-foreground">
            <Ticket className="h-4 w-4" />
            {t("promoApplied")}: <strong>{promoCode}</strong>
          </span>
          <button
            type="button"
            onClick={clearPromoCode}
            aria-label={t("removePromo")}
            title={t("removePromo")}
            className="text-accent-foreground/70 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Ticket className="h-4 w-4" />
            {t("promoLabel")}
          </span>
          <div className="flex gap-2">
            <Input
              value={promoInput}
              onChange={(e) => {
                setPromoInput(e.target.value)
                setPromoError(false)
              }}
              placeholder={t("promoPlaceholder")}
              className="h-10 flex-1"
            />
            <Button variant="outline" className="h-10" onClick={handleApplyPromo} disabled={!promoInput.trim()}>
              {t("apply")}
            </Button>
          </div>
          {promoError && <p className="text-xs text-destructive">{t("invalidPromo")}</p>}
        </div>
      )}

      <section className="mt-6 space-y-3 rounded-2xl bg-muted p-5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("subtotal")}</span>
          <AnimatedCounter value={subtotal} format={formatVND} className="font-medium" />
        </div>
        {promoDiscount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("discount")}</span>
            <span className="font-medium text-green-600">-{formatVND(promoDiscount)}</span>
          </div>
        )}
        <div className="h-px bg-border" />
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-card-foreground">{t("total")}</span>
          <AnimatedCounter value={total} format={formatVND} className="text-lg font-bold text-primary" />
        </div>
      </section>

      <Button
        className="mt-6 h-12 w-full gap-2 rounded-xl text-base"
        render={<Link href="/checkout" />}
        nativeButton={false}
      >
        {t("proceedToCheckout")}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

Notes baked into this rewrite:
- `CartRow` is a new small internal component purely to give `useMotionValue`/drag its own scope per row (hooks can't be called inside `.map()` directly) — not exported, not a new file, since nothing outside `cart-view.tsx` needs it.
- Swiping a row left past 80px removes it (same `removeItem` the Trash2 button already called) — both paths coexist, matching the design's "swipe-to-delete replaces the static remove button" while keeping the button as a fallback for non-touch input.
- `StaggerItem`'s `exit` variant (from Task 2) makes removal — whether via swipe or the Trash2 button — collapse the row's height instead of an instant disappearance.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, add a couple of items to the cart, open `/cart`.
Expected: rows fade/slide in staggered on load; dragging a row left past ~80px removes it with a smooth height-collapse; tapping the trash icon does the same; quantity +/- and totals still update correctly, with totals visibly tweening to the new value.

- [ ] **Step 4: Commit**

```bash
git add components/customer/cart-view.tsx
git commit -m "Wire Cart to StaggerList (swipe-to-delete) and AnimatedCounter totals"
```

---

### Task 10: Wire Checkout (`checkout-view.tsx`)

**Files:**
- Modify: `components/customer/checkout-view.tsx:144-192` (order-type toggle) and `:287-339` (pay-timing toggle + payment method grid)

**Interfaces:**
- Consumes: `SegmentedControl` (Task 2), `PressFeedback` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add imports**

At the top of `components/customer/checkout-view.tsx`, alongside the other imports:

```tsx
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PressFeedback } from "@/components/motion/press-feedback"
```

- [ ] **Step 2: Replace the order-type toggle (lines 146–192)**

Replace:

```tsx
      <section className="mb-6 space-y-2">
        <h2 className="font-bold text-card-foreground">{t("orderType")}</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setOrderType("pickup")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              orderType === "pickup"
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground"
            )}
          >
            {t("pickup")}
          </button>
          <button
            type="button"
            disabled={!activeTable}
            title={!activeTable ? t("dineInRequiresScan") : undefined}
            onClick={() => activeTable && setOrderType("dine-in")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              orderType === "dine-in"
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground",
              !activeTable && "opacity-50"
            )}
          >
            {t("dineIn")}
          </button>
        </div>
```

With:

```tsx
      <section className="mb-6 space-y-2">
        <h2 className="font-bold text-card-foreground">{t("orderType")}</h2>
        <SegmentedControl
          layoutId="checkout-order-type-pill"
          value={orderType}
          onChange={(next) => (next === "dine-in" ? activeTable && setOrderType(next) : setOrderType(next))}
          options={[
            { value: "pickup" as const, label: t("pickup") },
            {
              value: "dine-in" as const,
              label: t("dineIn"),
              disabled: !activeTable,
              title: !activeTable ? t("dineInRequiresScan") : undefined,
            },
          ]}
        />
```

(The `SegmentedControl`'s own `disabled` handling already no-ops the click for the disabled option; the extra `next === "dine-in" ? activeTable && ...` guard is defense-in-depth matching the original's `activeTable &&` check, kept for clarity.)

- [ ] **Step 3: Replace the pay-timing toggle (lines 287–312)**

Replace:

```tsx
      <section className="mb-6 space-y-2">
        <h2 className="font-bold text-card-foreground">{t("payTiming")}</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setPayAt("now")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              payAt === "now" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t("payNow")}
          </button>
          <button
            type="button"
            onClick={() => setPayAt("later")}
            className={cn(
              "flex-1 rounded-md py-3 text-sm font-bold transition-all",
              payAt === "later" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t("payLater")}
          </button>
        </div>
        {payAt === "later" && <p className="text-sm text-muted-foreground">{t("payLaterNote")}</p>}
      </section>
```

With:

```tsx
      <section className="mb-6 space-y-2">
        <h2 className="font-bold text-card-foreground">{t("payTiming")}</h2>
        <SegmentedControl
          layoutId="checkout-pay-timing-pill"
          value={payAt}
          onChange={setPayAt}
          options={[
            { value: "now" as const, label: t("payNow") },
            { value: "later" as const, label: t("payLater") },
          ]}
        />
        {payAt === "later" && <p className="text-sm text-muted-foreground">{t("payLaterNote")}</p>}
      </section>
```

- [ ] **Step 4: Replace the payment-method buttons (lines 317–336)**

Replace:

```tsx
            {PAYMENT_OPTIONS.map(({ id, icon: Icon, labelKey, enabled }) => (
              <button
                key={id}
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : t("paymentMethodComingSoon")}
                onClick={() => setPaymentMethod(id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors",
                  paymentMethod === id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-transparent bg-muted text-muted-foreground",
                  !enabled && "opacity-50"
                )}
              >
                <Icon className="h-7 w-7" />
                <span className="text-xs font-bold">{t(labelKey)}</span>
              </button>
            ))}
```

With:

```tsx
            {PAYMENT_OPTIONS.map(({ id, icon: Icon, labelKey, enabled }) => (
              <PressFeedback
                key={id}
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : t("paymentMethodComingSoon")}
                onClick={() => setPaymentMethod(id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors",
                  paymentMethod === id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-transparent bg-muted text-muted-foreground",
                  !enabled && "opacity-50"
                )}
              >
                <Icon className="h-7 w-7" />
                <span className="text-xs font-bold">{t(labelKey)}</span>
              </PressFeedback>
            ))}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds. If TypeScript complains about `SegmentedControl<T>`'s inferred type for the order-type control (it must unify to `"pickup" | "dine-in"`), the `as const` on each `value` in Step 2's options array is what fixes it — confirm both `as const` annotations are present.

- [ ] **Step 6: Manually verify in dev server**

Run: `npm run dev`, with items in the cart open `/checkout`.
Expected: order-type and pay-timing toggles show a sliding pill background; Dine-in stays disabled with its tooltip until a table is scanned; payment method cards give tap feedback; placing an order (any payment method, sandbox/cash) still works end-to-end.

- [ ] **Step 7: Commit**

```bash
git add components/customer/checkout-view.tsx
git commit -m "Wire Checkout toggles to SegmentedControl and payment buttons to PressFeedback"
```

---

### Task 11: Wire Order Tracking (`order-tracking.tsx`)

**Files:**
- Modify: `components/customer/order-tracking.tsx:181-262`

**Interfaces:**
- Consumes: `StepProgress` (Task 3), `PressFeedback` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add imports**

At the top of `components/customer/order-tracking.tsx`:

```tsx
import { StepProgress } from "@/components/motion/step-progress"
import { PressFeedback } from "@/components/motion/press-feedback"
```

- [ ] **Step 2: Replace the status bar section (lines 181–213)**

Replace:

```tsx
      <section className="mt-8 px-2">
        <div className="relative flex items-start justify-between">
          <div className="absolute top-5 left-0 h-1 w-full -z-0 bg-border" />
          <div
            className="absolute top-5 left-0 -z-0 h-1 bg-primary transition-all duration-1000"
            style={{ width: `${progressPercent}%` }}
          />
          {STEPS.map((step, index) => {
            const Icon = step.icon
            const isDone = index <= currentStep
            return (
              <div key={step.key} className="z-10 flex w-1/4 flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full shadow-sm",
                    isDone ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <p
                  className={cn(
                    "text-center text-[10px] font-bold leading-tight",
                    isDone ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {t(step.key)}
                </p>
              </div>
            )
          })}
        </div>
      </section>
```

With:

```tsx
      <section className="mt-8 px-2">
        <StepProgress
          currentStep={currentStep}
          steps={STEPS.map((step) => ({ key: step.key, label: t(step.key), icon: step.icon }))}
        />
      </section>
```

(`progressPercent` — computed a few lines above at `order-tracking.tsx:160` — becomes unused by this section; it is still fine to leave the existing `const progressPercent = ...` line in place if anything else references it, otherwise remove it. Checking the current file: nothing else uses it, so delete the line `const progressPercent = currentStep < 0 ? 0 : (currentStep / (STEPS.length - 1)) * 100` too, to avoid an unused-variable lint warning.)

- [ ] **Step 3: Replace the payment-method picker buttons (lines 221–249)**

Replace:

```tsx
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("cash")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <Banknote className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodCash")}</span>
                </button>
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("stripe")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <CreditCard className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodCard")}</span>
                </button>
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("vnpay")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <QrCode className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodVNPay")}</span>
                </button>
              </div>
```

With:

```tsx
              <div className="grid grid-cols-3 gap-2">
                <PressFeedback
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("cash")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <Banknote className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodCash")}</span>
                </PressFeedback>
                <PressFeedback
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("stripe")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <CreditCard className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodCard")}</span>
                </PressFeedback>
                <PressFeedback
                  type="button"
                  disabled={isPaying}
                  onClick={() => handlePayNow("vnpay")}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-transparent bg-muted p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <QrCode className="h-7 w-7" />
                  <span className="text-xs font-bold">{t("payMethodVNPay")}</span>
                </PressFeedback>
              </div>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds, no unused-variable warning for `progressPercent`.

- [ ] **Step 5: Manually verify in dev server**

Run: `npm run dev`, place a test order (or open an existing one's tracking page).
Expected: the step bar's filled segment animates forward when status changes (test by advancing an order's status from POS/KDS in another tab and watching the customer tracking page update via Realtime); the deferred-payment method picker (only visible on a `served`+unpaid order) gives tap feedback and still redirects/confirms correctly for all three methods.

- [ ] **Step 6: Commit**

```bash
git add components/customer/order-tracking.tsx
git commit -m "Wire Order Tracking status bar to StepProgress and payment buttons to PressFeedback"
```

---

### Task 12: Wire Order History (`order-history.tsx`)

**Files:**
- Modify: `components/customer/order-history.tsx` (full file, 127 lines)

**Interfaces:**
- Consumes: `SegmentedControl` (Task 2), `StaggerList`/`StaggerItem` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Rewrite `components/customer/order-history.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { formatOrderId, formatVND } from "@/lib/format"
import { useOrders, type OrderStatus } from "@/hooks/useOrders"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  paid: "bg-blue-100 text-blue-800",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  served: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

const STATUS_KEYS: Record<
  OrderStatus,
  "statusPendingPayment" | "statusPaid" | "statusPreparing" | "statusReady" | "statusServed" | "statusCompleted" | "statusCancelled"
> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}

type Filter = "all" | "active" | "completed"

const FILTERS: { id: Filter; labelKey: "filterAll" | "filterActive" | "filterCompleted" }[] = [
  { id: "all", labelKey: "filterAll" },
  { id: "active", labelKey: "filterActive" },
  { id: "completed", labelKey: "filterCompleted" },
]

function matchesFilter(status: OrderStatus, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "active")
    return status === "pending_payment" || status === "paid" || status === "preparing" || status === "ready" || status === "served"
  return status === "completed" || status === "cancelled"
}

function formatOrderDate(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function OrderHistory() {
  const locale = useLocale()
  const t = useTranslations("OrderHistory")
  const { myOrders, isLoadingMyOrders } = useOrders()
  const [filter, setFilter] = useState<Filter>("all")

  const sorted = useMemo(() => [...myOrders].sort((a, b) => b.createdAt - a.createdAt), [myOrders])
  const filtered = sorted.filter((order) => matchesFilter(order.status, filter))

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      <SegmentedControl
        layoutId="order-history-filter-pill"
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map(({ id, labelKey }) => ({ value: id, label: t(labelKey) }))}
      />

      {isLoadingMyOrders ? (
        <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <StaggerList staggerKey={filter} className="flex flex-col gap-3">
          {filtered.map((order) => {
            const itemsLabel = order.items
              .map((item) => (locale === "vi" ? item.nameVi : item.nameEn))
              .join(", ")
            return (
              <StaggerItem key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-card-foreground">#{formatOrderId(order.id)}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
                          STATUS_STYLES[order.status]
                        )}
                      >
                        {t(STATUS_KEYS[order.status])}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatOrderDate(order.createdAt, locale)}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {t("itemCount", { count: order.items.length })}: {itemsLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-bold text-primary">{formatVND(order.total)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </StaggerItem>
            )
          })}
        </StaggerList>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, open `/orders` with a mix of order statuses.
Expected: filter chips show a sliding pill; switching filters re-triggers a staggered fade-in of the matching rows; tapping a row still navigates to its tracking page.

- [ ] **Step 4: Commit**

```bash
git add components/customer/order-history.tsx
git commit -m "Wire Order History filter to SegmentedControl and rows to StaggerList"
```

---

### Task 13: Wire Profile (`profile-view.tsx`)

**Files:**
- Modify: `components/customer/profile-view.tsx:143-185` (field edit/save/cancel buttons) and `:267-278` (logout button)

**Interfaces:**
- Consumes: `PressFeedback` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add import**

```tsx
import { PressFeedback } from "@/components/motion/press-feedback"
```

- [ ] **Step 2: Replace the field edit/save/cancel buttons (lines 154–182)**

Replace:

```tsx
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit()
                      if (e.key === "Escape") cancelEdit()
                    }}
                    className="h-11 flex-1 rounded-xl border-2 border-primary bg-card px-4 text-card-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={saveEdit}
                    aria-label={t("save")}
                    title={t("save")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    aria-label={t("cancel")}
                    title={t("cancel")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(field)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-transparent bg-muted px-4 text-left transition-colors hover:border-primary/40"
                >
                  <span className="text-card-foreground">{profile[field]}</span>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
```

With:

```tsx
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit()
                      if (e.key === "Escape") cancelEdit()
                    }}
                    className="h-11 flex-1 rounded-xl border-2 border-primary bg-card px-4 text-card-foreground focus:outline-none"
                  />
                  <PressFeedback
                    type="button"
                    onClick={saveEdit}
                    aria-label={t("save")}
                    title={t("save")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                  >
                    <Check className="h-4 w-4" />
                  </PressFeedback>
                  <PressFeedback
                    type="button"
                    onClick={cancelEdit}
                    aria-label={t("cancel")}
                    title={t("cancel")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </PressFeedback>
                </div>
              ) : (
                <PressFeedback
                  type="button"
                  onClick={() => startEdit(field)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-transparent bg-muted px-4 text-left transition-colors hover:border-primary/40"
                >
                  <span className="text-card-foreground">{profile[field]}</span>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </PressFeedback>
              )}
```

- [ ] **Step 3: Replace the logout button (lines 267–278)**

Replace:

```tsx
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LogOut className="h-5 w-5" />
            </span>
            <span className="font-medium text-destructive">{t("menuLogout")}</span>
          </span>
        </button>
```

With:

```tsx
        <PressFeedback
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LogOut className="h-5 w-5" />
            </span>
            <span className="font-medium text-destructive">{t("menuLogout")}</span>
          </span>
        </PressFeedback>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manually verify in dev server**

Run: `npm run dev`, open `/profile`, edit a field (save and cancel both), then log out.
Expected: every button above gives a small tap-scale on press; editing/saving/canceling and logout all behave exactly as before (local-state-only fields, real `signOut()`).

- [ ] **Step 6: Commit**

```bash
git add components/customer/profile-view.tsx
git commit -m "Wire Profile edit/save/cancel/logout buttons to PressFeedback"
```

---

### Task 14: Wire Loyalty (`loyalty-view.tsx`)

**Files:**
- Modify: `components/customer/loyalty-view.tsx` (full file, 154 lines)

**Interfaces:**
- Consumes: `AnimatedCounter` (Task 3), `ProgressRing` (Task 3), `StaggerList`/`StaggerItem` (Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Rewrite `components/customer/loyalty-view.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Star, Info, Gift, ArrowRight, CheckCircle2, Wallet, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatNumber, formatDateVN, formatOrderId } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { getLoyaltyBalance, getLoyaltyTransactions, type LoyaltyTransaction, type LoyaltyTransactionType } from "@/lib/supabase/loyalty-data"
import { AnimatedCounter } from "@/components/motion/animated-counter"
import { ProgressRing } from "@/components/motion/progress-ring"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"

/**
 * Tier progress has no real tier table yet — kept as a fixed mock
 * (matches the approved Stitch mockup), documented not hidden. Balance
 * and transaction history below are both real (profiles.loyalty_points_balance,
 * loyalty_transactions), wired 2026-07-08 after being caught still
 * showing a hardcoded 1250/mock rows despite Checkout already earning/
 * redeeming real points via place_order/handle_order_paid.
 */
const POINTS_TO_NEXT_TIER = 250
const TIER_PROGRESS_PERCENT = 75

const TRANSACTION_META: Record<
  LoyaltyTransactionType,
  { icon: typeof CheckCircle2; iconClass: string; amountClass: string; labelKey: "earned" | "redeemed" | "adjusted" }
> = {
  earn: { icon: CheckCircle2, iconClass: "bg-green-100 text-green-700", amountClass: "text-green-600", labelKey: "earned" },
  redeem: { icon: Gift, iconClass: "bg-primary/10 text-primary", amountClass: "text-primary", labelKey: "redeemed" },
  adjust: { icon: Wallet, iconClass: "bg-accent/30 text-accent-foreground", amountClass: "text-accent-foreground", labelKey: "adjusted" },
}

export function LoyaltyView() {
  const t = useTranslations("Loyalty")
  const [supabase] = useState(() => createClient())
  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      getLoyaltyBalance(supabase, user.id).then(setBalance)
    })
    getLoyaltyTransactions(supabase).then(setTransactions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      <section className="rounded-xl border bg-muted p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Star className="h-4 w-4" fill="currentColor" />
          <span className="text-xs font-bold uppercase tracking-wider text-secondary">
            {t("currentBalance")}
          </span>
        </div>
        <div className="mb-4 flex items-baseline gap-2">
          <AnimatedCounter value={balance} format={formatNumber} className="text-5xl font-extrabold text-primary" />
          <span className="font-bold text-primary/80">{t("pts")}</span>
        </div>
        <div className="space-y-3 rounded-xl border bg-card/60 p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 shrink-0 text-secondary" />
            <p className="text-sm text-card-foreground">{t("earnRateInfo")}</p>
          </div>
          <div className="flex items-start gap-3">
            <Gift className="h-5 w-5 shrink-0 text-secondary" />
            <p className="text-sm text-card-foreground">{t("redeemRateInfo")}</p>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="self-start font-bold text-card-foreground">{t("tierName")}</h3>
          <ProgressRing percent={TIER_PROGRESS_PERCENT} size={88} strokeWidth={7}>
            <span className="text-lg font-bold text-accent-foreground">{TIER_PROGRESS_PERCENT}%</span>
          </ProgressRing>
          <p className="text-center text-xs text-secondary">{t("tierProgress", { points: POINTS_TO_NEXT_TIER })}</p>
        </div>
        <button
          type="button"
          disabled
          title="Not implemented yet — no rewards catalog to redeem from"
          className="flex flex-col justify-between rounded-xl bg-primary/40 p-4 text-left text-primary-foreground opacity-70"
        >
          <h3 className="font-bold">{t("redeemAction")}</h3>
          <div className="mt-4 flex justify-end">
            <ArrowRight className="h-8 w-8" />
          </div>
        </button>
      </section>

      <section className="mt-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-accent-foreground">
          <Sparkles className="h-4 w-4" />
          <h3 className="font-bold text-card-foreground">{t("promoTitle")}</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("promoSubtitle")}</p>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-card-foreground">{t("historyTitle")}</h3>
          <button
            type="button"
            disabled
            title="Not implemented yet — no more transaction history to load"
            className="flex items-center gap-1 text-sm font-bold text-secondary opacity-50"
          >
            {t("viewAll")}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <StaggerList className="flex flex-col gap-2">
            {transactions.map((transaction) => {
              const meta = TRANSACTION_META[transaction.type]
              const Icon = meta.icon
              return (
                <StaggerItem key={transaction.id}>
                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", meta.iconClass)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-card-foreground">{t(meta.labelKey)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateVN(new Date(transaction.createdAt))}
                          {transaction.orderId && ` · #${formatOrderId(transaction.orderId)}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn("font-bold", meta.amountClass)}>
                        {transaction.pointsChange > 0 ? "+" : ""}
                        {transaction.pointsChange}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{t("pointsUnit")}</p>
                    </div>
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}
      </section>
    </div>
  )
}
```

Note: the tier card's layout changes from a horizontal bar to a `ProgressRing` (per the approved design doc); this is the one visual-shape change in this whole plan, already called out and approved in brainstorming — colors (`accent`/`secondary` tokens) are unchanged, only the shape of the progress indicator.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify in dev server**

Run: `npm run dev`, log in as the test customer account, open `/loyalty`.
Expected: points balance tweens in on load; tier ring fills to 75%; transaction rows stagger in. Placing and paying for an order should still increase the real balance and add a real transaction row (unchanged logic, only presentation).

- [ ] **Step 4: Commit**

```bash
git add components/customer/loyalty-view.tsx
git commit -m "Wire Loyalty balance/tier/history to AnimatedCounter, ProgressRing, StaggerList"
```

---

### Task 15: Deploy and live verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above, deployed.
- Produces: verified feature; `daily.md` update.

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

Vercel auto-deploys; wait for the deployment to go live.

- [ ] **Step 2: Verify each page on https://phadincafe.vercel.app, both locales**

- **Menu**: category chips slide, item stagger-in on filter/search change, quick-add tap feedback, cart badge updates.
- **Product Detail**: size/modifier selection feedback, sticky Add-to-Cart bar slide-up, hero image transition from the tapped card (accept a plain cross-fade if the morph isn't smooth).
- **Quick-add popup**: springs up, drag-to-dismiss, backdrop-tap-to-dismiss.
- **Cart**: stagger-in, swipe-to-delete, trash-button-delete, animated totals.
- **Checkout**: order-type/pay-timing sliding toggles, Dine-in disabled until a table is scanned, payment method tap feedback, a full test order placed successfully (cash is simplest to verify end-to-end).
- **Order Tracking**: step bar animates forward on a real status change (advance an order from POS/KDS in another tab), deferred-payment picker works for at least Cash.
- **Order History**: filter toggle slides, rows stagger in on filter change.
- **Profile**: edit/save/cancel/logout all give tap feedback and still work.
- **Loyalty**: balance tweens, ring fills, transactions stagger in; confirm the balance still increases after a real paid order.
- **Bottom Nav**: active-tab pill slides on every tab change; hidden correctly on `/checkout`, `/orders/[id]`, `/menu/[id]`.
- **Navigation overall**: page-to-page transitions cross-fade/slide, no layout flash or double-render glitches.

- [ ] **Step 3: Verify reduced motion**

In devtools (Rendering → Emulate CSS `prefers-reduced-motion: reduce`), reload each page above.
Expected: `MotionConfig reducedMotion="user"` disables/shortens the Framer Motion animations (springs collapse to instant, no page-transition slide) — check specifically that the app is still fully usable with animations off, not just faster.

- [ ] **Step 4: If anything fails**

Use superpowers:systematic-debugging — reproduce, isolate (which primitive / which page / deployment-specific), fix, redeploy, re-verify. Do not mark this task complete until every check above passes on the live site.

- [ ] **Step 5: Update docs and commit**

Update `daily.md` to note the motion redesign is shipped and live-verified (or list what's still open, if anything from Step 2/3 needed a follow-up fix), then:

```bash
git add -A
git commit -m "Docs: Starbucks-style customer motion shipped and live-verified"
git push origin main
```
