# Design: Admin editor for per-item menu sizes (name, price, order)

Date: 2026-07-10

## Problem

`menu_item_sizes` (`id`, `menu_item_id`, `name`, `price_delta`) is already a
real, per-item table — RLS already grants manager/admin full CRUD
(`menu_item_sizes_admin_all`, migration `0003`) — but there is no admin UI
to add, edit, remove, or price these rows, and no query-layer function for
any of it (`lib/supabase/menu-data.ts` has full CRUD for menu items and
modifier groups/extras, but nothing for sizes). Today's only size-related
admin control is `hasSizeOptions`, a pure on/off toggle (migration `0020`)
for whether the size picker shows at all — it says nothing about which
sizes exist or what they cost. In practice this means every item's actual
size set (e.g. a fixed seeded S/M/L) can only be changed via direct SQL,
not through the admin UI, so an item that should only offer M/L (no S) has
no way to express that today.

## Data model

New migration adds one column:

```sql
alter table public.menu_item_sizes add column sort_order integer not null default 0;
```

No other schema change — `menu_item_id` already scopes sizes per-item (an
item offering only M/L is simply two rows, not three), and `price_delta`
already is the per-size price. Existing seeded rows all default to
`sort_order = 0` (no prior ordering signal exists to backfill from); the
first time an item's sizes are edited through the new UI, saving assigns
a real order.

## Query layer (`lib/supabase/menu-data.ts`)

- `MenuItemSize` type gains `sortOrder: number`.
- `MENU_ITEM_SELECT`'s embedded `menu_item_sizes(...)` selects `sort_order`
  too; `getMenuItems`/`getMenuItemById` add
  `.order('sort_order', { foreignTable: 'menu_item_sizes' })` so the
  embedded array always comes back pre-sorted.
- New `setItemSizes(supabase, itemId, sizes: { name: string; priceDelta:
  number }[]): Promise<void>` — deletes all existing `menu_item_sizes` rows
  for `itemId`, then inserts the given list with `sort_order` set to each
  entry's index in the array. This mirrors `setItemModifierGroups`'s
  existing delete-then-insert bulk-replace convention exactly (same
  file, same pattern) rather than diffing individual creates/updates/
  deletes — simpler, and there's real precedent for it already.

## Admin UI (`components/admin/menu-item-form.tsx`)

New "Sizes" section, positioned near the existing `hasSizeOptions` toggle
(the toggle still controls whether the customer ever sees a size picker;
this section controls what's *in* it when they do — the two stay
independent, matching this project's existing "toggle is explicit, not
inferred from row count" convention).

- Local state: a working array of `{ name: string; priceDelta: number }`
  (no id needed locally — every save fully replaces the set), initialized
  from `initialItem?.sizes` (already sorted) on mount.
- Each row, always editable (no edit-mode toggle, unlike Extras — sizes
  have no recipe sub-editor, so there's nothing to expand/collapse): a
  Name text input, a Price number input, an up-arrow and down-arrow
  (swap with the adjacent row; first row's up arrow and last row's down
  arrow are disabled), and a remove (X) button.
- An "Add Size" button appends one blank row (`{ name: "", priceDelta: 0 }`)
  to the end.
- On the main form Save: any row with a blank/whitespace-only name blocks
  save with an inline error (mirrors the existing required-fields check
  pattern) — a size with no name would be meaningless to a customer. A
  price of `0` is valid and saveable (a free/included size, same as `0`
  is already valid for a modifier's `priceDelta`).
- `onSave`'s signature gains a `sizes` parameter alongside the existing
  `extraGroupIds`/`recipeEntries`. In `components/admin/menu-management.tsx`'s
  `saveItem`, call `setItemSizes(supabase, saved.id, sizes)` right after
  `createMenuItem`/`updateMenuItem` resolves — same sequencing already
  used for `setItemModifierGroups`/`setMenuItemIngredients` (the new
  item's real id isn't known until that call returns).

## Customer-facing side

No changes. `product-detail.tsx` and `quick-add-popup.tsx` already render
`item.sizes.map(...)` in whatever array order the query returns; once
that array is pre-sorted by `sort_order`, the existing `SegmentedControl`
size picker automatically reflects the new order with zero component
changes.

## Out of scope

- No change to `hasSizeOptions`'s own behavior or meaning.
- No per-size ingredient recipe (sizes aren't modifiers; recipe scaling
  by size isn't part of this request).
- No drag-and-drop reordering — up/down arrows only, matching the
  request's own framing ("reorder controls") without extra complexity.
- No backfill/migration of existing seeded sizes' relative order (see
  Data model above) — cosmetic only, self-heals the next time an item's
  sizes are edited.

## Testing

New `setItemSizes` gets Vitest coverage in
`lib/supabase/menu-data.test.ts` (delete-then-insert call shape, mirroring
the existing `setItemModifierGroups` tests in the same file). No new
Deno/RPC surface (this is a plain-table RLS-authorized operation, no
`security definer` function needed — `menu_item_sizes_admin_all` already
covers it). Live-verified on `https://phadincafe.vercel.app`: add two
sizes to an item that has none, confirm they appear correctly ordered and
priced in the customer size picker (both Product Detail and quick-add);
edit an existing size's name/price and confirm the change reflects on the
customer side; reorder two sizes with the arrows and confirm the picker's
order updates to match; remove a size and confirm it no longer appears as
a choice.
