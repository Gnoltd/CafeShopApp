# Manager App Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two small admin-page gaps found against the "PhaDinCafe
Manager App" design reference (Dashboard, Settings), and give menu items
real multi-category assignment (the one substantive gap: today's schema/UI
only supports one category per item).

**Architecture:** Dashboard/Settings fixes are one-file, few-line changes.
Multi-category replaces `menu_items.category_id` (a `not null` FK) with a
`menu_item_categories` join table, following this codebase's existing
`menu_item_modifier_groups`/`menu_item_sizes` join-table + `setItemXxx()`
delete-then-insert pattern. `MenuItem.categoryId: string` becomes
`MenuItem.categoryIds: string[]` everywhere it's consumed; POS and the
customer Menu browser change their category-match check from equality to
array membership (their filter UI stays single-select — only admin Menu
Management gets a multi-select filter/picker, matching the reference).

**Tech Stack:** Next.js/React, Supabase (Postgres + RLS), next-intl,
Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-manager-app-reconciliation-design.md`

## Global Constraints

- Every `SupabaseClient`-consuming function takes the client as its first
  argument (DI'd query-layer convention) — never import a singleton.
- New/changed i18n keys must be added to **both** `messages/vi.json` and
  `messages/en.json` in the same task.
- A new `SECURITY DEFINER` function is not needed here (no new RPC), but
  any new table needs RLS enabled and policies mirroring the pattern used
  by sibling tables (`categories_select_all`/`categories_admin_all`
  style) — see Task 3.
- Run `mcp__supabase__get_advisors(type: "performance")` after the new
  migration lands, per this project's stated convention of checking new
  tables for missing FK indexes.
- This project verifies against the deployed Vercel URL for "does it
  actually work," but `apply_migration` runs directly against the live
  hosted Supabase project (`qhiypdqnrnzndxdwqxbx`) — there is no local/
  staging DB to rehearse against first. Run local `vitest`/`tsc`
  aggressively before applying the migration since it can't be dry-run.

---

## Task 1: Dashboard — make the Low Stock Alerts KPI card clickable

**Files:**
- Modify: `components/admin/dashboard-view.tsx:129-135`

**Interfaces:** none (self-contained JSX change, `Link` already imported
in this file for the Revenue card at line 97).

- [x] **Step 1: Make the change**

Replace the plain `<div>` low-stock KPI card with a `Link`, matching the
existing Revenue card's pattern exactly:

```tsx
        <Link
          href="/admin/inventory"
          className="nb-border-sm nb-shadow-sm nb-press-sm rounded-xl border-destructive bg-destructive/5 p-5"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-destructive">{t("lowStockAlerts")}</p>
          <h3 className="text-xl font-bold text-destructive">{lowStock.length}</h3>
        </Link>
```

(This replaces the `<div className="nb-border-sm nb-shadow-sm rounded-xl border-destructive bg-destructive/5 p-5">...</div>` block currently at lines 129-135 — same content, `div` → `Link href="/admin/inventory"`, dropping the now-redundant `nb-press-sm`-less class since the other clickable card already carries `nb-press-sm`.)

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [x] **Step 3: Commit**

```bash
git add components/admin/dashboard-view.tsx
git commit -m "$(cat <<'EOF'
Make Dashboard's Low Stock Alerts KPI card link to Inventory

Matches the reference design's clickable-KPI pattern already used by
the Revenue card on this same page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 2: Settings — add dynamic hint text under the Loyalty toggle

