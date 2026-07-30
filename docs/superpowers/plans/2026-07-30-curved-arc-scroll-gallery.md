# Custom Scroll-Linked Curved Arc Image Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sticky-pinned, scroll-driven image gallery where best seller drink items enter sequentially from bottom-right, sweep along a smooth parabolic arc trajectory to center focus, and exit top-left.

**Architecture:** Update `components/marketing/best-sellers-gallery.tsx` using Framer Motion's `useScroll` and `useTransform` to bind scroll progress across a `h-[350vh]` sticky container to parabolic mathematical transformations for `x`, `y`, `scale`, `opacity`, and `rotate`.

**Tech Stack:** Next.js (App Router), React, Tailwind v4 CSS, Framer Motion, TypeScript.

## Global Constraints

- Follow `CLAUDE.md` design rules: Tailwind v4 theme tokens (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`).
- Must pass `npm run build` with zero TypeScript or lint errors.
- Clicking any drink card must navigate directly to `/menu/[itemId]`.

---

### Task 1: Implement Sticky Arc Trajectory Gallery Component

**Files:**
- Modify: `components/marketing/best-sellers-gallery.tsx`

**Interfaces:**
- Consumes: `MenuItem` from `@/lib/supabase/menu-data`, `formatVND` from `@/lib/format`
- Produces: `BestSellersGallery({ items }: { items: MenuItem[] })`

- [ ] **Step 1: Write `best-sellers-gallery.tsx` with parabolic arc math transforms**

```tsx
"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

function ArcItem({
  item,
  index,
  total,
  scrollYProgress,
}: {
  item: MenuItem
  index: number
  total: number
  scrollYProgress: any
}) {
  const locale = useLocale()
  const name = locale === "vi" ? item.nameVi : item.nameEn

  // Calculate normalized progress window for this item
  const step = 1 / Math.max(total, 1)
  const windowStart = index * step * 0.7
  const windowEnd = Math.min(1, windowStart + step * 1.5)
  const windowMid = (windowStart + windowEnd) / 2

  // Transform mappings for parabolic arc: Bottom-Right -> Center-Apex -> Top-Left
  const x = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["70vw", "0vw", "-70vw"]
  )

  const y = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["50vh", "-12vh", "-60vh"]
  )

  const scale = useTransform(
    scrollYProgress,
    [
      windowStart,
      windowStart + (windowMid - windowStart) * 0.5,
      windowMid,
      windowMid + (windowEnd - windowMid) * 0.5,
      windowEnd,
    ],
    [0.7, 0.95, 1.15, 0.95, 0.7]
  )

  const opacity = useTransform(
    scrollYProgress,
    [
      windowStart,
      windowStart + (windowMid - windowStart) * 0.3,
      windowMid + (windowEnd - windowMid) * 0.7,
      windowEnd,
    ],
    [0, 1, 1, 0]
  )

  const rotate = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    [14, 0, -14]
  )

  return (
    <motion.div
      className="absolute flex items-center justify-center"
      style={{
        x,
        y,
        scale,
        opacity,
        rotate,
        zIndex: Math.round(100 - Math.abs(index - total / 2)),
      }}
    >
      <Link
        href={`/menu/${item.id}` as any}
        className="group relative flex w-[78vw] max-w-[340px] flex-col overflow-hidden rounded-2xl bg-[#160f0b] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/10 transition-all duration-300 hover:border-primary/50 hover:shadow-primary/20 sm:max-w-[420px] md:max-w-[480px] md:p-5"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted">
          <ItemImage
            item={item}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-85 transition-opacity group-hover:opacity-70" />

          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-5 md:right-5">
            <div className="max-w-[70%]">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-accent md:text-xs">
                PhaDin Selection
              </span>
              <h4 className="line-clamp-1 text-lg font-black md:text-2xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary px-3.5 py-1 text-xs font-black text-primary-foreground shadow-lg md:text-sm">
              {formatVND(item.basePrice)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Landing")
  const containerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  })

  const displayItems = items.length > 0 ? items : []

  if (displayItems.length === 0) return null

  return (
    <section ref={containerRef} className="relative h-[350vh] bg-[#070504]">
      <div className="sticky top-0 flex h-screen w-full flex-col items-center justify-between overflow-hidden py-10 md:py-14">
        {/* Ambient background glows */}
        <div className="pointer-events-none absolute -left-32 top-1/3 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[150px]" />
        <div className="pointer-events-none absolute -right-32 bottom-1/3 h-[500px] w-[500px] rounded-full bg-accent/10 blur-[150px]" />

        {/* Section Title */}
        <div className="relative z-10 text-center px-4">
          <div className="flex items-center justify-center gap-2 text-accent">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-extrabold uppercase tracking-widest">Craft & Motion</span>
          </div>
          <h2 className="mt-1 text-3xl font-black text-white md:text-5xl">{t("bestSellers")}</h2>
          <p className="mt-1 text-xs text-white/60 md:text-sm">Scroll down to explore signature creations</p>
        </div>

        {/* Arc Trajectory Motion Viewport */}
        <div className="relative flex h-full w-full items-center justify-center">
          {displayItems.map((item, index) => (
            <ArcItem
              key={item.id}
              item={item}
              index={index}
              total={displayItems.length}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>

        {/* Footer Navigation Link */}
        <div className="relative z-10 px-4">
          <Link
            href="/menu"
            className="flex items-center gap-2 rounded-full bg-white/10 px-6 py-2.5 text-sm font-extrabold text-white backdrop-blur-md transition-all hover:bg-primary hover:text-primary-foreground hover:shadow-lg"
          >
            <span>{t("viewAll")}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit Task 1**

```bash
git add components/marketing/best-sellers-gallery.tsx
git commit -m "feat(landing): implement sticky curved arc trajectory motion gallery"
```

---

### Task 2: Build Verification & Testing

**Files:**
- None (Build verification step)

- [ ] **Step 1: Check TypeScript compilation**

Run: `npx tsc --noEmit`
Expected output: 0 errors.

- [ ] **Step 2: Check production build**

Run: `npm run build`
Expected output: `✓ Compiled successfully`.

---
