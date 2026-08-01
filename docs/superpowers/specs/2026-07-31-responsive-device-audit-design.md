# Responsive/Adaptive Device Audit — Design

## Why

`daily.md`'s open item #1 ("Neubrutalist Modern" full-app redesign) has one
remaining step: live-verify the shipped redesign works correctly across real
devices — colors, dark mode, both locales, phone/tablet/desktop layout. That
verification was deliberately deferred at ship time and never done. This spec
is that verification's first half: a static code audit (this agent has no
browser/screenshot tool available) that finds everything checkable from the
source, before a human does the second half — actually loading the live site
on a real phone.

This is not a re-design. The redesign already shipped; this is finding out
where it doesn't actually hold up device-to-device, plus a systematic pass on
image sizing (the app has no `next/image` usage anywhere and a recent history
of one-off percentage tweaks to the coffee-cup hero and gallery cards, both
symptoms of the same missing system) and on motion/performance for the
landing page's heavier animated pieces (3D hero, scroll-linked gallery).

## Scope decisions (from grilling session, 2026-07-31)

- Customer, Staff (POS/KDS), and Admin all need full phone (375–428px)
  through tablet (768–1024px) through desktop (1280px+) support — no reduced
  target for staff/admin tools.
- Images get a systematic fix (proper `next/image` `sizes`, aspect-ratio
  containers, deliberate `object-fit`), not more one-off nudges.
- Motion/performance (3D hero render cost, scroll-jank, `prefers-reduced-motion`)
  is in scope, not just static layout.
- Findings are split HIGH-CONFIDENCE (structurally broken regardless of
  device — fixed in this pass) vs NEEDS-LIVE-VERIFICATION (a real device
  judgment call — queued for the user's device pass, see the plan's
  Verification Handoff phase).
- No custom Tailwind breakpoints exist in this project — plain v4 defaults
  (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536) were used as the test
  matrix.

## Methodology

Four parallel research subagents audited disjoint slices of the codebase
against one checklist (breakpoint coverage, fixed-width/overflow risk, touch
target sizing, image `sizes`/aspect-ratio correctness, motion/perf +
`prefers-reduced-motion`): Customer+Marketing+Auth, Staff (POS/KDS), Admin,
and shared UI primitives/theme (`app/globals.css`, `components/ui/*`, the
fixed header-actions stack, `useTheme`). No files were edited during the
audit. Full raw findings are preserved in each subagent's transcript; this
doc synthesizes them into root causes plus residual per-area findings.

## Root-cause findings (fix once, resolves many symptoms)

These are the highest-leverage fixes — each one collapses several
independently-flagged symptoms across all three role areas.

### RC-1 — Shared `Button`/`Input` touch-target sizing is undersized at every breakpoint, not just mobile
`components/ui/button.tsx:24-36` — `default` is `h-8` (32px), `sm` is `h-7`
(28px), `xs`/`icon-xs` are `h-6`/`size-6` (24px), even `icon-lg` only reaches
`size-9` (36px). `components/ui/input.tsx:12` is a fixed `h-8` (32px) always.
None scale up for touch. This single fact explains nearly every "under 44px"
finding surfaced independently across all three area audits: the mobile back
button (`header.tsx:38`), cart qty buttons, address-book edit/delete,
menu-browser quick-add, theme toggle, role badge, language switcher, rewards
modal close, QR scanner close, POS quantity buttons, kitchen-pending-payment
Confirm Cash (explicit `h-7` override), tables-management rename pencil, and
more. **HIGH-CONFIDENCE.**

### RC-2 — `.nb-press-sm:active` has no matching base transition rule
`app/globals.css:236-239` defines `.nb-press-sm:active` but never defines a
base `.nb-press-sm { transition: ... }` (unlike `.nb-press`, which has one at
lines 229-231). Every element using `nb-press-sm` alone — the overwhelming
majority of press-feedback usages app-wide (~20+ call sites across staff,
customer, and admin) — snaps instantly instead of animating the intended
tactile press. **HIGH-CONFIDENCE**, confirmed from source.

