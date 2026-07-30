# Custom Scroll-Linked Curved Arc Image Gallery Design Spec

**Date:** 2026-07-30  
**Feature:** Scroll-linked Curved Arc Trajectory Image Gallery (`BestSellersGallery`)

---

## 1. Overview

Replace the static Best Sellers gallery with a sticky-pinned, scroll-driven motion gallery where best-selling coffee items glide along a custom mathematical **parabolic curved arc path**. 

As the user scrolls down the page, items enter sequentially from the **bottom-right** of the screen (`x: +80vw`, `y: +60vh`), curve smoothly upward into the **center viewport focus** (`x: 0vw`, `y: -15vh`, `scale: 1.15`), and exit gracefully towards the **top-left** (`x: -80vw`, `y: -70vh`, `scale: 0.85`).

---

## 2. Technical Implementation & Mathematics

### A. Scroll Container Pinning
- Section uses a tall sticky scroll container (`h-[350vh]` or `h-[400vh]`) with a `sticky top-0 h-screen overflow-hidden` inner viewport.
- Uses Framer Motion's `useScroll({ target: containerRef, offset: ["start start", "end end"] })` to capture `scrollYProgress` from `0` to `1`.

### B. Mathematical Arc Trajectory Calculations
For `N` best seller items, the scroll progress `[0, 1]` is divided into `N` staggered normalized progress windows `[start, end]`.
Within each item's window `t ∈ [0, 1]`:
- **X-axis Transformation** (linear interpolation):
  `x = transform(t, [0, 0.5, 1], ["80vw", "0vw", "-80vw"])`
- **Y-axis Transformation** (quadratic parabolic arc curve):
  `y = transform(t, [0, 0.5, 1], ["60vh", "-15vh", "-70vh"])`
- **Scale Transformation** (center apex focus):
  `scale = transform(t, [0, 0.25, 0.5, 0.75, 1], [0.7, 0.95, 1.15, 0.95, 0.7])`
- **Opacity Transformation** (seamless entry/exit):
  `opacity = transform(t, [0, 0.15, 0.85, 1], [0, 1, 1, 0])`
- **Rotational Tilt** (natural arc physics):
  `rotate = transform(t, [0, 0.5, 1], ["12deg", "0deg", "-12deg"])`

### C. Item Interaction & Navigation
- When an item is near the center apex focus, its product title, price tag (`formatVND`), and ambient glow backdrop light up.
- Clicking/tapping any item card navigates directly to that drink's product detail page (`/menu/[itemId]`).

---

## 3. Component Architecture

- `components/marketing/best-sellers-gallery.tsx`:
  - Implements the sticky container `h-[350vh]`.
  - Maps `bestSellers` items into `ArcGalleryItem` instances.
  - Handles mobile (< 768px) and desktop (>= 768px) responsive scale bounds (`40vw` card size on desktop, `75vw` card size on mobile).

---

## 4. Verification & Testing Plan

- `npm run build` production build check.
- Smooth 60fps scroll scrubbing test without jank/lag.
- Responsive mobile & desktop trajectory bounds check.
