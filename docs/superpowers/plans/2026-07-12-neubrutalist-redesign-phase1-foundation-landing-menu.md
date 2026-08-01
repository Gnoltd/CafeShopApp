# Neubrutalist Modern Redesign — Phase 1 (Foundation + Landing + Menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design-token foundation (updated color tokens, first-ever working dark mode, new Neubrutalist shared Button/Badge variants) and re-skin Landing (`/`) + Menu (`/menu`) to the Neubrutalist Modern system, per `docs/superpowers/specs/2026-07-12-elevated-warm-redesign-design.md`.

**Architecture:** `app/globals.css` already has a dormant `.dark` class + `@custom-variant dark` (shadcn scaffold, never wired to a toggle) — this plan updates its color values to the new dark palette and adds a `ThemeProvider`/`ThemeToggle` that actually flips it. New Neubrutalist visual primitives (hard-offset shadow, thick ink border, shadow-collapse press) are added as `variant="neubrutal"` options on the existing `components/ui/button.tsx`/`badge.tsx` — **additive**, not a default-variant change, so every other page (not yet redesigned) keeps rendering exactly as it does today except for the global color/token shift in Task 1. Landing (`landing-view.tsx`) and Menu (`menu-browser.tsx`) opt into the new variant explicitly.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, existing `framer-motion`/`class-variance-authority`/`@base-ui/react` — no new dependency.

## Global Constraints