### RC-3 — `.nb-press`'s intended 100ms transition is silently overridden by Tailwind's `transition-all`
`app/globals.css:229-231` declares `transition: transform 100ms ease,
box-shadow 100ms ease`, but the shared `Button`'s own `transition-all` base
class (`components/ui/button.tsx:7`) wins per Tailwind v4's layer ordering
(components before utilities, confirmed against the actual compiled CSS
output). Every `neubrutal`-variant button press animates at Tailwind's
default 150ms curve instead of the designed 100ms snap. **HIGH-CONFIDENCE**,
confirmed against compiled output, not speculative.

### RC-4 — `(marketing)` route never wraps children in `MotionConfig reducedMotion="user"`
`app/[locale]/(marketing)/layout.tsx:6-13`, unlike
`(customer)/layout.tsx`. Every Framer Motion animation on the landing page
(the scroll-linked `BestSellersGallery` arc, the marquee, if re-enabled) and
the coffee-cup-hero's imperative rAF loop (see RC-5) all ignore the OS-level
`prefers-reduced-motion` preference. This directly contradicts the redesign
spec's own stated verification requirement that reduced-motion "collapse
animations." **HIGH-CONFIDENCE.**

### RC-5 — Coffee-cup hero's rotation loop never stops running
`components/marketing/coffee-cup-hero.tsx:71-118` — the auto-rotate/parallax
loop is imperative code (`requestAnimationFrame`, direct
`model-viewer.setAttribute` calls) outside Framer Motion entirely, so RC-4's
fix won't cover it — it needs its own `matchMedia("(prefers-reduced-motion:
reduce)")` check. Separately, the loop and its `mousemove`/`scroll` listeners
are gated only on `renderMode === "model"`, with no visibility check — they
keep running (burning GPU/battery) indefinitely after the user has scrolled
hundreds of vh past the hero into the gallery below. **HIGH-CONFIDENCE**
(missing gates are structural); actual battery/jank severity is
**NEEDS-LIVE-VERIFICATION**.

### RC-6 — `admin-mobile-header.tsx` was missed by the header-clearance fix
`components/admin/admin-mobile-header.tsx:12` still hardcodes `pr-64`
(256px) as a static guess to clear the fixed header-actions stack, instead
of using `useHeaderActionsClearance` — the hook that
`docs/superpowers/specs/2026-07-22-header-actions-clearance-fix-design.md`
introduced specifically to replace this exact anti-pattern, and which
`customer/header.tsx`, `staff/staff-nav.tsx`, `staff/kitchen-top-bar.tsx`,
and `marketing/landing-nav.tsx` all already adopted. On a 375px phone this
reserves ~256px of a ~375px header, leaving only ~70-90px for the hamburger
+ icon + "PhaDinCafe" brand text, which truncates hard — and being a
static guess (not measured), it's wrong by construction whenever the real
stack width differs (locale, role-label length, browser text zoom).
**HIGH-CONFIDENCE**, same bug class the project's own spec already found and
fixed everywhere else.

### RC-7 — `SideDrawer`'s close never animates (same pattern affects `BottomSheet`)
`components/admin/admin-sidebar.tsx:102-108` conditionally mounts
`&lt;SideDrawer&gt;` (`{open && &lt;SideDrawer&gt;...&lt;/SideDrawer&gt;}`), but
`SideDrawer` (`components/motion/side-drawer.tsx:17-41`) puts its own
`AnimatePresence` around an always-present child instead of the caller
keeping `AnimatePresence` mounted while only the child unmounts. Framer
Motion's exit animation only fires when `AnimatePresence` stays mounted
across the removal — here the whole subtree (its own `AnimatePresence`
included) is removed in one commit, so closing (scrim tap, nav-link tap, or
the swipe-to-dismiss gesture) makes the drawer vanish instantly with no
slide-out, contradicting the design doc's explicit "scrim + spring-animated
panel" and swipe-to-dismiss goals. The identical pattern exists at
`BottomSheet`'s 3 call sites elsewhere in the app (pre-existing convention,
not unique to admin) — flagged here because `SideDrawer` is the piece built
specifically for admin mobile nav and the doc explicitly promised this
motion. **HIGH-CONFIDENCE**, structural not viewport-dependent.

