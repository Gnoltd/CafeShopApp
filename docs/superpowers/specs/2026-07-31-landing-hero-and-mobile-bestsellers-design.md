# Landing Page Hero & Mobile Best Sellers Performance Design Spec

**Date:** 2026-07-31  
**Feature:** Hero 3D Cup Lighting & Red Circle Layout Fix + Mobile Best Sellers Performance Engine

---

## 1. Problem Statement & Objectives

1. **3D Coffee Cup Lighting**: The 3D coffee cup model in the hero section is currently too dark, with heavy unlit shadows obscuring the cup texture and sleeve.
2. **Red Brick Circle Positioning & Responsive Layout**: The giant red circle (`#b3341f`) was misplaced below `xl` screens (`bottom-[10%]`), leaving top/bottom gaps and breaking layout on Laptop, iPad, and Mobile. It must be anchored to the top-right corner (`top-[-10vh] -right-[15vw] h-[120vh] aspect-square rounded-full bg-primary`) bleeding past top, right, and bottom edges on Laptop/Desktop (matching reference screenshot) and scaling responsively on Mobile/iPad.
3. **Mobile Best Sellers Scroll Lag**: The sticky `h-[400vh]` scroll-driven 3D transforms cause heavy frame drops and lag on mobile GPUs/CPUs. We will implement a Device-Adaptive Rendering Engine to provide a 60fps butter-smooth experience on all devices.

---

## 2. Technical Implementation Details

### A. 3D Coffee Cup Studio Lighting (`components/marketing/coffee-cup-hero.tsx`)
- Add **3-Point Studio Lighting** to the Three.js scene:
  - `AmbientLight(0xffffff, 1.2)`: Provides bright base illumination across all meshes.
  - `DirectionalLight(0xffffff, 2.2)` at `(0.8, 1.2, 1.0)`: Bright key light highlighting the top rim, sleeve texture, and cup body.
  - `DirectionalLight(0xffe8d6, 1.0)` at `(-1.0, -0.5, -0.8)`: Soft warm fill light eliminating pitch-black shadows.
  - `HemisphereLight(0xfff5ea, 0x3d281c, 1.5)`: Soft ground-to-sky gradient ambient tone.
- Tone mapping set to `THREE.ACESFilmicToneMapping` with `exposure = 1.25` for rich, true-to-life coffee tones.

### B. Responsive Red Circle & Hero Composition
- Anchor red circle: `absolute -right-[15vw] -top-[10vh] z-[2] aspect-square h-[120vh] rounded-full bg-primary` on Desktop & Laptop (`md: -right-[10vw] md:-top-[8vh] md:h-[116vh]`).
- On Mobile/Tablet (< 768px): Scale circle smoothly (`w-[110vw] -right-[15vw] top-[5vh] h-[55vh]`) so the 3D cup and red circle backdrop sit cleanly on the upper/right region without colliding with hero typography.
- Hero typography left column: `max-w-[480px]` with `z-10` layer depth, preserving single-origin roast hero lines and CTA buttons.

### C. Device-Adaptive Best Sellers Engine (`components/marketing/best-sellers-gallery.tsx`)
- Detect mobile viewport using `window.innerWidth < 768` or media query hook:
  - **Mobile & Tablet (< 768px)**: Render a lightweight, butter-smooth native horizontal touch swipe gallery + integrated neobrutalist promotion card. Uses CSS hardware acceleration (`will-change: transform`, `transform: translateZ(0)`), zero scroll-jacking, zero scroll lag, 60fps native performance.
  - **Laptop & Desktop (>= 768px)**: Retain the full sticky-pinned `h-[400vh]` 3D parabolic curved arc trajectory with hardware-accelerated transforms (`transform-gpu`).

---

## 3. Verification Plan

- `npm run build` production build check.
- 3D Cup lighting inspection ensuring vibrant sleeve and body illumination.
- Responsive layout verification on Desktop (1440px+), Laptop (1024px-1439px), Tablet/iPad (768px-1023px), and Mobile (< 768px).
- Mobile scroll lag testing ensuring zero frame drops on touch scroll.
