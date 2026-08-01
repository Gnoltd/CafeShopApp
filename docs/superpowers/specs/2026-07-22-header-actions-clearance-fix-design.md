# Design: Header/nav responsive-clearance fix (Landing + Staff)

Date: 2026-07-22

## Context

`components/shared/header-actions-stack.tsx` renders a `fixed top-2
right-2` overlay (`RoleBadge` + `ThemeToggle` + `LanguageSwitcher`) on
every page. Any header/nav that renders its own content in that same
top-right corner has to reserve space for it, or the two visually
collide.

`components/marketing/landing-nav.tsx` already solves this correctly:
it measures the real rendered width of `#header-actions-stack` via
`ResizeObserver` and applies it as a dynamic `marginRight` on its own
Sign Up button, with a safe fallback (`FALLBACK_CLEARANCE_PX = 280`)
before the first measurement.

Two other headers solve the same problem badly:

- `components/staff/kitchen-top-bar.tsx:36,45` hardcodes a guessed
  `pr-52`/`md:mr-52` (fixed 208px) instead of measuring anything. This
  is applied even on mobile, where it doesn't match the actual stack
  width — the reported KDS mobile overlap/cram.
- `components/staff/staff-nav.tsx` reserves no space at all — used by
  `/staff/pos` and `/staff/rewards`, both of which will collide with
  the stack on every breakpoint.

Separately, the landing page has no Login button at all (only
`navSignUp`), and its mobile header renders nothing — `LandingNav`'s
center nav links and Sign Up button are both `hidden ... md:...` with
no mobile fallback, so mobile visitors see a blank header area over
the hero until they scroll (which is also when `HeaderActionsStack`
fades in, per its own deliberate hero-hiding behavior — unrelated bug,
same visual symptom).

## Shared fix — `useHeaderActionsClearance` hook

New file `hooks/useHeaderActionsClearance.ts`:

```ts
"use client"
import { useEffect, useState } from "react"

const GAP_PX = 16
const FALLBACK_CLEARANCE_PX = 280

export function useHeaderActionsClearance(elementId = "header-actions-stack") {
  const [clearance, setClearance] = useState(FALLBACK_CLEARANCE_PX)

  useEffect(() => {
    const el = document.getElementById(elementId)
    if (!el) return
    const update = () => setClearance(el.getBoundingClientRect().width + GAP_PX)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [elementId])

  return clearance
}
```

This is a direct extraction of `landing-nav.tsx`'s existing working
logic — no behavior change there, just de-duplication.

Applied to:

- `landing-nav.tsx` — refactored to call the hook instead of its
  inline `useEffect`/`useState`.
- `kitchen-top-bar.tsx` — the `pr-52 md:px-4` header padding and the
  `md:mr-52` inner-div margin are replaced with the hook's real
  measurement, applied via inline style **at every breakpoint** (not
  gated behind `md:`), since `HeaderActionsStack` itself renders at the
  same fixed position on mobile and desktop. This is what fixes the
  mobile KDS overlap — the static guess is gone entirely.
- `staff-nav.tsx` — gains the same clearance (currently has none),
  applied as `paddingRight`/`marginRight` on its header element the
  same way.

No change to `header-actions-stack.tsx` itself.

## Landing page — Login button (desktop)

- New message key `Landing.navLogin` (both `messages/en.json` and
  `messages/vi.json`), value `"Log In"` / Vietnamese equivalent —
  mirrors the existing `navSignUp` key's naming and placement in the
  `Landing` namespace (kept separate from the generic `Auth.login` key
  since it's landing-nav-specific copy that could diverge later).
- `landing-nav.tsx` adds a Login link (`href="/login"`) immediately
  before the existing Sign Up link, same `hidden ... md:block` desktop-
  only visibility, same pill styling family (secondary/outline treatment
  so Sign Up remains the visually primary action) as Sign Up already
  uses today.
- The dynamic clearance margin (via the shared hook, see above) is
  applied to the login+signup pair's container rather than to Sign Up
  alone, so adding a second button doesn't reopen the collision this
  spec just fixed.

## Landing page — mobile header (currently blank)

- `LandingNav`'s existing `absolute top-0` bar (with its dark gradient
  scrim) stays as the container — no structural change to how it sits
  over the hero.
- On mobile (`md:hidden`), add a hamburger icon button in the same
  right-hand slot the desktop Login/Sign Up pair occupies. Always
  visible (not gated behind hero-scroll, unlike `HeaderActionsStack` —
  that gating is intentional for the admin/theme/language stack, not
  for primary auth entry points).
- Tapping the hamburger opens a small absolutely-positioned dropdown
  (below the button, `absolute right-4 top-16` or similar) containing
  Login and Sign Up links, closing on outside-click or on link
  selection. No new route, no full-screen drawer, no duplication of
  the bottom tab bar's nav links (Menu/Orders/Loyalty/Profile already
  reachable there).
- New message key `Landing.navMenuLabel` (aria-label for the hamburger
  button, e.g. `"Account menu"` / Vietnamese equivalent) for
  accessibility.

## Out of scope

- No change to `HeaderActionsStack`'s hero-hiding behavior — that
  remains intentional per its own comment.
- No hamburger/drawer for the staff-side headers — `kitchen-top-bar.tsx`
  and `staff-nav.tsx` already have working nav (tab row / KitchenSidebar
  on desktop, mobile tab row); this spec only fixes their clearance
  math, not their layout structure.
- No visual redesign of the desktop staff header beyond removing the
  guessed padding — same buttons, same order, just correctly spaced.

## Testing

- No dedicated unit test for a `ResizeObserver`-based hook (matches
  the project's existing lack of coverage for `landing-nav.tsx`'s
  identical inline logic).
- Verified live on `https://phadincafe.vercel.app`:
  - Landing page desktop: Login + Sign Up both visible, no overlap
    with the language switcher at any viewport width down to `md`.
  - Landing page mobile: hamburger visible immediately (no scroll
    needed), opens/closes correctly, Login/Sign Up both reachable.
  - `/staff/orders`, `/staff/pos`, `/staff/rewards` on both a phone-
    width and laptop-width viewport: no overlap between the header's
    own content and the Admin/theme/language stack.