### RC-8 — No `next/image` usage anywhere in the app
Confirmed repo-wide: every image (`components/customer/item-image.tsx`,
`product-detail.tsx`, `admin/landing-hero-settings-card.tsx`,
`admin/menu-item-form.tsx`) uses a raw `&lt;img&gt;` with no `sizes`, no
responsive `srcset`, no format negotiation, no lazy-loading policy. Full-
resolution source images (uploads capped at 8MB) download regardless of a
~100-150px rendered thumbnail size, on every viewport including 375px
phones. This is the direct cause of the "image sizing" pain the user
flagged — the coffee-cup hero and gallery cards have been hand-tuned by
percentage guesswork (`af3a7c2`, `b917203`, `9040076`) because there's no
underlying system making images render correctly sized in the first place.
**HIGH-CONFIDENCE.**

### RC-9 — `MODEL_SCALE` in the coffee-cup hero is a dead, misleading constant
`components/marketing/coffee-cup-hero.tsx:14` (`MODEL_SCALE = 0.1375`) has
been manually halved twice by prior "shrink the cup" commits, but
`lib/coffee-cup-orbit.ts`'s own inline comment (lines 12-16) states
`MODEL_SCALE` has **no effect** on apparent on-screen size — `model-viewer`'s
auto-fit camera cancels it out. The real lever is `BASE_RADIUS` in the orbit
helper (a percentage of auto-fit distance) combined with the container's own
Tailwind width classes (`w-[85%] sm:w-[70%] md:w-[62%]`,
`coffee-cup-hero.tsx:149/152`). This has misled two size-tweak commits
already and will mislead the next one. Directly in scope per the "systematic
image sizing, not one-off tweaks" decision. **HIGH-CONFIDENCE** as a
maintainability defect; not itself a visible bug today.

## Residual per-area findings (not covered by a root cause)

### Customer / Marketing
- `menu-browser.tsx:134` quick-add "+" is `h-9 w-9` (36px) — narrower gap
  than most RC-1 cases but still under target once RC-1's scale changes;
  re-check after RC-1 lands. NEEDS-LIVE-VERIFICATION.
- `landing-nav.tsx:61` — desktop signed-in greeting has no `truncate`/`max-w`
  guard (mobile-menu version at line 110 does), so a long `full_name` can
  overflow/push the logout button in the tight `hidden md:flex` row the
  component's own comment already flags as tight. HIGH-CONFIDENCE (missing
  truncation is verifiable; overflow severity is a live judgment call).
- `product-detail.tsx:180` — `grid-cols-2` modifier options with no
  breakpoint variant; could feel cramped with long bilingual option names at
  375px. NEEDS-LIVE-VERIFICATION.
- `header-actions-stack.tsx:36-46` — RoleBadge+ThemeToggle+LanguageSwitcher
  packed at `gap-2` in a fixed top-right corner; even after RC-1 widens each
  target individually, three adjacent small targets in a tight fixed corner
  is a real mis-tap risk worth a live check. NEEDS-LIVE-VERIFICATION.
- `best-sellers-gallery.tsx:245` — `h-[400vh]` scroll-pinned section running
  5 `useTransform` chains per item, all items mounted simultaneously (not
  virtualized) — plausible jank source on a low/mid phone GPU. **CONFIRMED
  via live device testing 2026-07-31** (RC-5's hero loop was already fixed
  by the time this was checked, so it wasn't a compounding factor). Fixed
  same day: only items within `WINDOW_RADIUS` (2) of the current scroll
  position stay mounted, the rest unmount entirely instead of animating to
  `opacity: 0`; the ambient glow `blur-[150px]` radius (not just box size)
  now also scales down below `md`.
- `best-sellers-marquee.tsx` — confirmed **dead code**, not rendered
  anywhere (`landing-view.tsx` renders `BestSellersGallery` instead). Has
  its own reduced-motion/hover-only-pause gaps, but since nothing mounts it,
  fixing it is out of scope for this pass — flagged for a separate cleanup
  (delete or wire back in), not fixed here.

### Staff / POS / KDS
- `kitchen-board.tsx:47` + `kitchen-sidebar.tsx:25` — both switch at the
  same `md` (768px) breakpoint, so the entire 768-1023px tablet band gets a
  fixed 256px sidebar **and** a rigid 4-column board simultaneously —
  arithmetic works out to ~108-172px per column, too narrow for the order
  cards' content (id, badge, timer, item rows, action button text) which
  isn't designed for that width (only the phone single-column view or
  ≥1280px desktop are actually comfortable). HIGH-CONFIDENCE geometry; exact
  clipping severity NEEDS-LIVE-VERIFICATION.
