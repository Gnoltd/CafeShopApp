# Spotlight Hero Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's 50vh gradient banner with a full-screen, dark, cursor-spotlight hero (per `docs/superpowers/specs/2026-07-08-spotlight-hero-landing-design.md`), keeping the promo/best-sellers/categories sections below it unchanged.

**Architecture:** Two new client components (`SpotlightHero`, `LandingNav`) rendered full-bleed at the top of the existing `LandingView`; the spotlight is a CSS `radial-gradient` mask (pure string builder in `lib/spotlight-mask.ts`, unit-tested) driven by a RAF-smoothed cursor position. Playfair Display italic joins Be Vietnam Pro via `next/font`; the spec's load-animation keyframes go into `app/globals.css`.

**Tech Stack:** Next.js App Router, Tailwind v4 (`@theme` tokens, no config file), next-intl, lucide-react, Vitest.

## Global Constraints

- Bilingual: every new UI string is a `Landing.*` key added to **both** `messages/vi.json` and `messages/en.json`. "PhaDinCafe" is a proper noun — never translated.
- Brand: semantic Tailwind classes only (`bg-primary`, `text-primary-foreground`) — never hardcode brand hex values.
- Body font stays Be Vietnam Pro; Playfair Display italic is display-accent only (headline line 1 + wordmark).
- Locale-aware links use `Link` from `@/i18n/navigation`, never `next/link`.
- `SPOTLIGHT_R = 260`; mask stops exactly: `1 @ 0%`, `1 @ 40%`, `0.75 @ 60%`, `0.4 @ 75%`, `0.12 @ 88%`, `0 @ 100%`.
- Existing promo / best-sellers / categories sections and `QrScannerOverlay` behavior must not change.
- Verification source of truth is the live Vercel deployment (https://phadincafe.vercel.app), not `npm run dev`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/spotlight-mask.ts` | Create | Pure mask-gradient string builder + `SPOTLIGHT_R` constant |
| `lib/spotlight-mask.test.ts` | Create | Vitest unit tests for the builder |
| `app/[locale]/layout.tsx` | Modify | Add Playfair Display via `next/font` (`--font-playfair` variable) |
| `app/globals.css` | Modify | `font-playfair` utility token + hero keyframes/helpers |
| `messages/en.json`, `messages/vi.json` | Modify | New `Landing.*` hero/nav keys; old hero keys removed in Task 5 |
| `components/marketing/landing-nav.tsx` | Create | Absolute nav over the hero (wordmark, center pill, Sign Up) |
| `components/marketing/spotlight-hero.tsx` | Create | Full-screen hero: images, spotlight, headline, CTAs |
| `components/marketing/landing-view.tsx` | Modify | Swap old hero for nav+hero; wrap remaining sections in `max-w-2xl` |

---

### Task 1: Spotlight mask builder (`lib/spotlight-mask.ts`)

**Files:**
- Create: `lib/spotlight-mask.ts`
- Test: `lib/spotlight-mask.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SPOTLIGHT_R: number` (260) and `spotlightMask(x: number, y: number, radius?: number): string` — a CSS `radial-gradient(...)` string usable as `maskImage`. Task 4 imports both from `@/lib/spotlight-mask`.

- [ ] **Step 1: Write the failing test**

Create `lib/spotlight-mask.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { SPOTLIGHT_R, spotlightMask } from "./spotlight-mask"

describe("spotlightMask", () => {
  it("exports the design-spec radius", () => {
    expect(SPOTLIGHT_R).toBe(260)
  })

  it("centers the gradient at the given coordinates with the default radius", () => {
    expect(spotlightMask(120, 340)).toContain("circle 260px at 120px 340px")
  })

  it("produces the exact six soft-edge stops from the design spec", () => {
    expect(spotlightMask(0, 0)).toBe(
      "radial-gradient(circle 260px at 0px 0px, " +
        "rgba(255,255,255,1) 0%, " +
        "rgba(255,255,255,1) 40%, " +
        "rgba(255,255,255,0.75) 60%, " +
        "rgba(255,255,255,0.4) 75%, " +
        "rgba(255,255,255,0.12) 88%, " +
        "rgba(255,255,255,0) 100%)"
    )
  })

  it("accepts a custom radius", () => {
    expect(spotlightMask(10, 20, 100)).toContain("circle 100px at 10px 20px")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/spotlight-mask.test.ts`
Expected: FAIL — cannot resolve `./spotlight-mask`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/spotlight-mask.ts`:

```ts
export const SPOTLIGHT_R = 260

/**
 * CSS radial-gradient mask string for the landing hero's cursor spotlight.
 * Stops match the Lithos hero spec (soft glowing edge, fully transparent rim).
 */
export function spotlightMask(x: number, y: number, radius: number = SPOTLIGHT_R): string {
  return (
    `radial-gradient(circle ${radius}px at ${x}px ${y}px, ` +
    "rgba(255,255,255,1) 0%, " +
    "rgba(255,255,255,1) 40%, " +
    "rgba(255,255,255,0.75) 60%, " +
    "rgba(255,255,255,0.4) 75%, " +
    "rgba(255,255,255,0.12) 88%, " +
    "rgba(255,255,255,0) 100%)"
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/spotlight-mask.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spotlight-mask.ts lib/spotlight-mask.test.ts
git commit -m "Add spotlightMask gradient builder for landing hero"
```

---

### Task 2: Playfair Display font + hero animations

**Files:**
- Modify: `app/[locale]/layout.tsx:5,16-20,48-51`
- Modify: `app/globals.css` (one line in `@theme inline`; keyframes appended at end)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utility `font-playfair`; CSS classes `hero-anim`, `hero-reveal`, `hero-fade`, `hero-zoom`. Tasks 3–5 use these class names exactly.

- [ ] **Step 1: Add Playfair Display to the root layout**

In `app/[locale]/layout.tsx`, change the font import line:

```tsx
import { Be_Vietnam_Pro, Playfair_Display } from "next/font/google";
```

Below the existing `beVietnamPro` constant, add:

```tsx
const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});
```

Change the `<html>` className to include it:

```tsx
className={`${beVietnamPro.variable} ${playfairDisplay.variable} h-full antialiased`}
```

- [ ] **Step 2: Register the `font-playfair` utility**

In `app/globals.css`, inside the `@theme inline { ... }` block, add one line next to the existing `--font-sans` line:

```css
  --font-playfair: var(--font-playfair);
```

(Tailwind v4 generates the `font-playfair` utility from any `--font-*` theme key.)

- [ ] **Step 3: Append the hero keyframes**

At the very end of `app/globals.css`, append:

```css
/* Landing spotlight hero — load animations (spec: 2026-07-08-spotlight-hero-landing-design.md) */
@keyframes heroReveal {
  0% { opacity: 0; transform: translateY(28px); filter: blur(12px); }
  100% { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes heroFadeUp {
  0% { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes heroZoom {
  0% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
.hero-anim {
  opacity: 0;
  animation-fill-mode: forwards;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
.hero-reveal { animation-name: heroReveal; animation-duration: 1.1s; }
.hero-fade { animation-name: heroFadeUp; animation-duration: 1s; }
.hero-zoom { animation: heroZoom 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .hero-anim,
  .hero-zoom {
    animation: none;
    opacity: 1;
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds with no errors (utilities aren't used anywhere yet — this only proves the font/CSS wiring compiles).

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/layout.tsx app/globals.css
git commit -m "Add Playfair Display display font and hero load-animation keyframes"
```

---

### Task 3: Bilingual message keys

**Files:**
- Modify: `messages/en.json` (inside the existing `"Landing"` object, after `"scanQr"`)
- Modify: `messages/vi.json` (same position)

**Interfaces:**
- Consumes: nothing.
- Produces: `Landing.heroLine1`, `heroLine2`, `heroLeftText`, `heroRightText`, `navMenu`, `navOrders`, `navLoyalty`, `navProfile`, `navSignUp` — consumed by Tasks 4 and 5 via `useTranslations("Landing")`. Do **not** remove `heroHeadline`/`heroSubheadline` yet — `landing-view.tsx` still uses them until Task 5.

- [ ] **Step 1: Add the English keys**

In `messages/en.json`, inside `"Landing"`, after the `"scanQr"` line, add:

```json
    "heroLine1": "Every bean holds",
    "heroLine2": "a story worth tasting",
    "heroLeftText": "Carefully selected beans, roasted slowly and brewed fresh every day — each cup holds its own warmth, aroma, and a moment worth savoring.",
    "heroRightText": "Order in seconds, from your phone or right at your table — your coffee starts brewing the moment you tap.",
    "navMenu": "Menu",
    "navOrders": "Orders",
    "navLoyalty": "Loyalty",
    "navProfile": "Profile",
    "navSignUp": "Sign Up",
```

- [ ] **Step 2: Add the Vietnamese keys**

In `messages/vi.json`, inside `"Landing"`, after the `"scanQr"` line, add:

```json
    "heroLine1": "Từng hạt cà phê",
    "heroLine2": "kể một câu chuyện",
    "heroLeftText": "Hạt cà phê tuyển chọn kỹ, rang chậm và pha mới mỗi ngày — mỗi tách cà phê mang hương thơm, sự ấm áp và một khoảnh khắc đáng thưởng thức.",
    "heroRightText": "Đặt món trong vài giây, từ điện thoại hoặc ngay tại bàn — ly cà phê của bạn được pha ngay khi bạn chạm.",
    "navMenu": "Thực đơn",
    "navOrders": "Đơn hàng",
    "navLoyalty": "Tích điểm",
    "navProfile": "Tài khoản",
    "navSignUp": "Đăng ký",
```

- [ ] **Step 3: Verify both files parse and keys match**

Run: `node -e "const en=require('./messages/en.json').Landing,vi=require('./messages/vi.json').Landing;const ek=Object.keys(en).sort(),vk=Object.keys(vi).sort();console.log(JSON.stringify(ek)===JSON.stringify(vk)?'KEYS MATCH':'MISMATCH: '+ek.filter(k=>!vk.includes(k)).concat(vk.filter(k=>!ek.includes(k))))"`
Expected: `KEYS MATCH`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add bilingual Landing keys for spotlight hero and nav"
```

---

### Task 4: `LandingNav` and `SpotlightHero` components

**Files:**
- Create: `components/marketing/landing-nav.tsx`
- Create: `components/marketing/spotlight-hero.tsx`

**Interfaces:**
- Consumes: `spotlightMask` from `@/lib/spotlight-mask` (Task 1); `font-playfair`, `hero-*` classes (Task 2); `Landing.*` keys (Task 3).
- Produces: `LandingNav()` (no props) and `SpotlightHero({ onScanQr }: { onScanQr: () => void })` — imported by Task 5. Both are `"use client"` components positioned inside a shared `relative` wrapper that Task 5 provides.

No unit tests — these are presentational client components with browser-only behavior (RAF, mouse/touch events); the project verifies UI live on Vercel (Task 6). The mask math they depend on is already unit-tested (Task 1).

- [ ] **Step 1: Create `components/marketing/landing-nav.tsx`**

```tsx
"use client"

import { Coffee } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"

const NAV_LINKS = [
  { key: "navMenu", href: "/menu", active: true },
  { key: "navOrders", href: "/orders", active: false },
  { key: "navLoyalty", href: "/loyalty", active: false },
  { key: "navProfile", href: "/profile", active: false },
] as const

export function LandingNav() {
  const t = useTranslations("Landing")

  return (
    <nav className="absolute top-0 left-0 right-0 z-[60] flex items-center justify-between p-4 sm:p-5">
      <span className="flex items-center gap-2">
        <Coffee className="h-[26px] w-[26px] text-white" aria-hidden />
        <span className="font-playfair text-2xl italic text-white">PhaDinCafe</span>
      </span>
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/30 bg-white/20 px-2 py-2 backdrop-blur-md md:flex">
        {NAV_LINKS.map(({ key, href, active }) => (
          <Link
            key={key}
            href={href}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              active ? "text-white" : "text-white/80 hover:bg-white/20 hover:text-white"
            }`}
          >
            {t(key)}
          </Link>
        ))}
      </div>
      <Link
        href="/signup"
        className="mr-12 hidden rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 md:block"
      >
        {t("navSignUp")}
      </Link>
    </nav>
  )
}
```

Notes baked into this code:
- Wordmark is a `<span>`, not a link — the nav lives on `/` already.
- `mr-12` on Sign Up clears the app's fixed LanguageSwitcher/RoleBadge cluster at `top-2 right-2 z-50`.
- Below `md`, only the wordmark shows (no hamburger — hero CTAs handle mobile).

- [ ] **Step 2: Create `components/marketing/spotlight-hero.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { spotlightMask } from "@/lib/spotlight-mask"

// Swappable hero photography (CSS backgrounds, no next/image config needed).
// Base: dark moody coffee; reveal: warm glowing cup, shown through the spotlight.
const BASE_IMAGE =
  "https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1600&q=80"
const REVEAL_IMAGE =
  "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1600&q=80"

export function SpotlightHero({ onScanQr }: { onScanQr: () => void }) {
  const t = useTranslations("Landing")
  const mouse = useRef({ x: 0, y: 0 })
  const smooth = useRef({ x: 0, y: 0 })
  const rafRef = useRef(0)
  const [cursorPos, setCursorPos] = useState({ x: -999, y: -999 })

  useEffect(() => {
    // Start at screen center so touch devices see the reveal immediately.
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    mouse.current = { ...center }
    smooth.current = { ...center }
    setCursorPos(center)

    const onMouseMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY }
    }
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) mouse.current = { x: touch.clientX, y: touch.clientY }
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("touchmove", onTouchMove, { passive: true })

    const tick = () => {
      smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1
      smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1
      setCursorPos({ x: smooth.current.x, y: smooth.current.y })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("touchmove", onTouchMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const mask = spotlightMask(cursorPos.x, cursorPos.y)

  return (
    <section
      className="relative h-screen w-full overflow-hidden bg-black"
      style={{ height: "100dvh" }}
    >
      <div
        className="hero-zoom absolute inset-0 z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${BASE_IMAGE})` }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${REVEAL_IMAGE})`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
      <div className="pointer-events-none absolute left-0 right-0 top-[14%] z-50 flex flex-col items-center px-5 text-center">
        <h1 className="leading-[0.95] text-white">
          <span
            className="hero-anim hero-reveal font-playfair block text-5xl font-normal italic sm:text-7xl md:text-8xl"
            style={{ letterSpacing: "-0.05em", animationDelay: "0.25s" }}
          >
            {t("heroLine1")}
          </span>
          <span
            className="hero-anim hero-reveal -mt-1 block text-5xl font-normal sm:text-7xl md:text-8xl"
            style={{ letterSpacing: "-0.08em", animationDelay: "0.42s" }}
          >
            {t("heroLine2")}
          </span>
        </h1>
      </div>
      <div
        className="hero-anim hero-fade absolute bottom-14 left-10 z-50 hidden max-w-[260px] sm:block md:left-14"
        style={{ animationDelay: "0.7s" }}
      >
        <p className="text-sm leading-relaxed text-white/80">{t("heroLeftText")}</p>
      </div>
      <div
        className="hero-anim hero-fade absolute bottom-10 left-5 right-5 z-50 flex max-w-full flex-col items-start gap-4 sm:bottom-24 sm:left-auto sm:right-10 sm:max-w-[260px] sm:gap-5 md:right-14"
        style={{ animationDelay: "0.85s" }}
      >
        <p className="text-xs leading-relaxed text-white/80 sm:text-sm">{t("heroRightText")}</p>
        <Link
          href="/menu"
          className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition-all hover:scale-[1.03] hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-95"
        >
          {t("orderNow")}
        </Link>
        <button
          type="button"
          onClick={onScanQr}
          className="flex items-center gap-2 rounded-full border border-white/70 px-7 py-3 text-sm font-medium text-white transition-all hover:scale-[1.03] hover:bg-white/10 active:scale-95"
        >
          <QrCode className="h-4 w-4" aria-hidden />
          {t("scanQr")}
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds (components exist but aren't rendered yet).

- [ ] **Step 4: Commit**

```bash
git add components/marketing/landing-nav.tsx components/marketing/spotlight-hero.tsx
git commit -m "Add LandingNav and SpotlightHero components"
```

---

### Task 5: Rewire `LandingView`, retire old hero keys

**Files:**
- Modify: `components/marketing/landing-view.tsx:31-56,120-122`
- Modify: `messages/en.json`, `messages/vi.json` (remove 2 keys each)

**Interfaces:**
- Consumes: `LandingNav` and `SpotlightHero({ onScanQr })` from Task 4.
- Produces: the final landing page. `LandingView`'s external contract (`{ bestSellers: MenuItem[] }` prop, rendered by `app/[locale]/(marketing)/page.tsx`) is unchanged.

- [ ] **Step 1: Replace the hero section in `landing-view.tsx`**

Add the two imports:

```tsx
import { LandingNav } from "@/components/marketing/landing-nav"
import { SpotlightHero } from "@/components/marketing/spotlight-hero"
```

Remove the now-unused imports from the old hero: `QrCode` (from the lucide-react import list) and `Button` (`@/components/ui/button`). Keep `Coffee, CupSoda, Cookie, Milk` (ICONS map), `Sparkles, ArrowRight`, `Link`, `formatVND`, `QrScannerOverlay`.

Replace the component's return so the old `<section className="relative flex h-[50vh] ...">...</section>` block (the entire first section) is gone, the hero is full-bleed, and the surviving sections keep the old `max-w-2xl` container:

```tsx
  return (
    <div className="w-full">
      <div className="relative">
        <LandingNav />
        <SpotlightHero onScanQr={() => setIsScannerOpen(true)} />
      </div>

      <div className="mx-auto w-full max-w-2xl">
        {/* promo section — unchanged */}
        {/* best-sellers section — unchanged */}
        {/* categories section — unchanged */}
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
```

(The three comment lines above stand for the existing JSX blocks — move them inside the new `max-w-2xl` div verbatim, do not retype them. The `relative` wrapper is what the nav's `absolute` positioning anchors to, so the nav overlays exactly the hero and scrolls away with it.)

- [ ] **Step 2: Remove the retired keys from both message files**

Delete these two lines from the `"Landing"` object in **both** `messages/en.json` and `messages/vi.json`:

```json
    "heroHeadline": "…",
    "heroSubheadline": "…",
```

- [ ] **Step 3: Verify no references to the retired keys remain**

Run: `npx vitest run` then `npm run build`
Expected: all existing tests pass; build succeeds.

Also run: `node -e "const en=require('./messages/en.json').Landing,vi=require('./messages/vi.json').Landing;console.log(en.heroHeadline===undefined&&vi.heroHeadline===undefined?'RETIRED':'STILL PRESENT')"`
Expected: `RETIRED`

- [ ] **Step 4: Commit**

```bash
git add components/marketing/landing-view.tsx messages/en.json messages/vi.json
git commit -m "Replace landing banner with full-screen spotlight hero"
```

---

### Task 6: Deploy and live verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above, deployed.
- Produces: verified feature; `daily.md`/docs updates if the project tracks them.

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

Vercel auto-deploys; wait for the deployment to go live (check https://vercel.com or just poll the site).

- [ ] **Step 2: Verify on https://phadincafe.vercel.app (desktop)**

- `/vi` and `/en` both render the full-screen dark hero, correct copy per locale.
- Moving the mouse: the warm reveal image follows the cursor through a soft-edged circle, trailing smoothly (lerp), no jank.
- Load animations: headline lines blur-rise staggered, bottom blocks fade up, base image slowly zooms out.
- Nav: wordmark in Playfair italic; pill links route to `/menu`, `/orders`, `/loyalty`, `/profile` (locale-prefixed); Sign Up routes to `/signup` and does not overlap the LanguageSwitcher.
- "Order Now" → `/menu`. "Scan QR at Table" opens the camera scanner overlay; closing it returns to the hero.
- Scrolling: nav scrolls away with the hero; promo, best-sellers, categories sections render below exactly as before.

- [ ] **Step 3: Verify on a phone (or devtools mobile emulation + touch)**

- Hero fills the visible viewport (`100dvh`, no browser-chrome clipping).
- Spotlight is visible at screen center on load and follows touch drags.
- Center pill and Sign Up are hidden; wordmark shows; bottom-right block spans full width with both CTAs tappable; bottom-left paragraph hidden.

- [ ] **Step 4: Verify reduced motion**

In devtools (Rendering → Emulate CSS `prefers-reduced-motion: reduce`): reload — no load animations, all hero content immediately visible; spotlight still follows the cursor (user-driven, allowed).

- [ ] **Step 5: If anything fails**

Use superpowers:systematic-debugging — reproduce, isolate (component / CSS / i18n / deployment), fix, redeploy, re-verify. Do not mark this task complete until every check above passes on the live site.

- [ ] **Step 6: Update docs and commit**

Mark the feature shipped where the project tracks status (`daily.md`), note anything learned worth a CLAUDE.md gotcha (only if genuinely cross-cutting), then:

```bash
git add -A
git commit -m "Docs: spotlight hero landing shipped and live-verified"
git push origin main
```