**Files:**
- Modify: `components/admin/settings-view.tsx` (around line 246, right
  after the `CardHeader`'s closing tag, before `<CardContent>`)
- Modify: `messages/vi.json` (`AdminSettings` namespace)
- Modify: `messages/en.json` (`AdminSettings` namespace)

**Interfaces:** none new — reuses `loyaltyDraft.earnRate`/`redeemRate`
already in this component's state (see `toLoyaltyDraft`, lines 41-43) and
`formatVND` (already used elsewhere in this codebase, import it from
`@/lib/format` if not already imported in this file).

- [x] **Step 1: Add the two i18n keys**

In `messages/vi.json`, inside `"AdminSettings"`, add (next to
`"loyaltyEnabled"`):

```json
    "loyaltyEnabledHint": "Tích 1 điểm mỗi {earnRate} · {redeemRate} = 1 điểm khi đổi thưởng",
    "loyaltyDisabledHint": "Chương trình đang tắt — khách không tích hoặc đổi điểm được.",
```

In `messages/en.json`, inside `"AdminSettings"`:

```json
    "loyaltyEnabledHint": "Earn 1 point per {earnRate} · {redeemRate} = 1 point redeemed",
    "loyaltyDisabledHint": "The programme is off — guests can't earn or redeem points.",
```

- [x] **Step 2: Check `formatVND` is imported**

Run: `grep -n "formatVND\|^import" components/admin/settings-view.tsx | head -5`

If `formatVND` isn't already imported, add `import { formatVND } from
"@/lib/format"` to the top import block.

- [x] **Step 3: Insert the hint paragraph**

Insert immediately after the `</CardHeader>` at line 247 (before
`<CardContent className={cn("space-y-4 transition-opacity", ...)}>`):

```tsx
        <p className="px-6 pb-2 text-xs text-muted-foreground">
          {loyaltyDraft.enabled
            ? t("loyaltyEnabledHint", {
                earnRate: formatVND(Number(loyaltyDraft.earnRate) || 0),
                redeemRate: formatVND(Number(loyaltyDraft.redeemRate) || 0),
              })
            : t("loyaltyDisabledHint")}
        </p>
```

- [x] **Step 4: Typecheck and run the existing settings tests**

Run: `npx tsc --noEmit && npx vitest run components/admin/settings-view`
Expected: no errors (there may be no dedicated test file for this
component — if `vitest run` reports no matching test files, that's fine,
just confirm `tsc` is clean).

- [x] **Step 5: Commit**

```bash
git add components/admin/settings-view.tsx messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Add dynamic hint text under Admin Settings' Loyalty toggle

Matches the reference design, which explains what the toggle does in
its current state rather than leaving it unlabeled.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 3: DB migration — `menu_item_categories` join table

**Files:**
- Create: `supabase/migrations/0090_menu_item_multi_category.sql`
- Modify: `supabase/CLAUDE.md` (append the new migration to the table)

**Interfaces:**
- Produces: table `public.menu_item_categories(menu_item_id uuid,
  category_id uuid, primary key (menu_item_id, category_id))`, backfilled
  1:1 from every existing `menu_items.category_id`. `menu_items` loses
  its `category_id` column entirely after the backfill.

- [x] **Step 1: Write the migration file**

```sql
-- Menu items become many-to-many with categories. Was menu_items.category_id
-- (a single required FK); replaced by a join table so one item can carry
-- more than one category tag, matching the existing
-- menu_item_modifier_groups / menu_item_sizes join-table pattern. Every
-- existing item's current category_id is preserved as its one row here
-- before the old column is dropped.

create table public.menu_item_categories (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  primary key (menu_item_id, category_id)
);
alter table public.menu_item_categories enable row level security;

create index menu_item_categories_category_id_idx on public.menu_item_categories(category_id);

create policy "menu_item_categories_select_all" on public.menu_item_categories for select using (true);
create policy "menu_item_categories_admin_all" on public.menu_item_categories for all
  using (public.current_user_role() in ('manager', 'admin'))
  with check (public.current_user_role() in ('manager', 'admin'));

insert into public.menu_item_categories (menu_item_id, category_id)
select id, category_id from public.menu_items;

alter table public.menu_items drop constraint menu_items_category_id_fkey;
alter table public.menu_items drop column category_id;
```

- [x] **Step 2: Apply the migration to the live project**

Use `mcp__supabase__apply_migration` with `name: "menu_item_multi_category"`
and the SQL above (the tool prefixes the numeric migration id itself —
confirm the resulting file is named `0090_menu_item_multi_category.sql`
to match Step 1; if the tool's auto-numbering picks a different number,
rename the local file in Step 1 to match so the repo and the live
migration history agree).

- [x] **Step 3: Verify the backfill**

Run via `mcp__supabase__execute_sql`:

```sql
select count(*) from public.menu_items;
select count(*) from public.menu_item_categories;
```

Expected: both counts equal (every item has exactly one row, since this
is a fresh backfill of a `not null` single-FK column).

- [x] **Step 4: Run the advisors check**

Run `mcp__supabase__get_advisors(type: "performance")` — confirm no new
missing-index finding on `menu_item_categories` (the migration already
adds one on `category_id`; the primary key itself indexes
`menu_item_id`).

- [x] **Step 5: Document the migration**

In `supabase/CLAUDE.md`'s migration table, append a row after the `0080`
line:

```markdown
| `0090` | `menu_item_categories` join table replaces `menu_items.category_id` (many-to-many categories) |
```

(Migrations `0081`-`0089` are already undocumented in this table from
earlier work — out of scope to backfill those; only this task's own
migration is added.)

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0090_menu_item_multi_category.sql supabase/CLAUDE.md
git commit -m "$(cat <<'EOF'
Add menu_item_categories join table for multi-category menu items

Replaces menu_items.category_id (a single required FK) with a
many-to-many join table, preserving every existing item's current
category as its one row before the old column is dropped. Follows the
existing menu_item_modifier_groups / menu_item_sizes join-table
pattern (own RLS mirroring menu_items', an index on the FK side).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 4: Query layer — `categoryIds` replaces `categoryId`

**Files:**
- Modify: `lib/supabase/menu-mapping.ts`
- Modify: `lib/supabase/menu-data.test.ts:34-158` (the `getMenuItems`
  and `createMenuItem` tests)

**Interfaces:**
- Consumes: `menu_item_categories` table from Task 3.
- Produces: `MenuItem.categoryIds: string[]` (replaces `categoryId:
  string`), `MenuItemRow.menu_item_categories: { category_id: string }[]
  | null`. Every later task that reads an item's category reads
  `item.categoryIds` (an array), never `item.categoryId`.

- [x] **Step 1: Update the failing test expectations first**

In `lib/supabase/menu-data.test.ts`, in the `getMenuItems` describe block
(lines 34-103): change the fixture row's `category_id: "cat-1"` (line 38)
to `menu_item_categories: [{ category_id: "cat-1" }]`, and change the
expected result's `categoryId: "cat-1"` (line 79) to `categoryIds:
["cat-1"]`.

In the `createMenuItem` describe block (lines 105-159): change the
fixture row's `category_id: "cat-1"` (line 109) to
`menu_item_categories: [{ category_id: "cat-1" }]`, and remove
`categoryId: "cat-1"` from the `createMenuItem(supabase, {...})` call's
input object at line 131 (it moves to a separate `setItemCategories`
call in Task 5, so `MenuItemInput` no longer carries a `categoryId`
field at all — see Task 5 for the full input shape and the matching
`insertSpy` assertion update, which also drops `category_id` from the
expected inserted row at line 144).

- [x] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: FAIL — `categoryIds` is `undefined` on the mapped result (the
mapping function hasn't changed yet).

- [x] **Step 3: Update `menu-mapping.ts`**

In `lib/supabase/menu-mapping.ts`:

Replace line 27 (`categoryId: string`) with `categoryIds: string[]` in
the `MenuItem` type.

Replace lines 69-70 (`category_id: string`) in `MenuItemRow` with:
```ts
  menu_item_categories: { category_id: string }[] | null
```

In `MENU_ITEM_SELECT` (lines 85-92), replace `category_id,` (in the
top-level column list on line 86) with a nested join, and add
`menu_item_categories ( category_id ),` alongside the other nested
selects:

```ts
export const MENU_ITEM_SELECT = `
  id, name_vi, name_en, description_vi, description_en,
  base_price, icon, is_available, is_popular, image_url, has_size_options,
  menu_item_categories ( category_id ),
  menu_item_sizes ( id, name, price_delta, sort_order ),
  menu_item_modifier_groups (
    modifier_groups ( id, name_vi, name_en, is_required, modifiers ( id, name_vi, name_en, price_delta ) )
  )
`
```

In `mapMenuItemRow` (lines 94-127), replace `categoryId: row.category_id,`
(line 97) with:

```ts
    categoryIds: (row.menu_item_categories ?? []).map((c) => c.category_id),
```

- [x] **Step 4: Run the tests again to confirm they pass**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: the `getMenuItems` test passes. The `createMenuItem` test will
still fail until Task 5 removes `category_id` from `toRow()` — that's
expected; move on to Task 5 immediately (these two tasks are one
logical change split for reviewability, not independently shippable).

- [x] **Step 5: Commit**

```bash
git add lib/supabase/menu-mapping.ts lib/supabase/menu-data.test.ts
git commit -m "$(cat <<'EOF'
MenuItem.categoryIds replaces categoryId in the query-mapping layer

Reads the new menu_item_categories join table (Task 3) into a string
array. Query-layer half of the multi-category change; menu-admin.ts's
write side follows in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 5: `setItemCategories` + wire it into save/update

**Files:**
- Modify: `lib/supabase/menu-admin.ts`
- Modify: `lib/supabase/menu-admin.test.ts` (no change needed — it only
  covers `createCategory`/`updateCategory`/`deleteCategory`, untouched
  by this task)
- Modify: `lib/supabase/menu-data.test.ts` (finish the `createMenuItem`
  test from Task 4, Step 1)
- Modify: `lib/supabase/save-menu-item.ts`
- Modify: `lib/supabase/save-menu-item.test.ts`

**Interfaces:**
- Consumes: `MenuItem.categoryIds` (Task 4).
- Produces: `setItemCategories(supabase, itemId: string, categoryIds:
  string[]): Promise<void>` in `menu-admin.ts`. `MenuItemInput` gains
  `categoryIds: string[]` (replacing `categoryId: string`) — `toRow()`
  no longer writes it as a column (there is no `category_id` column
  left on `menu_items` after Task 3); `saveMenuItem()` calls
  `setItemCategories` explicitly, the same way it already calls
  `setItemModifierGroups`/`setItemSizes`.

- [x] **Step 1: Finish the `createMenuItem` test (from Task 4, deferred here)**

In `lib/supabase/menu-data.test.ts`, in the `createMenuItem` test (around
line 143), remove `category_id: "cat-1",` from the expected
`insertSpy`-called-with object — `menu_items` no longer has that column.

- [x] **Step 2: Write the failing test for `setItemCategories`**

Add to `lib/supabase/menu-data.test.ts`, right after the `setItemSizes`
describe block (after line 323):

```ts
describe("setItemCategories", () => {
  it("deletes existing links then inserts one row per category id", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemCategories(supabase, "item-1", ["cat-a", "cat-b"])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", category_id: "cat-a" },
      { menu_item_id: "item-1", category_id: "cat-b" },
    ])
  })

  it("skips the insert call when categoryIds is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemCategories(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
```

And add `setItemCategories` to the top-of-file import (line 8-10 area,
alongside `setItemModifierGroups`/`setItemSizes`):

```ts
import { setItemCategories } from "./menu-data"
```

- [x] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: FAIL — `setItemCategories is not a function` (or import error).

- [x] **Step 4: Implement `setItemCategories` in `menu-admin.ts`**

In `lib/supabase/menu-admin.ts`:

Replace the `MenuItemInput` type (lines 48-60) — change `categoryId:
string` to `categoryIds: string[]`:

```ts
export type MenuItemInput = {
  categoryIds: string[]
  nameVi: string
  nameEn: string
  descriptionVi: string
  descriptionEn: string
  basePrice: number
  icon: MenuIcon
  isAvailable: boolean
  isPopular: boolean
  imageUrl?: string | null
  hasSizeOptions: boolean
}
```

Replace `toRow()` (lines 62-76) — drop `category_id: input.categoryId,`
entirely (there's no such column left on `menu_items`):

```ts
function toRow(input: MenuItemInput) {
  return {
    name_vi: input.nameVi,
    name_en: input.nameEn,
    description_vi: input.descriptionVi,
    description_en: input.descriptionEn,
    base_price: input.basePrice,
    icon: input.icon,
    is_available: input.isAvailable,
    is_popular: input.isPopular,
    image_url: input.imageUrl ?? null,
    has_size_options: input.hasSizeOptions,
  }
}
```

Add `setItemCategories`, right after `setItemModifierGroups` (after line
225), following that function's exact shape:

```ts
export async function setItemCategories(
  supabase: SupabaseClient,
  itemId: string,
  categoryIds: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("menu_item_categories")
    .delete()
    .eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (categoryIds.length === 0) return

  const { error: insertError } = await supabase
    .from("menu_item_categories")
    .insert(categoryIds.map((categoryId) => ({ menu_item_id: itemId, category_id: categoryId })))
  if (insertError) throw insertError
}
```

Update the comment above `deleteCategory` (lines 35-37), which currently
names the old constraint:

```ts
// Blocked at the DB level by menu_item_categories_category_id_fkey (ON
// DELETE RESTRICT) whenever a menu item still references this category
// -- callers must catch and show a friendly error rather than a raw FK
// violation.
```

- [x] **Step 5: Export `setItemCategories` from the barrel**

In `lib/supabase/menu-data.ts`, add `setItemCategories` to the
`export { ... } from "./menu-admin"` list (alongside
`setItemModifierGroups`/`setItemSizes`).

- [x] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: PASS, all of `getMenuItems`/`createMenuItem`/`setItemCategories`.

- [x] **Step 7: Update `save-menu-item.ts`**

In `lib/supabase/save-menu-item.ts`, import `setItemCategories`
alongside the other imports (line 2), and call it in `saveMenuItem`
right after the modifier-groups call:

```ts
import { createMenuItem, updateMenuItem, setItemModifierGroups, setItemCategories, setItemSizes, getMenuItemById } from "./menu-data"
```

```ts
  await setItemModifierGroups(supabase, saved.id, input.extraGroupIds)
  await setItemCategories(supabase, saved.id, input.item.categoryIds)
  await setMenuItemIngredients(supabase, saved.id, input.recipeEntries)
```

- [x] **Step 8: Update `save-menu-item.test.ts`**

Add `setItemCategories: vi.fn()` to the `vi.mock("./menu-data", ...)`
block (line 4-10), add it to the import list (line 16), replace
`categoryId: "cat-1"` with `categoryIds: ["cat-1"]` in both `ITEM_INPUT`
(line 23) and `SAVED_ITEM` (line 37), and add an assertion in the first
`it` block (after the existing `setItemModifierGroups` assertion at line
73):

```ts
    expect(setItemCategories).toHaveBeenCalledWith(supabase, "item-1", ["cat-1"])
```

- [x] **Step 9: Run the full test suite for this slice**

Run: `npx vitest run lib/supabase/menu-data.test.ts lib/supabase/save-menu-item.test.ts lib/supabase/menu-admin.test.ts`
Expected: PASS across all three files.

- [x] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in the UI files not yet updated (Tasks 6-8) —
confirm the errors are all `categoryId` vs `categoryIds` mismatches in
`components/admin/menu-management.tsx`, `components/admin/menu-item-form.tsx`,
`components/staff/pos-terminal.tsx`, `components/customer/menu-browser.tsx`.

- [x] **Step 11: Commit**

```bash
git add lib/supabase/menu-admin.ts lib/supabase/menu-data.ts lib/supabase/menu-data.test.ts lib/supabase/save-menu-item.ts lib/supabase/save-menu-item.test.ts
git commit -m "$(cat <<'EOF'
Wire setItemCategories into menu item create/update

MenuItemInput.categoryIds replaces categoryId; saveMenuItem() sets the
item's categories the same way it already sets modifier groups and
sizes. Query-layer half of the multi-category change is now complete;
UI consumers (admin form/list, POS, customer Menu) follow next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 6: POS and customer Menu browser — membership instead of equality

**Files:**
- Modify: `components/staff/pos-terminal.tsx:83`
- Modify: `components/customer/menu-browser.tsx:56`

**Interfaces:**
- Consumes: `MenuItem.categoryIds` (Task 4). No UI/state changes in
  either file — both keep their existing single-active-tab
  `selectedCategory: string` state untouched; only the match check
  changes so an item showing under more than one category appears under
  each of its tabs.

- [x] **Step 1: Update `pos-terminal.tsx`**

Line 83, replace:
```ts
      const matchesCategory = item.categoryId === selectedCategory
```
with:
```ts
      const matchesCategory = item.categoryIds.includes(selectedCategory)
```

- [x] **Step 2: Update `menu-browser.tsx`**

Line 56, replace:
```ts
      const matchesCategory = selectedCategory === ALL_CATEGORY || item.categoryId === selectedCategory
```
with:
```ts
      const matchesCategory = selectedCategory === ALL_CATEGORY || item.categoryIds.includes(selectedCategory)
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors remaining in these two files.

- [x] **Step 4: Commit**

```bash
git add components/staff/pos-terminal.tsx components/customer/menu-browser.tsx
git commit -m "$(cat <<'EOF'
POS and customer Menu browser match items by category membership

An item can now belong to more than one category (previous commits);
both surfaces keep their existing single-active-tab filter UI, only
the match check changes from equality to array membership so a
multi-category item shows up under each of its tabs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 7: Admin Menu Management — multi-select category filter

**Files:**
- Modify: `components/admin/menu-management.tsx`
- Modify: `messages/vi.json` (`AdminMenu` namespace)
- Modify: `messages/en.json` (`AdminMenu` namespace)

**Interfaces:**
- Consumes: `MenuItem.categoryIds` (Task 4).
- Produces: nothing consumed elsewhere — this is the leaf UI for the
  admin list/filter.

- [x] **Step 1: Add the new i18n key**

`messages/vi.json`, in `"AdminMenu"` (next to `"allCategories"`):
```json
    "filteringCategoriesCount": "Đang lọc {count} danh mục",
```
`messages/en.json`:
```json
    "filteringCategoriesCount": "Filtering {count} categories",
```

- [x] **Step 2: Add the `Check` icon import**

Line 6, add `Check` to the existing lucide import:
```ts
import { Coffee, CupSoda, Cookie, Milk, Search, Plus, Pencil, Trash2, Check } from "lucide-react"
```

- [x] **Step 3: Replace `selectedCategory` state with an array**

Line 53, replace:
```ts
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
```
with:
```ts
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
```

- [x] **Step 4: Update `itemCountByCategory` to count array membership**

Lines 69-73, replace:
```ts
  const itemCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) counts[item.categoryId] = (counts[item.categoryId] ?? 0) + 1
    return counts
  }, [items])