- `order-history-list.tsx:127-171` — 7-column order table wrapped only in
  bare `overflow-x-auto`, no `md:hidden` card fallback, unlike POS/KDS which
  both got dedicated mobile layouts. Structurally the one dense-data view in
  the staff surface with zero mobile-specific treatment. HIGH-CONFIDENCE.
- `pos-terminal.tsx:219` — item grid `grid-cols-2 gap-3 lg:grid-cols-3
  xl:grid-cols-4` has no `sm:`/`md:` step, so 640-767px (landscape phone /
  small tablet portrait) stays at 2 columns across full width — unusually
  wide/sparse cards, not broken. NEEDS-LIVE-VERIFICATION.

### Admin
- `settings-view.tsx:148` — fixed `grid-cols-2` for Phone/Hours fields, no
  mobile fallback, inconsistent with every comparable field pairing
  elsewhere in admin (`ingredient-form.tsx`, `menu-item-form.tsx` both use
  `grid-cols-1 ... sm:grid-cols-2`). HIGH-CONFIDENCE.
- `landing-hero-settings-card.tsx:128` — same fixed `grid-cols-2` pattern
  for 4 image-upload slots; doesn't overflow but shrinks preview/drop
  targets more than intended at 375px. NEEDS-LIVE-VERIFICATION.
- `tables-management.tsx:253` — inline rename-pencil is `h-6 w-6` (24px),
  below even this project's own stated 28-32px floor for dense admin
  controls, and an outlier among otherwise-`h-9`-sized icon buttons in the
  same view. HIGH-CONFIDENCE.
- `menu-item-form.tsx:543-587` — each Sizes-editor row packs a flex-1 name
  input against two fixed-width siblings (a 112px price input + ~84px of
  icon buttons) inside a modal that's only ~295px wide at 375px, leaving
  ~65-70px for the name input — doesn't clip, but is uncomfortably narrow.
  NEEDS-LIVE-VERIFICATION.
- `inventory-management.tsx`, `staff-accounts.tsx`, `dashboard-view.tsx` —
  three data tables rely on horizontal scroll only, while
  `menu-management.tsx` got a proper `md:hidden` card-list treatment in the
  same redesign pass. Not broken, but an inconsistent phone experience
  across admin list views. NEEDS-LIVE-VERIFICATION (is horizontal-scroll
  "good enough" here, or should these three match menu-management's
  pattern).
- `admin-layout-client.tsx` drawer-open state has no `md` media-query
  awareness — a resize/rotation across the 768px boundary while the drawer
  is open could theoretically show both the overlay drawer and the desktop
  `&lt;aside&gt;` at once. NEEDS-LIVE-VERIFICATION (reachability unconfirmed).
- `useHeaderActionsClearance.ts:9` — `FALLBACK_CLEARANCE_PX = 280` applies
  before the `ResizeObserver`'s real measurement lands, causing a visible
  layout jump on first paint on every header that uses the hook.
  NEEDS-LIVE-VERIFICATION.

## Out of scope for this pass

- `best-sellers-marquee.tsx` — dead code, not rendered; noted above, not
  fixed here.
- `tables-management.tsx`'s layout not matching the redesign spec's locked
  mockup (QR box on the right edge, overlapping regenerate button) — a
  fidelity gap from the original design doc, not a responsiveness bug (the
  shipped layout's own grid is correctly responsive). Noted for awareness,
  not part of this fix pass.
