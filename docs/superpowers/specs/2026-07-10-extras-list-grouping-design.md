# Design: Group extras into one list, show prices on all modifier options

Date: 2026-07-10

## Problem

On Product Detail and the quick-add popup, `item.modifierGroups.map(group =>
<section>...)` renders **every** modifier group as its own titled section.
"Extras" (Extra Shot, Extra Milk, etc.) are each stored as a single-option
modifier group (the same `options.length === 1` convention the admin side
already uses to identify them in `menu-item-form.tsx`), so an item with 5
extras shows 5 separate titled sections stacked vertically instead of one
"Extras" list — exactly the "10 categories instead of one" complaint. None
of the option buttons show a price today; the price only shows up folded
into the running total at the bottom.

## Fix

In both `components/customer/product-detail.tsx` and
`components/customer/quick-add-popup.tsx` (kept identical between the two,
matching this codebase's existing convention that they mirror each other
exactly):

1. Split `item.modifierGroups` into `extraGroups` (`options.length === 1`)
   and `otherGroups` (`options.length > 1`) — same heuristic already used
   in `menu-item-form.tsx`.
2. Render one new "Extras" section for `extraGroups`: a vertical list (not
   a grid), one full-width row per extra, each showing a checkbox-style
   selected indicator, the name, and its price (or a "Free" label when the
   price delta is 0). Tapping a row toggles it exactly like today (existing
   `selectedModifiers` toggle logic is unchanged — this is a rendering
   change only, not a selection-logic change).
3. `otherGroups` keep their current per-group section + 2-column grid
   layout unchanged in structure. Each option button additionally shows
   its price (or "Free") in small text under the name.
4. Both sections are omitted entirely when empty (an item with only extras
   shows no `otherGroups` section, and vice versa) — matches the existing
   pattern of conditionally omitting the whole size section today.

## Out of scope

- No changes to the admin Menu Management extras editor — it already
  renders correctly as a single checklist with prices.
- No changes to `selectedModifiers` state shape, `handleAddToCart`/
  `handleAdd`, or price calculation — purely a rendering split of an
  existing render loop.
- No new i18n keys beyond one label ("Extras") and one label for a
  zero-price option ("Free") — added to both `messages/en.json` and
  `messages/vi.json`, under both `ProductDetail` (existing namespace,
  used by `product-detail.tsx`) and `Menu` (existing namespace, used by
  `quick-add-popup.tsx`).

## Testing

No new query-layer functions or types are introduced (no unit-testable
surface beyond existing UI), so this ships without new Vitest coverage —
consistent with this project's existing component-level testing gap
(documented in `daily.md`'s Known gaps). Verified live on
`https://phadincafe.vercel.app`: an item with multiple extras shows one
"Extras" list with prices, correct toggle/multi-select behavior preserved,
correct running total; an item with a real multi-choice group (e.g. size
or Milk Type, if priced) shows prices under each option; an item with
neither extras nor other groups (e.g. Egg Coffee) shows neither section,
unchanged from today.