```
with:
```ts
  const itemCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      for (const categoryId of item.categoryIds) counts[categoryId] = (counts[categoryId] ?? 0) + 1
    }
    return counts
  }, [items])
```

- [x] **Step 5: Update `visibleItems` to match any selected category**

Lines 75-83, replace the `matchesCategory` line:
```ts
      const matchesCategory = !selectedCategory || item.categoryId === selectedCategory
```
with:
```ts
      const matchesCategory =
        selectedCategoryIds.length === 0 || item.categoryIds.some((id) => selectedCategoryIds.includes(id))
```
and update the `useMemo` dependency array from `[items, selectedCategory,
searchQuery]` to `[items, selectedCategoryIds, searchQuery]`.

- [x] **Step 6: Replace the category filter chip row with multi-select toggles**

Replace the whole block from `<div className="-mx-4 flex gap-2 ...">`
(line 211) through its closing `</div>` (line 245) with:

```tsx
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          type="button"
          onClick={() => {
            setSelectedCategoryIds([])
            setCurrentPage(1)
          }}
          className={cn(
            "nb-border-sm nb-shadow-sm nb-press-sm shrink-0 rounded-lg px-3 py-1.5 text-sm font-extrabold",
            selectedCategoryIds.length === 0
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground"
          )}
        >
          {t("allCategories")}
        </button>
        {categoryList.map((category) => {
          const isOn = selectedCategoryIds.includes(category.id)
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                setSelectedCategoryIds((prev) =>
                  isOn ? prev.filter((id) => id !== category.id) : [...prev, category.id]
                )
                setCurrentPage(1)
              }}
              className={cn(
                "nb-border-sm nb-shadow-sm nb-press-sm flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold",
                isOn ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              )}
            >
              {isOn && <Check className="h-3.5 w-3.5" />}
              {locale === "vi" ? category.nameVi : category.nameEn}
            </button>
          )
        })}
      </div>
      {selectedCategoryIds.length > 1 && (
        <p className="text-xs font-semibold text-muted-foreground">
          {t("filteringCategoriesCount", { count: selectedCategoryIds.length })}
        </p>
      )}
