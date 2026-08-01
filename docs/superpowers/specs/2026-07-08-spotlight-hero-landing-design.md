# Spotlight Hero — Landing Page Redesign (2026-07-08)

Replace the landing page's current 50vh gradient banner with a full-screen,
dark, cursor-spotlight hero adapted from a detailed "Lithos" hero spec the
user supplied. Everything below the hero (promo card, best sellers,
category chips) stays exactly as it is today.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Where does it live? | Inside PhaDinCafe (Next.js), not a standalone Vite app |
| Hero images | Two free Unsplash coffee photos picked by Claude (swappable constants) |
| Brand vs. spec identity | PhaDinCafe brand wins: Be Vietnam Pro body, `bg-primary` CTA; Playfair Display italic only as display accent |
| Nav | Adapt spec nav to real routes (Menu / Orders / Loyalty / Profile, Sign Up → `/signup`) |
| Existing sections | Keep promo / best-sellers / categories below the hero; hero absorbs the Order Now + Scan QR CTAs |
| Spotlight technique | CSS radial-gradient mask (not the spec's per-frame canvas → `toDataURL`) — visually identical, no per-frame PNG encoding |

## Structure

- **`components/marketing/spotlight-hero.tsx`** (new, client) — the
  full-screen hero. Props: `onScanQr: () => void`.
- **`components/marketing/landing-nav.tsx`** (new, client or server) —
  nav rendered **absolute over the hero**, not fixed. Rationale: the
  sections below have light backgrounds (white nav text would vanish),
  and a fixed `z-[100]` bar would fight the app's fixed LanguageSwitcher
  (`top-2 right-2 z-50`).
- **`components/marketing/landing-view.tsx`** (modified) — renders
  `<LandingNav />` + `<SpotlightHero onScanQr={…} />` full-bleed, then the
  existing `max-w-2xl` wrapper moves down to contain only the
  promo/best-sellers/categories sections. The `isScannerOpen` state and
  `QrScannerOverlay` stay in `LandingView`.

### Revision (found during live verification)

The marketing route's layout wrapped the page in `CustomerHeader` +
`BottomNav`. The sticky 56px header duplicated the hero's branding and
pushed the 100dvh hero down, shoving its bottom CTAs underneath the fixed
BottomNav. Resolution: `CustomerHeader` is removed from the **marketing
layout only** (LandingNav is this page's header; every other customer page
keeps it); `BottomNav` stays (primary mobile nav + live cart badge), and
the hero's bottom-anchored blocks use `bottom-24` on all breakpoints so
they clear the ~68px tab bar.

## Hero layout (adapted from spec)

`<section>` `relative w-full overflow-hidden h-screen bg-black`,
inline `height: 100dvh`. Layers by z-index:

1. **Base image** (`z-10`) — `absolute inset-0 bg-center bg-cover
   bg-no-repeat`, dark moody coffee photo, `hero-zoom` Ken Burns.
2. **Reveal layer** (`z-30`) — warm/glowing coffee photo, visible only
   through the spotlight mask (below).
3. **Headline** (`z-50`) — `absolute top-[14%]`, centered, two block
   spans in an `<h1 className="text-white leading-[0.95]">`:
   - Line 1: `font-playfair italic font-normal text-5xl sm:text-7xl
     md:text-8xl`, `letterSpacing: -0.05em`, `hero-anim hero-reveal`,
     delay `0.25s`.
   - Line 2: `font-normal text-5xl sm:text-7xl md:text-8xl -mt-1`,
     `letterSpacing: -0.08em`, `hero-anim hero-reveal`, delay `0.42s`.
4. **Bottom-left paragraph** (`z-50`) — `hidden sm:block absolute
   bottom-14 left-10 md:left-14 max-w-[260px]`, `text-sm text-white/80
   leading-relaxed`, `hero-anim hero-fade` delay `0.7s`.
5. **Bottom-right block** (`z-50`) — `absolute bottom-10 sm:bottom-24
   left-5 right-5 sm:left-auto sm:right-10 md:right-14 max-w-full
   sm:max-w-[260px] flex flex-col items-start gap-4 sm:gap-5`,
   `hero-anim hero-fade` delay `0.85s`. Contains the invitation
   paragraph and **two CTAs**:
   - **Order Now** → `/menu`: spec pill styling but brand color —
     `bg-primary hover:bg-primary/90 text-primary-foreground text-sm
     font-medium px-7 py-3 rounded-full transition-all hover:scale-[1.03]
     active:scale-95 hover:shadow-lg hover:shadow-primary/30`.
   - **Scan QR at Table**: outline/ghost pill (white border, white text,
     `hover:bg-white/10`), calls `onScanQr` to open the existing
     `QrScannerOverlay`.

### Revision (2026-07-21 — centered layout)

The top-anchored headline (`top-[14%]`) plus separately bottom-anchored
description/CTA blocks left the headline overlapping the absolute
`LandingNav` on some mobile viewports, and left a large dead gap between
headline and CTAs — reported via a live mobile screenshot. Resolution:
headline, description paragraph(s), and both CTAs now live in one
`absolute inset-0 flex flex-col items-center justify-center` block,
vertically centered in the hero instead of split between `top-[14%]` and
`bottom-24`. This guarantees clearance from the nav at any viewport
height and removes the dead middle space; the fade-in stagger (headline
reveal, then paragraph at `0.6s`, then CTAs at `0.85s`) is preserved.
`heroLeftText` stays `sm:block`-only (unchanged from the original
design), now stacked above `heroRightText` in the same centered column
rather than in a separate bottom-left corner block.

## Nav (adapted from spec)

`absolute top-0 left-0 right-0 z-[60] flex items-center justify-between
p-4 sm:p-5` inside the hero section:

- **Left**: white lucide `Coffee` icon (~26px) + `<span
  className="text-white text-2xl font-playfair italic">PhaDinCafe</span>`.
  ("PhaDinCafe" is the untranslated brand name, per `Brand.name`.)
- **Center pill** (`hidden md:flex absolute left-1/2 -translate-x-1/2
  bg-white/20 backdrop-blur-md border border-white/30 rounded-full px-2
  py-2 items-center gap-1`): locale-aware `Link`s — **Menu** (active:
  solid white text), **Orders**, **Loyalty**, **Profile** (`text-white/80
  px-4 py-1.5 rounded-full text-sm font-medium hover:bg-white/20
  hover:text-white transition-colors`).
- **Right**: `hidden md:block bg-white text-gray-900 text-sm
  font-semibold px-6 py-2.5 rounded-full hover:bg-gray-100` — **Sign Up**
  → `/signup`, with extra right margin (`mr-12`) so it clears the fixed
  LanguageSwitcher at `top-2 right-2`.
- No mobile hamburger — below `md` only logo + wordmark show; the hero's
  own CTAs handle mobile navigation.
- Links use `@/i18n/navigation`'s `Link`; labels come from message files.

## Spotlight mechanic

- `SPOTLIGHT_R = 260`.
- Refs `mouse` (raw) and `smooth` (eased) `{x, y}`, `rafRef`; state
  `cursorPos`, initialized to **screen center** (not `-999`) so touch
  devices see the effect immediately.
- `mousemove` and `touchmove` (first touch point) both write the raw ref.
- RAF loop: `smooth.x += (mouse.x - smooth.x) * 0.1` (same for y), then
  `setCursorPos({ ...smooth })`. Listener + RAF cleaned up on unmount.
- Reveal div style, recomputed per render:
  ```
  maskImage / WebkitMaskImage:
    radial-gradient(circle 260px at ${x}px ${y}px,
      rgba(255,255,255,1) 0%,
      rgba(255,255,255,1) 40%,
      rgba(255,255,255,0.75) 60%,
      rgba(255,255,255,0.4) 75%,
      rgba(255,255,255,0.12) 88%,
      rgba(255,255,255,0) 100%)
  ```
  Same six stops as the spec's canvas gradient; no canvas, no
  `toDataURL`, no per-frame PNG encoding.

## Typography

- Body font stays **Be Vietnam Pro** (global, unchanged).
- **Playfair Display** (italic, weights 400–600) added via `next/font`
  with `latin` + `vietnamese` subsets, exposed as a CSS variable and a
  `.font-playfair` utility. Used only for headline line 1 and the
  wordmark.
- No Inter import — that part of the spec is superseded by the brand
  decision.

## Animations (`app/globals.css`)

Add the spec's keyframes verbatim:

- `heroReveal` (blur-rise), `heroFadeUp`, `heroZoom` (1.12 → 1 Ken Burns).
- Helpers `.hero-anim` (opacity 0, forwards, `cubic-bezier(0.16,1,0.3,1)`),
  `.hero-reveal` (1.1s), `.hero-fade` (1s), `.hero-zoom` (1.8s).
- `@media (prefers-reduced-motion: reduce)` disables all of them
  (`animation: none; opacity: 1`). The spotlight itself remains — it is
  user-driven, not autonomous motion.

## Images

Two Unsplash photos as CSS `backgroundImage` constants at the top of
`spotlight-hero.tsx` (trivial to swap):

- **Base**: dark, moody shot (roasted beans / dim café).
- **Reveal**: warm, glowing shot (latte art / lit interior) — the
  spotlight "warms up" the scene.

CSS backgrounds need no `next/image` remote-pattern config.

## i18n

New keys in the `Landing` namespace, added to **both** `messages/vi.json`
and `messages/en.json`:

| Key | en | vi |
|---|---|---|
| `heroLine1` | Every bean holds | Từng hạt cà phê |
| `heroLine2` | a story worth tasting | kể một câu chuyện |
| `heroLeftText` | Carefully selected beans, roasted slowly and brewed fresh every day — each cup holds its own warmth, aroma, and a moment worth savoring. | Hạt cà phê tuyển chọn kỹ, rang chậm và pha mới mỗi ngày — mỗi tách cà phê mang hương thơm, sự ấm áp và một khoảnh khắc đáng thưởng thức. |
| `heroRightText` | Order in seconds, from your phone or right at your table — your coffee starts brewing the moment you tap. | Đặt món trong vài giây, từ điện thoại hoặc ngay tại bàn — ly cà phê của bạn được pha ngay khi bạn chạm. |
| `navMenu` | Menu | Thực đơn |
| `navOrders` | Orders | Đơn hàng |
| `navLoyalty` | Loyalty | Tích điểm |
| `navProfile` | Profile | Tài khoản |
| `navSignUp` | Sign Up | Đăng ký |

Existing `Landing.orderNow` / `Landing.scanQr` are reused for the CTAs.
Old hero keys (`heroHeadline`, `heroSubheadline`) are removed from both
files once unused.

## Out of scope

- No changes to promo / best-sellers / category sections.
- No mobile hamburger menu.
- No changes to `/menu` or any other page.
- Reviews, tier progress, etc. remain as documented mocks elsewhere.

## Verification

`npm run build` + `tsc` locally for fast feedback; then push to `main`
and verify on **https://phadincafe.vercel.app** (project convention):
both locales, desktop mouse reveal, mobile touch reveal, load animations,
reduced-motion behavior, QR scanner opening from the hero, sections below
intact.
