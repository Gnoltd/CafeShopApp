# Landing Page Hero & Mobile Best Sellers Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brighten 3D cup studio lighting, rebuild the full-height cut-off red brick circle across Laptop/Desktop/iPad/Mobile, and optimize Best Sellers mobile performance with a device-adaptive 60fps engine.

**Architecture:** 
- Update `components/marketing/coffee-cup-hero.tsx` with 3-point Three.js studio lighting and top-right anchored red circle layout.
- Update `components/marketing/best-sellers-gallery.tsx` with a responsive device-adaptive engine (GPU-accelerated native touch carousel on Mobile < 768px, 3D arc motion on Desktop >= 768px).

**Tech Stack:** Next.js (App Router), React, Three.js, Framer Motion, Tailwind v4 CSS, TypeScript.

## Global Constraints

- Follow `CLAUDE.md` design rules: Tailwind v4 theme tokens (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`).
- Must pass `npm run build` with zero TypeScript or lint errors.
- Fully responsive across PC (1440px+), Laptop (1024px-1439px), Tablet/iPad (768px-1023px), and Mobile (<768px).

---

### Task 1: Rebuild Hero 3D Lighting & Red Circle Layout

**Files:**
- Modify: `components/marketing/coffee-cup-hero.tsx`

**Interfaces:**
- Consumes: Three.js `AmbientLight`, `DirectionalLight`, `HemisphereLight`, `ACESFilmicToneMapping`
- Produces: Enhanced `CoffeeCupHero`

- [ ] **Step 1: Update Three.js lighting and red circle container in `coffee-cup-hero.tsx`**

```tsx
// In coffee-cup-hero.tsx:
// 1. Update renderer tone mapping and colorspace:
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.35

// 2. Update studio lights:
scene.add(new THREE.AmbientLight(0xffffff, 1.4))
scene.add(new THREE.HemisphereLight(0xfff5ea, 0x3d281c, 1.2))

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
keyLight.position.set(0.8, 1.2, 1.0)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffe8d6, 1.0)
fillLight.position.set(-1.0, -0.5, -0.8)
scene.add(fillLight)

// 3. Rebuild red circle layout:
<div
  className="absolute -right-[15vw] -top-[10vh] z-[2] aspect-square h-[120vh] rounded-full bg-primary max-md:top-[6vh] max-md:-right-[20vw] max-md:h-[60vh] max-md:w-[110vw]"
  aria-hidden
/>
<div className="absolute -right-[15vw] -top-[10vh] z-[5] flex aspect-square h-[120vh] items-center justify-center max-md:top-[6vh] max-md:-right-[20vw] max-md:h-[60vh] max-md:w-[110vw]">
  {renderMode === "model" && <canvas ref={canvasRef} className="h-full w-full" aria-hidden />}
</div>
```

- [ ] **Step 2: Commit Task 1**

```bash
git add components/marketing/coffee-cup-hero.tsx
git commit -m "feat(landing): add 3-point studio lighting and rebuild full-height cut-off red circle hero layout"
```

---

### Task 2: Implement Device-Adaptive Mobile Lag Fix for Best Sellers

**Files:**
- Modify: `components/marketing/best-sellers-gallery.tsx`

**Interfaces:**
- Consumes: `MenuItem` from `@/lib/supabase/menu-data`
- Produces: Responsive `BestSellersGallery`

- [ ] **Step 1: Add mobile touch carousel / desktop arc branch in `best-sellers-gallery.tsx`**

```tsx
// Render mobile touch carousel (<768px) and desktop arc gallery (>=768px)
```

- [ ] **Step 2: Commit Task 2**

```bash
git add components/marketing/best-sellers-gallery.tsx
git commit -m "perf(landing): implement device-adaptive mobile touch carousel and hardware acceleration to eliminate scroll lag"
```

---

### Task 3: Build Verification & Testing

**Files:**
- None (Build verification step)

- [ ] **Step 1: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected output: 0 errors.

---