```

- [x] **Step 7: Show every category badge per item, not just one**

In the mobile card (lines 285-288), replace:
```tsx
                <span className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}>
                  {categoryLabel(item.categoryId)}
                </span>
```
with:
```tsx
                <div className="flex flex-wrap gap-1">
                  {item.categoryIds.map((categoryId) => (
                    <span
                      key={categoryId}
                      className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}
                    >
                      {categoryLabel(categoryId)}
                    </span>
                  ))}
                </div>
```

In the desktop table (lines 418-422), replace the same single-badge
`<td>` body:
```tsx
                    <span className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}>
                      {categoryLabel(item.categoryId)}
                    </span>
```
with:
```tsx
                    <div className="flex flex-wrap gap-1">
                      {item.categoryIds.map((categoryId) => (
                        <span
                          key={categoryId}
                          className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}
                        >
                          {categoryLabel(categoryId)}
                        </span>
                      ))}
                    </div>
```

- [x] **Step 8: Update `toggleAvailability`'s `updateMenuItem` call**

Lines 90-110 call `updateMenuItem` with an explicit field list that
still has `categoryId: item.categoryId,` (line 94) — replace with
`categoryIds: item.categoryIds,` (this call otherwise round-trips every
other field unchanged, matching the existing pattern of "send back
everything, flip one flag").

- [x] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in this file. Errors may remain in
`menu-item-form.tsx` until Task 8 — that's expected.

- [x] **Step 10: Manual verification**

Since there's no existing test file for `menu-management.tsx` (it's a
`"use client"` component with no dedicated Vitest suite in this repo per
the earlier audit), verify manually against the deployed app per this
project's convention: `git push`, then on `https://phadincafe.vercel.app`
sign in as manager/admin, open `/admin/menu`, select two category chips
at once, confirm the item list shows items from either category and the
"Filtering 2 categories" hint appears, confirm an item card shows all of
its category badges.

