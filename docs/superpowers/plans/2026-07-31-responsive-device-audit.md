# Responsive/Adaptive Device Audit — Plan

Design: `docs/superpowers/specs/2026-07-31-responsive-device-audit-design.md`

Per the grilling session's agreed gating: HIGH-CONFIDENCE findings (structurally
broken regardless of device) are fixed in Phases 0-3 below without waiting for
a live device pass. NEEDS-LIVE-VERIFICATION findings are collected into Phase
4 as a concrete checklist for the user to actually check on a real phone —
nothing in that list gets "fixed" speculatively.

Each phase should be verified against the deployed Vercel URL after landing
(project convention — not `npm run dev`), and `tsc --noEmit` + the test suite
should stay green throughout, matching how the original 4-phase redesign was
executed.

## Phase 0 — Root-cause fixes (shared primitives, theme, layout)

Highest leverage: each task here resolves multiple independently-flagged
symptoms across all three role areas. Do this phase first.

1. **RC-1: Raise `Button`/`Input` touch targets.** `components/ui/button.tsx`
   size variants and `components/ui/input.tsx`'s fixed `h-8` need real
   sizing decisions per variant/context (a dense `xs`/`icon-xs` staff-POS
   control doesn't need the same floor as a customer-facing primary CTA) —
   flag this as needing a quick design call during implementation, not a
   blanket "make everything 44px," since Staff/Admin were deliberately built
   at a denser scale (Phase 3 of the original redesign, `nb-border-sm`/
   `nb-shadow-sm`). Resolves: mobile back button, cart qty buttons,
   address-book edit/delete, theme toggle, role badge, language switcher,
   rewards modal close, QR scanner close, POS quantity buttons,
   kitchen-pending-payment Confirm Cash, and others once the primitive
   changes.
2. **RC-2: Add the missing `.nb-press-sm` base transition** in
   `app/globals.css` (mirror `.nb-press`'s pattern at lines 229-231).
3. **RC-3: Fix the `.nb-press` / `transition-all` layer-order collision** —
   either scope `Button`'s base `transition-all` more narrowly or give
   `.nb-press`/`.nb-press-sm` enough specificity/layer priority to win, so
   the designed 100ms snap actually applies.
4. **RC-4: Wrap `(marketing)/layout.tsx` children in `MotionConfig
   reducedMotion="user"`**, matching `(customer)/layout.tsx`.
5. **RC-5: Gate the coffee-cup hero's rotation loop** — add a
   `matchMedia("(prefers-reduced-motion: reduce)")` check (RC-4's
   `MotionConfig` won't cover this file's imperative rAF code), and add an
   `IntersectionObserver` so the loop and its `mousemove`/`scroll` listeners
   stop once the hero scrolls out of view.
6. **RC-6: Migrate `admin-mobile-header.tsx` to `useHeaderActionsClearance`**,
   removing the hardcoded `pr-64`, matching every other header that already
   adopted the hook.
7. **RC-7: Fix `SideDrawer`'s exit animation** — keep `AnimatePresence`
   mounted in the caller (`admin-sidebar.tsx`) while only its child unmounts,
   instead of conditionally mounting the whole `SideDrawer`. Apply the same
   fix to `BottomSheet`'s call sites while touching this pattern, since it's
   the identical bug.
8. **RC-9: Remove the dead `MODEL_SCALE` lever**, document `BASE_RADIUS` in
   `lib/coffee-cup-orbit.ts` as the actual size control with a clear comment,
   so the next "the cup looks wrong" report doesn't repeat the same two
   wrong-constant edits.

## Phase 1 — Customer / Marketing residuals

Depends on Phase 0 landing first (RC-1 changes what "still too small" means
here).

1. **RC-8, customer half: migrate to `next/image`.**
   `components/customer/item-image.tsx` and `product-detail.tsx`'s hero
   image — real `sizes` matching actual rendered width, proper
   aspect-ratio containers. This is the single highest-impact image fix:
   it's the shared source for the menu grid, best-sellers gallery, and
   product detail hero.
2. Fix `landing-nav.tsx:61` — add the same `truncate`/`max-w` guard the
   mobile-menu greeting already has at line 110.
3. Re-check `menu-browser.tsx:134` quick-add button size after Phase 0's
   RC-1 change; adjust only if still under target.
4. Note `best-sellers-marquee.tsx` as confirmed dead code — flag for the
   user to decide separately (delete vs. wire back in); not touched here.

## Phase 2 — Staff / POS / KDS residuals

1. **Kitchen Board/Sidebar tablet collision** — give the board a `lg:`
   (not `md:`) step-down point so the sidebar and the 4-column grid don't
   both activate at 768px; likely: sidebar stays `md:flex` but the board
   drops to fewer columns (e.g. 2) between `md` and `lg`, matching true
   available width.
2. **Staff Order History mobile card view** — give
   `order-history-list.tsx`'s 7-column table the same `md:hidden` card-list
   / `hidden md:block` table split `menu-management.tsx` already has, so
   phone users aren't required to horizontal-scroll through 7 columns.
3. Add an `sm:` step to `pos-terminal.tsx:219`'s item grid
   (`grid-cols-2 sm:grid-cols-2 md:grid-cols-3...` or similar) so
   640-767px isn't stuck at 2 sparse full-width columns.

## Phase 3 — Admin residuals

1. Fix `settings-view.tsx:148`'s fixed `grid-cols-2` → `grid-cols-1
   sm:grid-cols-2`, matching the rest of the codebase's own convention.
2. Fix `tables-management.tsx:253`'s `h-6 w-6` rename-pencil to match the
   `h-9 w-9` sizing of its sibling Save/Cancel buttons in the same view.
3. **RC-8, admin half: migrate to `next/image`** for
   `landing-hero-settings-card.tsx`'s preview tiles and
   `menu-item-form.tsx`'s current-photo preview branch (the local-file
   `blob:` preview branch genuinely can't use `next/image` without
   `unoptimized` — leave that branch as-is, only convert the
   already-uploaded-URL branch).

## Phase 4 — Live Verification Handoff (user, on a real device)

Everything below is NEEDS-LIVE-VERIFICATION from the audit — a judgment call
that needs real-device eyes, not something to fix speculatively. Check each
against **https://phadincoffee.vercel.app** (not localhost, per project
convention) on both a real phone and tablet if possible, both light and dark
mode, both `vi` and `en` locales where text-length matters.

**Customer / Marketing**
- Landing: `header-actions-stack` corner (RoleBadge+ThemeToggle+LanguageSwitcher)
  — any mis-taps hitting the wrong control?
- Landing: coffee-cup hero — does the rotation feel smooth on a mid-range
  phone, or janky? Does `prefers-reduced-motion` (enable it in OS
  accessibility settings) actually stop it after Phase 0's fix?
- ~~Landing: best-sellers gallery scroll section — any visible jank
  scrolling through the 400vh pinned section?~~ **CONFIRMED broken and
  fixed 2026-07-31** — windowed rendering (only `WINDOW_RADIUS` items
  mounted at once) + reduced mobile blur radius, see the design doc's
  residual-findings update. Re-check on a real phone/iPad after this
  lands to confirm the fix actually resolved it, not just in theory.
- Product detail page: modifier options grid at 375px — cramped with real
  (especially Vietnamese) option names?

**Staff / POS / KDS**
- Kitchen Board at exactly 768-1023px (a real tablet in portrait) — confirm
  the Phase 2 breakpoint fix actually reads comfortably, not just
  arithmetically less-cramped.
- POS item grid at 640-767px (large phone landscape / small tablet
  portrait) — does the Phase 2 fix look right, not just "not 2 columns"?

**Admin**
- `landing-hero-settings-card.tsx` 4-slot image grid at 375px — are the
  shrunk preview tiles still usable as drop targets?
- `menu-item-form.tsx` Sizes-editor row at 375px — is the narrowed name
  input actually usable for typing, or does it need its own layout change
  (e.g. stack vertically below a certain width)?
- Inventory/Staff-Accounts/Dashboard low-stock tables — is horizontal-scroll
  "good enough" on a real phone, or does it feel bad enough to warrant the
  same card treatment `menu-management.tsx` got? (This is a scope decision,
  not just a bug check — report back your read and we'll decide.)
- Admin drawer open + rotate/resize across the 768px boundary — does
  anything actually double-render, or was this theoretical?
- `useHeaderActionsClearance`'s fallback-then-snap layout jump on first
  paint — how noticeable is it in practice on a real mobile connection?

Report back what's actually broken vs. fine; only confirmed-broken items get
turned into follow-up fix tasks.

## Phase 5 — Final re-verification

Once Phases 0-3 are merged and Phase 4's confirmed-broken items (if any) are
fixed, do one more full pass on the deployed Vercel URL across all pages,
closing out `daily.md` item #1 for good.
