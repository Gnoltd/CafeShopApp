# Design: 3D coffee-cup landing hero

Date: 2026-07-29

## Context

`components/marketing/spotlight-hero.tsx` currently renders the landing
page's full-screen hero: 3 admin-uploaded photos crossfading in the
background (`hero-crossfade`, shipped
`docs/superpowers/specs/2026-07-21-admin-editable-landing-hero-design.md`)
plus a 4th "reveal" photo shown through a mouse/touch-follow spotlight
mask (`lib/spotlight-mask.ts`). The goal is a more "modern, high-tech"
hero — inspired by CoffeeTech® (2026 Awwwards Site of the Day,
`coffee-tech.com`), which renders a real `.glb` product model via
Google's `<model-viewer>` web component with the camera driven by
scroll, on a near-black background with a single warm accent color.
PhaDinCoffee's own theme (`app/globals.css`) is already brick-red/
caramel/warm-cream on a near-black dark mode, so this is a rendering
swap, not a rebrand.

Spline (both a hand-picked coffee-shop-scene and a coffee-cup-scene
route) was evaluated and rejected — its community scenes read as
illustrative/cute rather than the modern-tech look wanted, and
`<model-viewer>` matches the CoffeeTech reference directly with a
simpler dependency (one custom element vs. a full Spline
scene-authoring/export pipeline).

## 3D asset

Sketchfab **"Coffee Cup"** by DimenVision
(`sketchfab.com/3d-models/coffee-cup-121ef706d56e4e208a5304c4a1e46d43`)
— black cup, brown silicone sleeve, white lid, glossy PBR materials.
Licensed **Sketchfab Free Standard** (commercial use, all derivative
works, no attribution required, royalty-free) — chosen by the user
directly over two CC-Attribution alternatives found during research.
As downloaded it's 180k triangles / 90k vertices, too heavy for a hero
asset — before committing it, run through `gltf-transform`
(alternatively `gltfpack`) for Draco mesh compression and texture
resizing, and commit the result to `public/models/coffee-cup.glb`
(same convention as other static public assets in this app).

## Component changes

- New `components/marketing/coffee-cup-hero.tsx` replaces
  `components/marketing/spotlight-hero.tsx`. Same props shape
  (`onScanQr`, `baseImages`, `revealImage`) so `landing-view.tsx` only
  changes which component it imports/renders — no change to
  `app/[locale]/(marketing)/page.tsx` or `getLandingHeroSettings`.
- The existing 3-photo crossfade background layer (`hero-crossfade`
  CSS keyframes, `app/globals.css`) is unchanged and stays as the base
  layer in both the 3D-capable and fallback cases.
- `<model-viewer src="/models/coffee-cup.glb">` is layered on top,
  transparent background, so the crossfading photos remain visible
  around the cup. Headline text and CTAs (`heroLine1`/`heroLine2`,
  Order Now, Scan QR) are unchanged, still centered on top of
  everything via the same `hero-anim`/`hero-fade` staggered reveal.
- **Camera interactivity**: mouse position and scroll offset drive the
  model's `camera-orbit` attribute via a `requestAnimationFrame`
  smoothing loop — adapted from the same mouse-smoothing pattern
  `spotlight-hero.tsx` already uses today (`mouse`/`smooth` refs +
  `tick()` loop, `components/marketing/spotlight-hero.tsx:26-69`),
  retargeted from "mask center position" to "orbit theta/phi," plus a
  scroll listener feeding a second offset into the same orbit
  calculation. No drag-to-orbit (`camera-controls` attribute is not
  set) — orbit is ambient/programmatic only, matching the "mouse/
  scroll driven, not user-draggable" decision.
- **Poster & fallback**: `revealImage` (today's "Spotlight Photo" in
  Admin Settings) becomes the `<model-viewer poster>` — shown while
  the `.glb` streams in. WebGL support is feature-detected client-side
  (a throwaway canvas `getContext('webgl')` check) before mounting
  `<model-viewer>` at all; if unsupported, the component renders only
  the photo-crossfade layer with `revealImage` as a static top layer,
  never attempting to load the 3D element. This is why the admin
  hero-photo feature (`components/admin/landing-hero-settings-card.tsx`,
  `getLandingHeroSettings`/`updateLandingHeroSettings`,
  `landing_page_images` columns on `shop_settings`) is kept rather than
  retired — it now doubles as the 3D-load poster and the no-WebGL
  fallback, instead of a spotlight-mask reveal image. No changes needed
  to the admin UI, its labels, the DB columns, or the storage bucket.
- **Dead code removed**: `lib/spotlight-mask.ts` and
  `lib/spotlight-mask.test.ts` — the mask-reveal mechanic has no
  remaining callers once `coffee-cup-hero.tsx` replaces
  `spotlight-hero.tsx`.

## New dependency: `@google/model-viewer`

The only new package this feature adds. It's a custom element that
calls `customElements.define(...)` at import time, which breaks
Next.js SSR (`customElements`/`window` don't exist server-side) — so
it must be imported client-side only, inside a `'use client'`
component's effect (`useEffect(() => { import('@google/model-viewer') },
[])`), never at module top-level. TypeScript needs the package's JSX
type augmentation (or a manual `.d.ts` declaring the `model-viewer`
intrinsic element) for `<model-viewer>` to type-check as JSX.

## Error handling

- WebGL-unsupported browsers: handled by the feature-detect above,
  degrading to the photo layer alone — no thrown error, no blank hero.
- `.glb` fails to load (network error, bad path): `<model-viewer>`
  fires an `error` event; `coffee-cup-hero.tsx` listens for it and
  falls back to the same photo-only rendering path as the
  no-WebGL case, so a broken model asset never produces a blank or
  broken-looking hero.

## Testing

No unit tests for the camera-orbit rAF math or the WebGL feature-detect
(matches `spotlight-hero.tsx`'s equivalent cursor-smoothing logic
having none today) or the CSS crossfade (unchanged, already
untested by convention). Verified live on the deployed Vercel URL per
this project's stated convention (`CLAUDE.md`): desktop mouse-driven
orbit, scroll-driven orbit, mobile touch/scroll behavior, the
`.glb`-load poster transition, and both fallback paths (WebGL
disabled via browser flag, and a temporarily-broken model path) all
rendering the photo layer cleanly instead of a blank/broken hero.

## Out of scope

- Drag-to-orbit / user-controlled camera (`camera-controls` attribute)
  — explicitly mouse/scroll-ambient only per the approved design.
- Admin-configurable 3D model swap — the cup model is a fixed code
  asset (`public/models/coffee-cup.glb`), not admin-editable like the
  photos are.
- Any change to the admin Settings UI, its card labels, the
  `shop_settings` columns, or the `landing-hero-images` storage bucket
  — all reused as-is.
- Side-by-side "product hero" layout (cup on one side, text on the
  other) — full-bleed background was chosen instead, matching today's
  hero layout.
- Re-texturing/recoloring the cup model to exactly match brand hex
  values — using the model's existing black/brown/white materials
  as-is.
