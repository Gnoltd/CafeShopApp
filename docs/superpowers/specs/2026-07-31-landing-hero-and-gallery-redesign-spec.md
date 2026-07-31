# Landing Page Hero Bottom-Right Corner Arc & 3D Arc Gallery GPU Optimization Spec

**Date:** 2026-07-31  
**Feature:** Hero Bottom-Right Corner Red Circle Arc (Matching Hand-Drawn Sketch) + 3D Arc Gallery GPU Optimization

---

## 1. Objectives & Overview

1. **Hero Layout (Exact Match with Hand-Drawn Sketch)**:
   - **Left side**: Headline ("Crafted slow. Poured fast.") in Playfair serif font + description text + CTA buttons ("Order Now", "Scan QR at Table") on dark coffee roast background.
   - **Bottom-Right Corner**: Red Circle Arc (`#b3341f`) anchored to the **bottom-right corner** (`-right-[15vw] -bottom-[18vh] aspect-square w-[75vw] sm:w-[58vw] md:w-[48vw] rounded-full bg-primary`), cutting off gracefully at the bottom-right boundary of the hero section across all screen sizes (PC, Laptop, Tablet/iPad, Mobile).
   - **Inside Bottom-Right Arc**: Bright 3D Coffee Cup model standing with 3-point studio lighting (`AmbientLight`, `DirectionalLight`, `HemisphereLight`, `ACESFilmicToneMapping`).
2. **3D Arc Motion Gallery GPU Performance Optimization**:
   - Preserve 100% of all features (3D parabolic curved arc scroll-linked motion gallery with integrated Merged Promotion Card) on ALL devices.
   - Add `transform-gpu` (`will-change: transform; transform: translateZ(0)`) to offload transforms directly to mobile GPU hardware layers.
   - Shorten mobile scroll track from `400vh` to `240vh` and optimize mobile shadows (`shadow-xl`) for smooth 60fps scrolling with zero lag.

---

## 2. Component Specifications

### A. `components/marketing/coffee-cup-hero.tsx`
- **Lighting**:
  - `AmbientLight(0xffffff, 1.4)`
  - `HemisphereLight(0xfff5ea, 0x3d281c, 1.2)`
  - Key `DirectionalLight(0xffffff, 2.2)` at `(0.8, 1.2, 1.0)`
  - Fill `DirectionalLight(0xffe8d6, 1.0)` at `(-1.0, -0.5, -0.8)`
  - Tone mapping: `ACESFilmicToneMapping` with `exposure = 1.35`
- **Bottom-Right Corner Circle Arc**:
  - `className="pointer-events-none absolute -right-[15vw] -bottom-[18vh] z-[2] aspect-square w-[78vw] sm:w-[60vw] md:w-[48vw] rounded-full bg-primary"`
- **Canvas Container**:
  - `className="pointer-events-none absolute -right-[15vw] -bottom-[18vh] z-[5] flex aspect-square w-[78vw] sm:w-[60vw] md:w-[48vw] items-center justify-center"`
- **Left Text Column**:
  - Left-aligned text container `max-w-[460px] z-10 px-6 py-28` ensuring text and CTAs sit cleanly on dark coffee roast background with zero overlap.

### B. `components/marketing/best-sellers-gallery.tsx`
- **Track Height**: `h-[380vh]` on Desktop (>= 768px), `h-[240vh]` on Mobile (< 768px).
- **GPU Compositing**: `transform-gpu` (`will-change: transform`, `transform: translateZ(0)`) on `ArcItem` and `ArcPromotionItem`.
- **Card Styling**: Mobile shadow `shadow-xl`, Desktop shadow `shadow-[0_20px_50px_rgba(0,0,0,0.85)]`.

---

## 3. Verification & Testing Plan

- `npx tsc --noEmit` type safety check.
- `npm run build` production build check.
- Visual inspection on Desktop PC (1440px+), Laptop (1024px-1439px), Tablet/iPad (768px-1023px), and Mobile (< 768px) matching hand-drawn sketch.
- Mobile scroll performance test ensuring 60fps smooth scrubbing through 3D arc motion.