- [x] **Step 11: Commit**

```bash
git add components/admin/menu-management.tsx messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Admin Menu Management: multi-select category filter

Category filter chips now toggle independently (checkmark when
active) instead of single-select, matching the reference design.
Items show every category they belong to, not just one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Task 8: Admin item form — multi-select category picker

**Files:**
- Modify: `components/admin/menu-item-form.tsx`

**Interfaces:**
- Consumes: `MenuItem.categoryIds`, `MenuItemInput.categoryIds` (Tasks 4-5).
- Produces: nothing consumed elsewhere — leaf UI.

- [x] **Step 1: Add the `Check` icon import**

Line 6, add `Check`:
```ts
import { UploadCloud, X, Plus, Pencil, ChevronUp, ChevronDown, Check } from "lucide-react"
```

- [x] **Step 2: Add the i18n hint key**

`messages/vi.json`, in `"AdminMenu"` (next to `"categoryLabel"`):
```json
    "multiCategoryHint": "chọn nhiều được",
```
`messages/en.json`:
```json
    "multiCategoryHint": "pick more than one",
```

- [x] **Step 3: Replace the `categoryId` state**

Line 46, replace:
```ts
  const [categoryId, setCategoryId] = useState(initialItem?.categoryId ?? categories[0]?.id ?? "")
