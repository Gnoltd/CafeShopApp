# Manager App Reconciliation — Design

## Why

The user imported a Claude Design canvas ("PhaDinCafe Manager App",
project `b774e8b3-40d0-4447-ae9c-80a8b1463fd1`, file `PhaDinCafe Manager
App.dc.html`) as the reference for the admin/manager surface, and asked
for it to be implemented. This canvas is built on this project's own
real design tokens (`_ds/phadincafe-design-system-*`, identical
`--primary`/`--radius`/`nb-border` values to `app/globals.css`), and
covers 7 sections: Dashboard, Tables, Inventory, Menu, Staff, Shift,
Settings, inside a mobile app shell (390×820, hamburger drawer nav).

This continues an existing pattern already visible in recent commits —
`Reconcile Settings' Save/Cancel row for mobile`, `Reconcile Shift's
mobile layout`, `Give Staff Accounts a mobile card list, matching the
reference` — of bringing each admin page in line with this same
reference, incrementally, directly on `main` (not as a separate
worktree redesign like `redesign/customer-app` or
`redesign/kitchen-display`, which are full from-scratch rebuilds of
different surfaces).

## Audit result

A per-section audit (see conversation) found:

- **Tables, Inventory** — already fully match the reference. No changes.
- **Staff, Shift** — already match; Shift's real implementation
  exceeds the mock (History tab, planned window, notes — none in the
  mock). No changes.
- **Dashboard** — one gap: the Low Stock Alerts KPI card
  (`components/admin/dashboard-view.tsx:129-135`) isn't a link. The
  reference makes it clickable to Inventory, matching the Revenue
  card's existing `Link` treatment.
- **Settings** — one gap: the Loyalty Settings toggle
  (`components/admin/settings-view.tsx`) has no explanatory hint text
  under it. The reference shows copy that changes based on on/off
  state.
- **Menu** — the real gap, and the reason this task exists: the
  reference's Menu screen models **multi-category assignment** — an
  item can carry more than one category tag (`item.cats: string[]`,
  toggle-chip pickers with checkmarks and a "pick more than one" hint,
  a multi-select category filter row with a "Filtering N categories"
  hint). Today's schema/UI is single-category everywhere
  (`menu_items.category_id`, one `<select>`, one active filter).
  Per-row category badges/icon-chip display in the reference already
  matches what real menu items with photos already do here (photo
  when present, icon fallback otherwise) — not a gap, no change needed
  there.

## Decisions

1. **Dashboard/Settings fixes**: trivial, one-line-scale changes — no
   schema, no new components. Folded into the same plan as Tasks 1-2.
2. **Multi-category schema**: replace `menu_items.category_id` (a
   `not null` FK) with a `menu_item_categories` join table
   (`menu_item_id`, `category_id`, composite PK), mirroring the
   existing `menu_item_modifier_groups`/`menu_item_sizes` join-table +
   `setItemXxx()` delete-then-insert pattern already used in
   `lib/supabase/menu-admin.ts`. RLS mirrors `menu_items`' own
   policies exactly (`select using (true)`, `all` gated on
   `current_user_role() in ('manager','admin')`).
3. **Data preservation**: every existing item's current
   `category_id` becomes its one row in the new join table before the
   old column is dropped — confirmed with the user (each item keeps
   its current category as its one tag; nothing changes for existing
   items until someone edits them to add more).
4. **"At least one category" is a client-side required-field check**,
   not a DB constraint — matches this project's existing pattern for
   other required fields (name, price) and the reference's own
   client-side validation (`fCats.length===0` check in the mock). A
   DB-level "at least one child row exists" invariant isn't
   declaratively expressible as a constraint in Postgres without a
   trigger, and no other required-relationship in this schema uses one.
5. **Category deletion's existing FK-restrict-driven friendly error**
   (`deleteCategory`'s catch, `menu-categories-card.tsx`) needs no code
   change — the join table's own `category_id` FK (`on delete
   restrict`) throws an equivalent generic FK-violation error when a
   category still has member items, and the catch already treats any
   `error` generically rather than pattern-matching the old
   constraint's name. Only the explanatory comment referencing the old
   constraint name needs updating.
6. **POS and the customer Menu browser stay single-select tabs** — no
   UI change requested there. Their category filter only needs an
   equality-to-membership fix (`item.categoryId === selectedCategory`
   → `item.categoryIds.includes(selectedCategory)`), since an item can
   now match more than one tab.
7. **Admin Menu Management gets the reference's actual UI**: category
   filter chips become multi-select (toggle chips, checkmark when
   active, "All" clears the selection, a "Filtering N categories" hint
   above the list when more than one is active), and the item form's
   single `<select>` becomes a multi-select chip picker (same toggle/
   checkmark pattern, "pick more than one" hint), both in the existing
   `nb-border`/chip visual language already used elsewhere in this file
   — no new component needed.

## Out of scope

- Any change to POS's or the customer Menu browser's *filter UI*
  (multi-select tabs there) — only their matching logic changes.
- Re-touching Tables/Inventory/Staff/Shift — audited, no gaps found.
- A DB-level "at least one category" trigger (see Decision 4).
- Backfilling `supabase/CLAUDE.md`'s migration table for the
  already-undocumented `0081`-`0089` migrations — unrelated to this
  work; only this task's own migration (`0090`) is added to the table.

## Spec-to-task map

| Decision | Plan task(s) |
|---|---|
| Dashboard fix | Task 1 |
| Settings fix | Task 2 |
| Schema (join table + backfill + RLS) | Task 3 |
| Query layer (`menu-mapping.ts`, `menu-catalog.ts`) | Task 4 |
| `setItemCategories` + `menu-admin.ts`/`save-menu-item.ts` wiring | Task 5 |
| POS/customer Menu browser membership check | Task 6 |
| Admin category filter (multi-select) | Task 7 |
| Admin item form (multi-select picker) | Task 8 |
| i18n keys | folded into Tasks 2, 7, 8 |
