# Landing Page Hero Bottom-Right Corner Arc & Mobile GPU Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Hero Red Circle Arc to be anchored to the bottom-right corner containing the bright 3D Coffee Cup model (matching your hand-drawn sketch), and optimize 3D Arc Motion Gallery GPU performance across all devices.

**Architecture:** 
- Update `components/marketing/coffee-cup-hero.tsx` with bottom-right corner circle arc layout (`-right-[15vw] -bottom-[18vh] aspect-square w-[78vw] sm:w-[60vw] md:w-[48vw] rounded-full bg-primary`) and 3-point Three.js studio lighting.
- Update `components/marketing/best-sellers-gallery.tsx` with GPU hardware compositing (`transform-gpu`, `will-change: transform`, `transform: translateZ(0)`), shortened 240vh mobile track, and shadow optimizations.

**Tech Stack:** Next.js (App Router), React, Three.js, Framer Motion, Tailwind v4 CSS, TypeScript.

## Global Constraints

- Follow `CLAUDE.md` design rules: Tailwind v4 theme tokens (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`).
- Must pass `npm run build` with zero TypeScript or lint errors.
- Fully responsive across PC (1440px+), Laptop (1024px-1439px), Tablet/iPad (768px-1023px), and Mobile (<768px).

---

### Task 1: Rebuild Hero with Bottom-Right Corner Circle Arc (Matching Sketch)

**Files:**
- Modify: `components/marketing/coffee-cup-hero.tsx`

**Interfaces:**
- Consumes: Three.js `AmbientLight`, `DirectionalLight`, `HemisphereLight`, `ACESFilmicToneMapping`
- Produces: Updated `CoffeeCupHero`

- [ ] **Step 1: Update circle arc positioning and 3D studio lighting in `coffee-cup-hero.tsx`**

```tsx
// 1. studio 3-point lighting:
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.35

scene.add(new THREE.AmbientLight(0xffffff, 1.4))
scene.add(new THREE.HemisphereLight(0xfff5ea, 0x3d281c, 1.2))

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
keyLight.position.set(0.8, 1.2, 1.0)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffe8d6, 1.0)
fillLight.position.set(-1.0, -0.5, -0.8)
scene.add(fillLight)

// 2. Bottom-Right Corner Circle Arc (Matching Sketch):
<div
  className="pointer-events-none absolute -right-[15vw] -bottom-[18vh] z-[2] aspect-square w-[78vw] sm:w-[60vw] md:w-[48vw] rounded-full bg-primary"
  aria-hidden
/>
<div className="pointer-events-none absolute -right-[15vw] -bottom-[18vh] z-[5] flex aspect-square w-[78vw] sm:w-[60vw] md:w-[48vw] items-center justify-center">
  {renderMode === "model" && <canvas ref={canvasRef} className="h-full w-full" aria-hidden />}
</div>
```

- [ ] **Step 2: Commit Task 1**

```bash
git add components/marketing/coffee-cup-hero.tsx
git commit -m "feat(landing): rebuild hero red circle arc to bottom-right corner matching sketch with studio lighting"
```

---

### Task 2: Implement GPU Hardware Optimization for 3D Arc Motion Gallery

**Files:**
- Modify: `components/marketing/best-sellers-gallery.tsx`

**Interfaces:**
- Consumes: `MenuItem` from `@/lib/supabase/menu-data`
- Produces: Hardware-accelerated `BestSellersGallery`

- [ ] **Step 1: Update `best-sellers-gallery.tsx` with GPU hardware compositing and 240vh mobile track**

```tsx
// 1. Add transform-gpu & translateZ(0) to ArcItem and ArcPromotionItem
// 2. Set scroll track height: h-[380vh] md:h-[380vh] h-[240vh] on mobile
```

- [ ] **Step 2: Commit Task 2**

```bash
git add components/marketing/best-sellers-gallery.tsx
git commit -m "perf(landing): apply GPU hardware compositing and 240vh mobile track for smooth 60fps 3D arc motion"
```

---

### Task 3: Build Verification & Testing

**Files:**
- None (Build verification step)

- [ ] **Step 1: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected output: 0 errors.

---