- No backend/RPC/schema changes — presentational only, per the spec's Out of Scope section.
- No new runtime dependency — dark-mode toggling is a small custom Context (matching `hooks/useCart.tsx`'s existing Context+Provider pattern), not `next-themes`.
- `components/ui/button.tsx` and `components/ui/badge.tsx` gain an **additive** `variant="neubrutal"` — the existing `default`/`outline`/`ghost`/etc. variants and their current class strings are left byte-for-byte unchanged, so any page not touched by this plan renders identically to before except for the color-token values from Task 1 (see below — this is an accepted, intentional, small interim shift).
- `app/globals.css`'s `:root`/`.dark` **color values** change in Task 1 (this is global and affects every page immediately — accepted per the spec's single-design-system goal). `--radius` is **left unchanged** in Task 1 to minimize interim visual disruption on pages not yet redesigned; Neubrutalist-specific sharper corners are applied via explicit Tailwind classes only on the new `neubrutal` variants and the new Landing/Menu markup, not by lowering the global `--radius` token.
- No fake/placeholder marketing copy: the mockup's illustrative "promo strip" text on Menu is **not** implemented as real content in this plan — there is no `promotions` table or CMS field backing it (confirmed: `LandingView`'s existing `t("promoTitle")`/`t("promoDescription")`/`t("promoBadge")` are the only real promo copy in the app, already wired to real `next-intl` message keys). Menu keeps its promo-strip-free structure (category pills + grid only); Landing's existing real promo section gets re-skinned, not replaced.
- Real content only, no lorem ipsum — item names/prices/categories come from the existing `MenuItem`/`MenuCategory` props already flowing into these components; nothing hardcoded.
- Both `messages/vi.json` and `messages/en.json` get any new translation keys added together (per CLAUDE.md's i18n convention) — this plan adds exactly one new key pair (`Theme.toggleLabel`) for the new theme-toggle button's `aria-label`.
- Verification source of truth is the live Vercel deployment (https://phadincafe.vercel.app) — `npm run build` + `tsc` locally are fast-feedback only, per this project's standing convention.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/globals.css` | Modify | Update `:root`/`.dark` token values to the new Neubrutalist palette; add `--chip`/`--ink`/`--price`/`--success`/`--warn` tokens + their `@theme inline` mappings; add `.nb-border`/`.nb-shadow`/`.nb-shadow-sm`/`.nb-press` composed classes under `@layer components` |
| `hooks/useTheme.tsx` | Create | `ThemeProvider`/`useTheme()` — Context holding `theme: "light" \| "dark"`, `toggleTheme()`, persists to `localStorage`, applies/removes `.dark` on `document.documentElement` |
| `components/shared/theme-toggle.tsx` | Create | `ThemeToggle` — sun/moon icon button calling `useTheme()`, styled to match the existing `LanguageSwitcher`/`RoleBadge` pill cluster |
| `app/[locale]/layout.tsx` | Modify | Add a no-flash inline theme-init `<script>` in `<head>`; wrap children in `ThemeProvider`; add `<ThemeToggle />` next to `LanguageSwitcher` |
| `messages/vi.json`, `messages/en.json` | Modify | Add `Theme.toggleLabel` key pair |
| `components/ui/button.tsx` | Modify | Add `variant: "neubrutal"` to `buttonVariants` |
| `components/ui/badge.tsx` | Modify | Add `variant: "neubrutal"` to `badgeVariants` |
| `components/marketing/landing-view.tsx` | Modify | Re-skin promo section, best-seller cards, category chip links to Neubrutalist (`neubrutal` Button/Badge variants + `.nb-*` classes) — `SpotlightHero`/`LandingNav` untouched |
| `components/customer/menu-browser.tsx` | Modify | Re-skin search input wrapper, category `SegmentedControl`, item cards, quick-add button to Neubrutalist; extend the quick-add button's touch target to 44×44px via a padded wrapper without growing the visible 32px circle |

---

### Task 1: Update design tokens in `app/globals.css`

**Files:**
- Modify: `app/globals.css:57-125` (the `:root` and `.dark` blocks)

**Interfaces:**
- Consumes: nothing.
- Produces: `--chip`, `--ink`, `--price`, `--success`, `--warn` CSS custom properties (light + dark values) and their Tailwind-utility mappings (`bg-chip`, `border-ink`, `text-price`, `text-success`, `text-warn`), consumed by every later task in this plan and by Phase 2/3/4 plans.

- [ ] **Step 1: Update `:root` color values and add new tokens**

Replace the existing `:root` block (lines 57-91) with:

```css
:root {
  --background: #fff8f2;
  --foreground: #2b2118;
  --card: #fffaf5;
  --card-foreground: #2b2118;
  --popover: #fffaf5;
  --popover-foreground: #2b2118;
  --primary: #b3341f;
  --primary-foreground: #ffffff;
  --secondary: #6f4e37;
  --secondary-foreground: #fff8f2;
  --muted: #f3e9dd;
  --muted-foreground: #6f4e37;
  --accent: #c9a66b;
  --accent-foreground: #2b2118;
  --destructive: #c1440e;
  --border: #eee0d2;
  --input: #eee0d2;
  --ring: #b3341f;
  --chart-1: #b3341f;
  --chart-2: #6f4e37;
  --chart-3: #c9a66b;
  --chart-4: #e08e45;
  --chart-5: #8b5e3c;
  --radius: 0.75rem;
  --sidebar: #fff8f2;
  --sidebar-foreground: #2b2118;
  --sidebar-primary: #b3341f;
  --sidebar-primary-foreground: #fff8f2;
  --sidebar-accent: #f3e9dd;
  --sidebar-accent-foreground: #2b2118;
  --sidebar-border: #eee0d2;
  --sidebar-ring: #b3341f;
  --font-mono: ui-monospace, monospace;

  /* Neubrutalist Modern additions (2026-07-12) */
  --chip: #f9e9d4;
  --ink: #2b2118;
  --price: #b3341f;
  --success: #3f7d4e;
  --warn: #c48a1f;
}
```

- [ ] **Step 2: Update `.dark` color values and add new tokens**

Replace the existing `.dark` block (lines 93-125) with:

```css
.dark {
  --background: #1c1712;
  --foreground: #fff8f2;
  --card: #2b2118;
  --card-foreground: #fff8f2;
  --popover: #2b2118;
  --popover-foreground: #fff8f2;
  --primary: #e0663f;
  --primary-foreground: #1c1712;
  --secondary: #c9a66b;
  --secondary-foreground: #1c1712;
  --muted: #241b14;
  --muted-foreground: #c9a66b;
  --accent: #f2c88f;
  --accent-foreground: #1c1712;
  --destructive: #e0663f;
  --border: #3a2e22;
  --input: #3a2e22;
  --ring: #e0663f;
  --chart-1: #e0663f;
  --chart-2: #c9a66b;
  --chart-3: #f2c88f;
  --chart-4: #e08e45;
  --chart-5: #b3341f;
  --sidebar: #1c1712;
  --sidebar-foreground: #fff8f2;
  --sidebar-primary: #e0663f;
  --sidebar-primary-foreground: #1c1712;
  --sidebar-accent: #241b14;
  --sidebar-accent-foreground: #fff8f2;
  --sidebar-border: #3a2e22;
  --sidebar-ring: #e0663f;

  /* Neubrutalist Modern additions (2026-07-12) */
  --chip: #241b14;
  --ink: #f2c88f;
  --price: #ff8a5c;
  --success: #6bbf80;
  --warn: #e0b04a;
}
```

- [ ] **Step 3: Map the new tokens into `@theme inline` so Tailwind utilities exist**

In the `@theme inline` block (lines 7-50), add these five lines right after `--color-card: var(--card);` (line 42):

```css
  --color-chip: var(--chip);
  --color-ink: var(--ink);
  --color-price: var(--price);
  --color-success: var(--success);
  --color-warn: var(--warn);
```

This makes `bg-chip`, `text-chip`, `border-ink`, `text-ink`, `text-price`, `text-success`, `text-warn`, etc. valid Tailwind utility classes, the same way `--color-card` already makes `bg-card` work.

- [ ] **Step 4: Add Neubrutalist composed classes**

At the end of `app/globals.css` (after the existing `@media (prefers-reduced-motion: reduce)` block that closes the hero animations, currently ending at line 166), append:

```css
/* Neubrutalist Modern shared primitives (spec: 2026-07-12-elevated-warm-redesign-design.md) */
@layer components {
  .nb-border {
    border-width: 2.5px;
    border-color: var(--ink);
  }
  .nb-border-sm {
    border-width: 2px;
    border-color: var(--ink);
  }
  .nb-shadow {
    box-shadow: 4px 4px 0 var(--ink);
  }
  .nb-shadow-sm {
    box-shadow: 2px 2px 0 var(--ink);
  }
  .nb-press {
    transition: transform 100ms ease, box-shadow 100ms ease;
  }
  .nb-press:active {
    transform: translate(4px, 4px);
    box-shadow: 0 0 0 var(--ink);
  }
  .nb-press-sm:active {
    transform: translate(2px, 2px);
    box-shadow: 0 0 0 var(--ink);
  }
}
@media (prefers-reduced-motion: reduce) {
  .nb-press,
  .nb-press:active {
    transition: none;
  }
}
```

Note: `.nb-press:active` and `.nb-press-sm:active` are separate classes (not a shared rule keyed on shadow size) because the `translate` distance must match whichever shadow class (`.nb-shadow` = 4px offset, `.nb-shadow-sm` = 2px offset) is applied alongside it — a component using `.nb-shadow-sm` should pair it with `.nb-press-sm`, not `.nb-press`.

- [ ] **Step 5: Add project-wide tabular numerals**

In the existing `@layer base` block (lines 127-137), add `font-variant-numeric: tabular-nums;` to the `body` rule so prices/KPI values/order totals never shift width as digits change, per the spec's typography section:

```css
  body {
    @apply bg-background text-foreground;
    font-variant-numeric: tabular-nums;
  }
```

- [ ] **Step 6: Verify the build succeeds**

Run: `npm run build`
Expected: build succeeds. The site's colors will shift slightly site-wide (foreground darkens from `#3a2e22` to `#2b2118`, card lightens from pure white to `#fffaf5`) — this is the accepted global interim shift described in Global Constraints. No layout should break since class names (`bg-card`, `text-foreground`, etc.) are unchanged, only their resolved values.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "Add Neubrutalist Modern design tokens (dark mode values, chip/ink/price/success/warn) to globals.css"
```

---

### Task 2: Dark mode toggle (`useTheme` hook + `ThemeToggle` component)

**Files:**
- Create: `hooks/useTheme.tsx`
- Create: `components/shared/theme-toggle.tsx`
- Modify: `app/[locale]/layout.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: Task 1's `.dark` class (already existed, now has correct color values).
- Produces: `useTheme()` returning `{ theme: "light" | "dark", toggleTheme: () => void }`, importable by any client component; `<ThemeToggle />` — a self-contained button, no props required.

- [ ] **Step 1: Create `hooks/useTheme.tsx`**

```tsx
"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "phadincafe-theme"

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    setTheme(readInitialTheme())
  }, [])

  function toggleTheme() {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark"
      document.documentElement.classList.toggle("dark", next === "dark")
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
```

- [ ] **Step 2: Add the `Theme.toggleLabel` translation key**

In `messages/vi.json`, add a top-level `Theme` object (place it alphabetically near other top-level keys, e.g. next to an existing `"Nav"` or `"Brand"` key):

```json
"Theme": {
  "toggleLabel": "Chuyển giao diện sáng/tối"
}
```

In `messages/en.json`, add the matching key:

```json
"Theme": {
  "toggleLabel": "Toggle light/dark theme"
}
```

- [ ] **Step 3: Create `components/shared/theme-toggle.tsx`**

```tsx
"use client"

import { Moon, Sun } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "@/hooks/useTheme"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const t = useTranslations("Theme")
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={t("toggleLabel")}
      className="rounded-full bg-card"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
```

- [ ] **Step 4: Wire `ThemeProvider` + no-flash script + `ThemeToggle` into `app/[locale]/layout.tsx`**

Add the import alongside the existing imports (after the `LanguageSwitcher` import on line 7):

```tsx
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ThemeProvider } from "@/hooks/useTheme";
```

Replace the `<html>` opening tag (line 67-70) to include a no-flash inline script as the first child of `<head>` — since this project has no explicit `<head>` tag today (Next.js injects one), add a `<head>` block right after the opening `<html>` tag:

```tsx
    <html
      lang={locale}
      className={`${beVietnamPro.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("phadincafe-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
```

Wrap the existing `<NextIntlClientProvider>` subtree in `ThemeProvider` and add `<ThemeToggle />` next to `<LanguageSwitcher />`:

```tsx
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <TablesProvider>
              <CartProvider>
                <OrdersProvider>
                  <div className="fixed top-2 right-2 z-50 flex items-center gap-2">
                    <RoleBadge role={role} />
                    <ThemeToggle />
                    <LanguageSwitcher />
                  </div>
                  {children}
                </OrdersProvider>
              </CartProvider>
            </TablesProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
```

(Close the added `</ThemeProvider>` right before `</body>`.)

- [ ] **Step 5: Verify the build succeeds**

Run: `npm run build`
Expected: build succeeds, no hydration-mismatch warnings (the inline script runs before React hydrates, so the `.dark` class is already correct on first paint — `useTheme`'s `useEffect` re-syncs client state after mount without changing the DOM class that was already set).

- [ ] **Step 6: Commit**

```bash
git add hooks/useTheme.tsx components/shared/theme-toggle.tsx app/[locale]/layout.tsx messages/vi.json messages/en.json
git commit -m "Add working dark mode: ThemeProvider/useTheme, ThemeToggle button, no-flash init script"
```

---

### Task 3: Add `neubrutal` variant to shared `Button` and `Badge`

**Files:**
- Modify: `components/ui/button.tsx:6-41`
- Modify: `components/ui/badge.tsx` (whole file — read it first; it follows the same `cva` pattern as `button.tsx`)

**Interfaces:**
- Consumes: Task 1's `.nb-border`/`.nb-shadow`/`.nb-press` classes and `--ink`/`--price` tokens.
- Produces: `<Button variant="neubrutal">` and `<Badge variant="neubrutal">`, consumed by Task 4 and Task 5.

- [ ] **Step 1: Add the `neubrutal` variant to `buttonVariants` in `components/ui/button.tsx`**

Inside the `variants.variant` object (lines 10-21), add a new key after `link`:

```tsx
        neubrutal:
          "nb-border nb-shadow nb-press rounded-lg bg-primary font-extrabold uppercase tracking-wide text-primary-foreground active:translate-y-0",
```

The trailing `active:translate-y-0` overrides the base `buttonVariants` string's existing `active:not-aria-[haspopup]:translate-y-px` (line 7) — without it, the base class's 1px press-down would fight with `.nb-press`'s 4px `translate(4px,4px)`.

- [ ] **Step 2: Read `components/ui/badge.tsx` and add a matching `neubrutal` variant**

Read the file first to match its exact `cva` structure (it mirrors `button.tsx`). Add to its `variants.variant` object:

```tsx
        neubrutal:
          "nb-border-sm nb-shadow-sm rounded-md bg-chip font-extrabold uppercase tracking-wide text-foreground",
```

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: build succeeds. No existing `<Button>`/`<Badge>` call site is affected (`neubrutal` is additive; nothing defaults to it).

- [ ] **Step 4: Commit**

```bash
git add components/ui/button.tsx components/ui/badge.tsx
git commit -m "Add additive neubrutal variant to shared Button and Badge components"
```

---

### Task 4: Re-skin `LandingView`

**Files:**
- Modify: `components/marketing/landing-view.tsx`

**Interfaces:**
- Consumes: `neubrutal` Button/Badge variants (Task 3), `.nb-*` classes (Task 1). `SpotlightHero`, `LandingNav`, `QrScannerOverlay` are unmodified — this task only touches the promo section, best-seller cards, and category chips below the hero.
- Produces: nothing consumed by later tasks (leaf page).

- [ ] **Step 1: Re-skin the promo section (lines 40-52)**

Replace:

```tsx
        <section className="px-4 pt-6 md:px-0">
          <div className="relative overflow-hidden rounded-xl border bg-muted p-5 shadow-sm md:p-8">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            <h3 className="mb-1 font-bold text-card-foreground md:text-xl">{t("promoTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground md:text-base md:max-w-2xl">{t("promoDescription")}</p>
            <span className="inline-block rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground">
              {t("promoBadge")}
            </span>
          </div>
        </section>
```

with:

```tsx
        <section className="px-4 pt-6 md:px-0">
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
```

- [ ] **Step 2: Re-skin the best-seller cards (lines 64-82)**

Replace the `<Link>` card markup:

```tsx
                <Link
                  key={item.id}
                  href="/menu"
                  className="flex w-36 shrink-0 flex-col gap-2 rounded-xl md:w-auto md:shrink group"
                >
                  <div className="flex h-32 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all group-hover:scale-[1.03] group-hover:shadow-md md:h-40">
                    <Icon className="h-10 w-10 md:h-12 md:w-12" />
                  </div>
                  <h4 className="text-sm font-semibold leading-tight text-card-foreground group-hover:text-primary transition-colors">{name}</h4>
                  <span className="font-bold text-primary">{formatVND(item.basePrice)}</span>
                </Link>
```

with:

```tsx
                <Link
                  key={item.id}
                  href="/menu"
                  className="nb-border nb-shadow nb-press flex w-36 shrink-0 flex-col gap-2 rounded-xl bg-card p-2 md:w-auto md:shrink"
                >
                  <div className="flex h-32 items-center justify-center rounded-lg bg-chip text-muted-foreground md:h-40">
                    <Icon className="h-10 w-10 md:h-12 md:w-12" />
                  </div>
                  <h4 className="text-sm font-bold leading-tight text-card-foreground">{name}</h4>
                  <span className="font-extrabold text-price">{formatVND(item.basePrice)}</span>
                </Link>
```

(`nb-press` already provides press feedback, replacing the old `group-hover:scale`/`group-hover:shadow-md` hover-only affordance — matches the spec's "press feedback = shadow collapse" rule, and works on touch devices where `:hover` doesn't fire.)

- [ ] **Step 3: Re-skin the category chips (lines 90-97)**

Replace:

```tsx
              <Link
                key={category.id}
                href="/menu"
                className="flex shrink-0 items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
```

with:

```tsx
              <Link
                key={category.id}
                href="/menu"
                className="nb-border-sm nb-shadow-sm nb-press-sm flex shrink-0 items-center gap-1 rounded-full bg-card px-4 py-2 text-sm font-extrabold text-foreground"
              >
                {label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
```

- [ ] **Step 4: Verify the build succeeds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/marketing/landing-view.tsx
git commit -m "Re-skin Landing promo/best-sellers/category-chips to Neubrutalist Modern"
```

---

### Task 5: Re-skin `MenuBrowser` + fix quick-add touch target

**Files:**
- Modify: `components/customer/menu-browser.tsx`

**Interfaces:**
- Consumes: `.nb-*` classes (Task 1), `--chip`/`--price` tokens (Task 1). `SegmentedControl`, `StaggerList`/`StaggerItem`, `QuickAddPopup` are unmodified (motion primitives already tuned per the spec's durations — no change needed here).
- Produces: nothing consumed by later tasks (leaf page).

- [ ] **Step 1: Re-skin the search input wrapper (lines 90-98)**

Replace:

```tsx
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 rounded-xl pl-9"
        />
      </div>
```

with:

```tsx
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="nb-border h-11 rounded-lg bg-card pl-9"
        />
      </div>
```

- [ ] **Step 2: Re-skin item cards (lines 119-163)**

Replace the `<button>` card markup and its inner price/quick-add row:

```tsx
            <button
              type="button"
              onClick={() => openItem(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border bg-card p-2 text-left shadow-sm transition-shadow hover:shadow-md md:h-full md:flex-col md:items-stretch md:p-0 md:overflow-hidden",
                !item.isAvailable && "opacity-70"
              )}
            >
              <ItemImage
                item={item}
                className={cn("h-28 w-28 shrink-0 rounded-lg md:h-48 md:w-full md:rounded-none", !item.isAvailable && "grayscale")}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1 md:p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 font-semibold text-card-foreground md:text-base">{name(item)}</span>
                  {item.isPopular && (
                    <Badge className="shrink-0 bg-primary text-primary-foreground hover:bg-primary">
                      {t("popular")}
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground md:line-clamp-2 md:text-sm md:h-10">{description(item)}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-bold text-primary md:text-base">{formatVND(item.basePrice)}</span>
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
```

with:

```tsx
            <button
              type="button"
              onClick={() => openItem(item)}
              className={cn(
                "nb-border nb-shadow nb-press flex w-full items-center gap-3 rounded-xl bg-card p-2 text-left md:h-full md:flex-col md:items-stretch md:p-0 md:overflow-hidden",
                !item.isAvailable && "opacity-70"
              )}
            >
              <ItemImage
                item={item}
                className={cn("h-28 w-28 shrink-0 rounded-lg md:h-48 md:w-full md:rounded-none", !item.isAvailable && "grayscale")}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1 md:p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 font-bold text-card-foreground md:text-base">{name(item)}</span>
                  {item.isPopular && (
                    <Badge variant="neubrutal" className="shrink-0">
                      {t("popular")}
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground md:line-clamp-2 md:text-sm md:h-10">{description(item)}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-extrabold text-price md:text-base">{formatVND(item.basePrice)}</span>
                  {item.isAvailable ? (
                    <motion.span
                      role="button"
                      aria-label={t("addToCart")}
                      whileTap={TAP_SCALE}
                      transition={TAP_TRANSITION}
                      onClick={(e) => {
                        e.stopPropagation()
                        quickAdd(item)
                      }}
                      className="nb-border-sm nb-shadow-sm -m-1.5 flex h-11 w-11 items-center justify-center rounded-full bg-primary p-1.5 text-primary-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  ) : (
                    <span className="nb-border-sm flex h-8 w-8 items-center justify-center rounded-full bg-chip text-muted-foreground">
                      <Ban className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
            </button>
```

Two things changed on the quick-add button beyond re-skinning: it grew from `h-8 w-8` (32px) to `h-11 w-11` (44px) to meet the touch-target minimum from the spec's Mobile section, and `-m-1.5`/`p-1.5` (6px) keeps the *visible* circle at its original ~32px size by inset-padding the larger 44px hit area — the drawn circle doesn't get visually bigger, only the tappable area does, per the spec's explicit "extend hit area, not visual size" rule. `aria-label={t("addToCart")}` was also added since this is a `role="button"` `<span>`, not a real `<button>`, so it has no accessible name otherwise — check `messages/vi.json`/`messages/en.json`'s existing `Menu` namespace for whether an `addToCart` key already exists before adding a new one; if it doesn't exist, add it to both files following the same pattern as Task 2 Step 2 (e.g. `"addToCart": "Thêm vào giỏ"` / `"addToCart": "Add to cart"`).

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: build succeeds, no missing-translation-key warnings.

- [ ] **Step 4: Commit**

```bash
git add components/customer/menu-browser.tsx messages/vi.json messages/en.json
git commit -m "Re-skin Menu search/cards to Neubrutalist Modern; fix quick-add touch target to 44px"
```

---

### Task 6: Deploy and live-verify Phase 1

**Files:** none (verification only).

**Interfaces:**
- Consumes: Tasks 1-5 (all committed).
- Produces: a confirmed-working deploy that Phase 2 (Cart/Checkout, Orders, Profile/Loyalty) builds on top of.

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

Expected: Vercel auto-deploys (per this project's standing convention — push to `main` triggers a deploy, no manual `vercel deploy`).

- [ ] **Step 2: Verify Landing (`/`) live**

Open **https://phadincafe.vercel.app** in both `vi` and `en` locales. Confirm: promo card, best-seller cards, and category chips show thick borders + hard offset shadows (not soft blur); tapping/clicking a best-seller card or category chip shows the shadow-collapse press effect; `SpotlightHero`'s existing animation is unchanged; the QR-scan overlay still opens.

- [ ] **Step 3: Verify Menu (`/menu`) live**

Confirm: search input, category pills (via `SegmentedControl`), and item cards show the new border/shadow treatment; tapping the quick-add "+" button on a phone-width viewport is easy to hit precisely (44px hit area) without the drawn circle looking oversized; items without a size/modifier choice add directly to cart; items needing a choice still open `QuickAddPopup`.

- [ ] **Step 4: Verify dark mode live**

Tap the new theme-toggle button (next to the language pill). Confirm: background/card/text colors flip to the dark palette, borders/shadows stay visible (using `--ink` = `#f2c88f` in dark mode, not invisible near-black-on-near-black), reloading the page keeps the chosen theme (localStorage persistence), and there's no flash of the wrong theme on load.

- [ ] **Step 5: Verify phone-width layout on a real device**

On an actual iOS Safari and Android Chrome device (not just a resized desktop browser window, per the spec's explicit requirement), confirm: no horizontal scroll on either page, the fixed `RoleBadge`/`ThemeToggle`/`LanguageSwitcher` pill cluster doesn't overlap page content or get clipped by the notch/status bar, and the quick-add button is comfortably tappable with a thumb.

- [ ] **Step 6: Update `daily.md`**

Move this phase's entry from "design locked, implementation not started" to reflect Phase 1 shipped and live-verified; note Phase 2 (Cart/Checkout, Orders, Profile/Loyalty) as the next plan to write, per the spec's rollout order.