```
with:
```ts
  const [categoryIds, setCategoryIds] = useState<string[]>(
    initialItem?.categoryIds ?? (categories[0] ? [categories[0].id] : [])
  )
```

- [x] **Step 4: Update the required-fields validation**

Line 249, replace:
```ts
    if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
```
with:
```ts
    if (!nameVi.trim() || !nameEn.trim() || categoryIds.length === 0 || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
```

- [x] **Step 5: Update the `onSave` payload**

Line 302 (`categoryId,` inside the object literal passed to `onSave`),
replace with `categoryIds,`.

- [x] **Step 6: Replace the category `<select>` with a chip picker**

Replace the whole `<div className="space-y-1.5">` block containing the
category `<select>` (lines 352-366) with:

```tsx
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-xs font-medium text-muted-foreground">{t("categoryLabel")}</label>
            <span className="text-[11px] font-medium text-muted-foreground">{t("multiCategoryHint")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const isOn = categoryIds.includes(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setCategoryIds((prev) =>
                      isOn ? prev.filter((id) => id !== category.id) : [...prev, category.id]
                    )
                  }
                  className={cn(
                    "nb-border-sm flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors",
                    isOn ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground"
                  )}
                >
                  {isOn && <Check className="h-3.5 w-3.5" />}
                  {category.nameVi} / {category.nameEn}
                </button>
              )
            })}
          </div>
        </div>
