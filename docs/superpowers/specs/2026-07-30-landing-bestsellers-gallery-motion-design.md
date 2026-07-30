# Landing Page Best Sellers Parallax Gallery & Infinite Marquee Motion Design Spec

**Date:** 2026-07-30  
**Feature:** Newmix-inspired Scroll Parallax Gallery & Infinite Product Marquee on Landing Page

---

## 1. Overview

Redesign the landing page's Best Sellers section into a high-impact, motion-driven experience matching `newmixcoffee.com`. The experience consists of two complementary components:
1. **Scroll-Driven Staggered Parallax Gallery**: A cinematic vertical scroll track featuring staggered card offsets, scroll-driven `clip-path` inset reveals, inner image scale zoom transforms, and high-contrast typography.
2. **Infinite Floating Product Marquee Stream**: A smooth, continuous horizontal product carousel with staggered item heights, drop shadows, scroll entry animations, and hover-to-pause interactions.

---

## 2. Design & Aesthetics

### Theme Integration
- Follows `CLAUDE.md` design system rules using Tailwind v4 theme variables (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`).
- The Best Sellers & Gallery motion sections utilize a rich, high-contrast dark coffee backdrop (`bg-black` / deep dark roast) with crisp white text, caramel accents, and high-resolution drink imagery for a luxury brand feel.

### Component Structure
- `components/marketing/best-sellers-gallery.tsx`:
  - Renders a vertical track (`gallery-track`) containing best-seller items (`gallery-item`).
  - Staggered horizontal offsets (`--offset-x`: `-15%`, `8%`, `-10%`, `15%`, etc.).
  - Scroll-driven Framer Motion hooks (`useScroll`, `useTransform`) animating `clipPath` inset from `inset(5% 15%)` to `inset(0% 0%)` and inner image `scale` from `1.3` to `1.0`.
- `components/marketing/best-sellers-marquee.tsx`:
  - Renders an infinite horizontal scrolling track (`marquee-track`) using Framer Motion or CSS keyframe loop.
  - Floating product items with drop shadows (`drop-shadow(0 12px 28px rgba(0,0,0,0.5))`) and dynamic item height variations.
  - Hover interaction: pauses scroll, expands product card, displays quick "View in Menu" action.

---

## 3. Data & Props Flow

- `LandingView` (`components/marketing/landing-view.tsx`) receives `bestSellers: MenuItem[]`.
- `bestSellers` data passes directly to `BestSellersGallery` and `BestSellersMarquee`.
- Fallbacks: If `bestSellers` is empty, fallback items are derived gracefully from categories or default menu items.

---

## 4. Verification & Testing Plan

- TypeScript verification with `npm run build`.
- Verification of smooth scroll performance without lag/jank.
- Responsive breakpoint checks for mobile (< 768px) and desktop (>= 768px).
