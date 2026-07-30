# Landing Page Best Sellers Parallax Gallery & Infinite Marquee Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a high-performance, scroll-driven staggered parallax gallery and infinite floating product marquee stream on the landing page based on `newmixcoffee.com`.

**Architecture:** Build two dedicated motion components in `components/marketing/` using `framer-motion`: `BestSellersGallery` (for scroll-driven staggered parallax cards with `clip-path` inset reveals and image scale transforms) and `BestSellersMarquee` (for horizontal continuous product stream with hover interactions). Integrate both into `LandingView`.

**Tech Stack:** Next.js (App Router), React, Tailwind v4 CSS, Framer Motion, TypeScript.

## Global Constraints

- Follow `CLAUDE.md` design rules: Tailwind v4 theme variables (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`).
- Responsive layout: Mobile-first styling with desktop `md:` breakpoint enhancements.
- All code must pass `npm run build` with zero TypeScript or lint errors.

---

### Task 1: Create BestSellersGallery Motion Component

**Files:**
- Create: `components/marketing/best-sellers-gallery.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (add localization keys for gallery title/subtitle if needed)

**Interfaces:**
- Consumes: `MenuItem` from `@/lib/supabase/menu-data`, `formatVND` from `@/lib/format`
- Produces: `BestSellersGallery({ items }: { items: MenuItem[] })`

- [ ] **Step 1: Create `best-sellers-gallery.tsx` with staggered scroll parallax physics**

```tsx
"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const STAGGER_OFFSETS = [-15, 8, -10, 18, -5, 12, -12, 15, -8, 10]

function GalleryCard({ item, index }: { item: MenuItem; index: number }) {
  const locale = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  const clipInset = useTransform(scrollYProgress, [0, 0.4, 0.8], ["20%", "0%", "0%"])
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [1.35, 1.05, 1.0])
  const offsetX = STAGGER_OFFSETS[index % STAGGER_OFFSETS.length]
  const name = locale === "vi" ? item.nameVi : item.nameEn

  return (
    <motion.div
      ref={ref}
      className="relative my-4 w-[75%] max-w-[550px] overflow-hidden rounded-2xl bg-[#140e0a] p-3 shadow-2xl md:my-6 md:w-[65%] md:max-w-[700px] md:p-4"
      style={{
        x: `${offsetX}%`,
      }}
    >
      <Link href="/menu" className="group block overflow-hidden rounded-xl">
        <motion.div
          className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted"
          style={{
            clipPath: useTransform(clipInset, (v) => `inset(${v} 0%)`),
          }}
        >
          <motion.div className="h-full w-full" style={{ scale }}>
            <ItemImage item={item} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
          </motion.div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-60" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-6 md:right-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-accent">PhaDin Selection</p>
              <h4 className="text-lg font-extrabold md:text-2xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary/90 px-3 py-1 text-sm font-black text-primary-foreground shadow-md backdrop-blur-md">
              {formatVND(item.basePrice)}
            </span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  )
}

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Landing")
  const displayItems = items.length > 0 ? items : []

  if (displayItems.length === 0) return null

  return (
    <section className="relative overflow-hidden bg-[#0a0705] py-16 md:py-24">
      <div className="mx-auto flex flex-col items-center px-4">
        <div className="mb-10 text-center md:mb-16">
          <span className="text-xs font-extrabold uppercase tracking-widest text-accent">Craft & Passion</span>
          <h2 className="mt-1 text-3xl font-black text-white md:text-5xl">{t("bestSellers")}</h2>
          <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-primary" />
        </div>

        <div className="flex w-full flex-col items-center">
          {displayItems.map((item, index) => (
            <GalleryCard key={item.id} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit Task 1**

```bash
git add components/marketing/best-sellers-gallery.tsx
git commit -m "feat(landing): add BestSellersGallery staggered scroll parallax component"
```

---

### Task 2: Create BestSellersMarquee Motion Component

**Files:**
- Create: `components/marketing/best-sellers-marquee.tsx`

**Interfaces:**
- Consumes: `MenuItem` from `@/lib/supabase/menu-data`, `formatVND` from `@/lib/format`
- Produces: `BestSellersMarquee({ items }: { items: MenuItem[] })`

- [ ] **Step 1: Create `best-sellers-marquee.tsx` with infinite marquee loop and hover pause**

```tsx
"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { useLocale } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

export function BestSellersMarquee({ items }: { items: MenuItem[] }) {
  const locale = useLocale()
  const [isPaused, setIsPaused] = useState(false)

  if (!items || items.length === 0) return null

  // Duplicate items to ensure smooth continuous marquee loop
  const marqueeItems = [...items, ...items, ...items]

  return (
    <section className="relative overflow-hidden bg-black py-12 md:py-20">
      <div className="mb-6 px-6 text-center md:mb-10">
        <h3 className="text-xl font-bold uppercase tracking-wider text-white/90 md:text-2xl">
          Signature Stream
        </h3>
        <p className="mt-1 text-xs text-white/60 md:text-sm">Hover to explore details</p>
      </div>

      <div
        className="relative flex w-full overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Gradient edge overlays */}
        <div className="pointer-events-none absolute bottom-0 top-0 left-0 z-10 w-16 bg-gradient-to-r from-black to-transparent md:w-32" />
        <div className="pointer-events-none absolute bottom-0 top-0 right-0 z-10 w-16 bg-gradient-to-l from-black to-transparent md:w-32" />

        <motion.div
          className="flex shrink-0 gap-6 py-4 md:gap-10"
          animate={{ x: isPaused ? undefined : ["0%", "-50%"] }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 35,
              ease: "linear",
            },
          }}
        >
          {marqueeItems.map((item, idx) => {
            const name = locale === "vi" ? item.nameVi : item.nameEn
            const isTall = idx % 2 === 1

            return (
              <Link
                key={`${item.id}-${idx}`}
                href="/menu"
                className="group relative flex shrink-0 flex-col items-center justify-end rounded-2xl bg-[#18120e] p-4 text-center transition-all duration-300 hover:scale-105 hover:bg-[#241b15] hover:shadow-2xl hover:shadow-primary/20"
                style={{
                  width: isTall ? "220px" : "180px",
                  height: isTall ? "320px" : "260px",
                }}
              >
                <div className="relative mb-3 flex h-3/5 w-full items-center justify-center overflow-hidden rounded-xl">
                  <ItemImage
                    item={item}
                    className="h-full w-full object-contain filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                <h4 className="line-clamp-1 text-sm font-bold text-white group-hover:text-primary">
                  {name}
                </h4>
                <span className="mt-1 text-xs font-black text-accent">{formatVND(item.basePrice)}</span>
              </Link>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit Task 2**

```bash
git add components/marketing/best-sellers-marquee.tsx
git commit -m "feat(landing): add BestSellersMarquee continuous horizontal product stream component"
```

---

### Task 3: Integrate Motion Components into LandingView

**Files:**
- Modify: `components/marketing/landing-view.tsx`

**Interfaces:**
- Consumes: `BestSellersGallery` and `BestSellersMarquee`
- Produces: Enhanced `LandingView`

- [ ] **Step 1: Update `landing-view.tsx` to include the new parallax gallery and marquee sections**

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { LandingNav } from "@/components/marketing/landing-nav"
import { CoffeeCupHero } from "@/components/marketing/coffee-cup-hero"
import { BestSellersGallery } from "@/components/marketing/best-sellers-gallery"
import { BestSellersMarquee } from "@/components/marketing/best-sellers-marquee"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import type { MenuItem } from "@/lib/supabase/menu-data"
import type { LandingHeroSettings } from "@/lib/supabase/settings-data"

const CATEGORY_CHIPS = [
  { id: "coffee", labelVi: "Cà Phê", labelEn: "Coffee" },
  { id: "tea", labelVi: "Trà", labelEn: "Tea" },
  { id: "pastries", labelVi: "Bánh Ngọt", labelEn: "Pastries" },
  { id: "blended", labelVi: "Đá Xay", labelEn: "Blended" },
]

export function LandingView({
  bestSellers,
  landingHero,
  userName = null,
}: {
  bestSellers: MenuItem[]
  landingHero: LandingHeroSettings
  userName?: string | null
}) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  return (
    <div className="w-full bg-background">
      <div className="relative">
        <LandingNav userName={userName} />
        <CoffeeCupHero
          onScanQr={() => setIsScannerOpen(true)}
          baseImages={landingHero.baseImages}
          revealImage={landingHero.revealImage}
        />
      </div>

      {/* High-Impact Motion Sections */}
      <BestSellersGallery items={bestSellers} />
      <BestSellersMarquee items={bestSellers} />

      <div className="mx-auto w-full max-w-2xl md:max-w-6xl md:px-8">
        <section className="px-4 pt-10 md:px-0">
          <div className="nb-border nb-shadow relative overflow-hidden rounded-xl bg-card p-5 md:p-8">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-extrabold uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            <h3 className="mb-1 font-extrabold text-card-foreground md:text-xl">{t("promoTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground md:text-base md:max-w-2xl">{t("promoDescription")}</p>
            <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-primary px-4 py-1.5 text-sm font-extrabold text-primary-foreground">
              {t("promoBadge")}
            </span>
          </div>
        </section>

        <section className="my-10 flex gap-2 overflow-x-auto px-4 pb-8 md:flex-wrap md:justify-center md:gap-4 md:px-0">
          <span className="mb-1 sr-only">{t("categories")}</span>
          {CATEGORY_CHIPS.map((category) => {
            const label = locale === "vi" ? category.labelVi : category.labelEn
            return (
              <Link
                key={category.id}
                href="/menu"
                className="nb-border-sm nb-shadow-sm nb-press-sm flex shrink-0 items-center gap-1 rounded-full bg-card px-4 py-2 text-sm font-extrabold text-foreground"
              >
                {label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )
          })}
        </section>
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit Task 3**

```bash
git add components/marketing/landing-view.tsx
git commit -m "feat(landing): integrate BestSellersGallery and BestSellersMarquee into LandingView"
```

---

### Task 4: Build Verification & Testing

**Files:**
- None (Build verification step)

- [ ] **Step 1: Run production build check**

Run: `npm run build`
Expected output: `✓ Compiled successfully` with zero TypeScript or lint errors.

- [ ] **Step 2: Commit final verification**

```bash
git commit --allow-empty -m "chore(landing): verify production build passes"
```

---