```

Note this block moves from being one half of a two-column
`grid-cols-2` row (previously paired with the price field) to spanning
both columns (`sm:col-span-2`) since a chip row needs more horizontal
room than a `<select>` did — the price field's own `<div>` (the second
child of that `grid` at lines 352/367) stays where it is, now alone in
its row on `sm` and up, stacking below the category picker on mobile
(unchanged, since the parent `grid-cols-1 sm:grid-cols-2` already
stacks on mobile).

- [x] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean across the whole project now — this was the last file
with a `categoryId` reference.

- [x] **Step 8: Manual verification**

On the deployed app, open the Add/Edit Item form, confirm: selecting
zero categories and saving shows the existing required-fields error
message; toggling two category chips on then saving persists both (open
Edit again on the same item, confirm both chips still show checked).

- [x] **Step 9: Commit**

```bash
git add components/admin/menu-item-form.tsx messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Admin item form: multi-select category picker replaces single dropdown

An item can now be tagged with more than one category. Matches the
reference design's toggle-chip picker with a "pick more than one"
hint; validation requires at least one category, same as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LbMtifwkG7F5RnPX4x67WW
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage**: Decisions 1-7 in the design doc each map to a task
  above (Decision 4/5 required no task — confirmed no code change
  needed beyond the comment update folded into Task 5 Step 4).
- **Placeholder scan**: no TBD/"add error handling"/"similar to Task N"
  found — every step has literal code.
- **Type consistency**: `categoryIds: string[]` is the one name used
  everywhere (`MenuItem`, `MenuItemInput`, component state) — no
  `categoryId`/`categoryIds` mismatch across tasks. `setItemCategories`
  matches `setItemModifierGroups`'s exact signature shape
  `(supabase, itemId, ids[])`.
