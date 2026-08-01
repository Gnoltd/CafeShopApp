# Menu Item Sizes Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin add/edit/remove/reorder a menu item's sizes (each with its own name and price) from the Menu Management item editor — today `menu_item_sizes` rows can only be changed via direct SQL.

**Architecture:** One migration adds `sort_order` to the already-per-item `menu_item_sizes` table (no other schema change needed). A new `setItemSizes` query-layer function bulk-replaces an item's sizes (delete-then-insert, mirroring the existing `setItemModifierGroups` pattern exactly). A new always-editable "Sizes" list in `menu-item-form.tsx` (rows: name, price, up/down reorder, remove) feeds into the existing save sequence in `menu-management.tsx`.

**Tech Stack:** Supabase/Postgres, Next.js client components, Vitest, next-intl.

## Global Constraints

- Migration file `supabase/migrations/0033_menu_item_sizes_sort_order.sql`, applied live via `mcp__supabase__apply_migration` (name: `menu_item_sizes_sort_order`).
- New strings in **both** `messages/en.json` and `messages/vi.json`, in the `AdminMenu` namespace.
- No change to `hasSizeOptions`'s own meaning/behavior — it stays the independent on/off toggle it already is.
- Verify against `https://phadincafe.vercel.app`, not just `next build`.

---

### Task 1: Migration — `sort_order` column

**Files:**
- Create: `supabase/migrations/0033_menu_item_sizes_sort_order.sql`

**Interfaces:**
- Produces: `menu_item_sizes.sort_order` (`integer not null default 0`). Task 2's query layer selects and orders by this column.

- [ ] **Step 1: Write the migration**

```sql
-- 0033_menu_item_sizes_sort_order.sql
-- Lets the admin Sizes editor (see docs/superpowers/specs/2026-07-10-menu-item-sizes-editor-design.md)
-- control display order. Existing seeded rows all default to 0 (no prior
-- ordering signal exists to backfill from) -- self-heals the next time
-- an item's sizes are edited through the new UI.

alter table public.menu_item_sizes add column sort_order integer not null default 0;
```

- [ ] **Step 2: Apply live**

Call `mcp__supabase__apply_migration` with name `menu_item_sizes_sort_order` and the SQL above. Expected `{"success":true}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0033_menu_item_sizes_sort_order.sql
git commit -m "Add sort_order to menu_item_sizes"
```

---

### Task 2: Query layer — `sortOrder` + `setItemSizes` (TDD)

**Files:**
- Modify: `lib/supabase/menu-data.ts`
- Test: `lib/supabase/menu-data.test.ts`

**Interfaces:**
- Consumes: `menu_item_sizes.sort_order` (Task 1).
- Produces: `MenuItemSize.sortOrder: number`; `MenuItemSizeInput = { name: string; priceDelta: number }`; `setItemSizes(supabase: SupabaseClient, itemId: string, sizes: MenuItemSizeInput[]): Promise<void>`. Task 3 imports `MenuItemSizeInput`; Task 4 imports `setItemSizes` and `MenuItemSizeInput`.

- [ ] **Step 1: Update the existing `getMenuItems` test to expect `sortOrder` and a foreign-table order call**

In `lib/supabase/menu-data.test.ts`, replace the `describe("getMenuItems", ...)` block (lines 33-100):

```ts
describe("getMenuItems", () => {
  it("flattens nested sizes and modifier groups into camelCase", async () => {
    const row = {
      id: "item-1",
      category_id: "cat-1",
      name_vi: "Phin Sữa Đá",
      name_en: "Iced Milk Coffee",
      description_vi: "mô tả",
      description_en: "description",
      base_price: 29000,
      icon: "coffee",
      is_available: true,
      is_popular: true,
      image_url: null,
      has_size_options: true,
      menu_item_sizes: [{ id: "size-1", name: "M", price_delta: 0, sort_order: 0 }],
      menu_item_modifier_groups: [
        {
          modifier_groups: {
            id: "grp-1",
            name_vi: "Lựa Chọn Sữa",
            name_en: "Milk Options",
            is_required: true,
            modifiers: [
              { id: "mod-1", name_vi: "Sữa Đặc", name_en: "Condensed Milk", price_delta: 0 },
            ],
          },
        },
      ],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: [row], error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getMenuItems(supabase)

    expect(result).toEqual([
      {
        id: "item-1",
        categoryId: "cat-1",
        nameVi: "Phin Sữa Đá",
        nameEn: "Iced Milk Coffee",
        descriptionVi: "mô tả",
        descriptionEn: "description",
        basePrice: 29000,
        icon: "coffee",
        isAvailable: true,
        isPopular: true,
        imageUrl: null,
        hasSizeOptions: true,
        sizes: [{ id: "size-1", name: "M", priceDelta: 0, sortOrder: 0 }],
        modifierGroups: [
          {
            id: "grp-1",
            nameVi: "Lựa Chọn Sữa",
            nameEn: "Milk Options",
            required: true,
            options: [{ id: "mod-1", nameVi: "Sữa Đặc", nameEn: "Condensed Milk", priceDelta: 0 }],
          },
        ],
      },
    ])
  })
})
```

- [ ] **Step 2: Add `setItemSizes` tests**

Add `setItemSizes` to the existing import list from `./menu-data` at the top of the file (alongside `setItemModifierGroups`), and append this new `describe` block after the existing `describe("setItemModifierGroups", ...)` block:

```ts
describe("setItemSizes", () => {
  it("deletes existing sizes then inserts the new set with sort_order matching array index", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemSizes(supabase, "item-1", [
      { name: "M", priceDelta: 0 },
      { name: "L", priceDelta: 8000 },
    ])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", name: "M", price_delta: 0, sort_order: 0 },
      { menu_item_id: "item-1", name: "L", price_delta: 8000, sort_order: 1 },
    ])
  })

  it("skips the insert call when sizes is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemSizes(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: FAIL — `getMenuItems` test fails (no `sortOrder` in output, mock chain mismatch since real code only calls `.order()` once); `setItemSizes` tests fail with "setItemSizes is not a function" / import error.

- [ ] **Step 4: Implement — type, select, mapping, ordering**

In `lib/supabase/menu-data.ts`, change the `MenuItemSize` type:

```ts
export type MenuItemSize = {
  id: string
  name: string
  priceDelta: number
  sortOrder: number
}
```

Add a new type right after it:

```ts
export type MenuItemSizeInput = {
  name: string
  priceDelta: number
}
```

Change `MENU_ITEM_SELECT`'s embedded sizes selection:

```ts
  menu_item_sizes ( id, name, price_delta ),
```

to:

```ts
  menu_item_sizes ( id, name, price_delta, sort_order ),
```

Change `SizeRow`:

```ts
type SizeRow = {
  id: string
  name: string
  price_delta: number
}
```

to:

```ts
type SizeRow = {
  id: string
  name: string
  price_delta: number
  sort_order: number
}
```

In `mapMenuItemRow`, change the sizes mapping:

```ts
    sizes: (row.menu_item_sizes ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      priceDelta: s.price_delta,
    })),
```

to:

```ts
    sizes: (row.menu_item_sizes ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      priceDelta: s.price_delta,
      sortOrder: s.sort_order,
    })),
```

Change `getMenuItems`:

```ts
export async function getMenuItems(supabase: SupabaseClient): Promise<MenuItem[]> {
  const { data, error } = await supabase.from("menu_items").select(MENU_ITEM_SELECT).order("name_en")
  if (error) throw error
  return ((data ?? []) as unknown as MenuItemRow[]).map(mapMenuItemRow)
}
```

to:

```ts
export async function getMenuItems(supabase: SupabaseClient): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .order("name_en")
    .order("sort_order", { foreignTable: "menu_item_sizes" })
  if (error) throw error
  return ((data ?? []) as unknown as MenuItemRow[]).map(mapMenuItemRow)
}
```

Change `getMenuItemById`:

```ts
export async function getMenuItemById(supabase: SupabaseClient, id: string): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return data ? mapMenuItemRow(data as unknown as MenuItemRow) : null
}
```

to:

```ts
export async function getMenuItemById(supabase: SupabaseClient, id: string): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .eq("id", id)
    .order("sort_order", { foreignTable: "menu_item_sizes" })
    .maybeSingle()
  if (error) throw error
  return data ? mapMenuItemRow(data as unknown as MenuItemRow) : null
}
```

- [ ] **Step 5: Implement — `setItemSizes`**

Add at the end of `lib/supabase/menu-data.ts` (after `setItemModifierGroups`):

```ts
export async function setItemSizes(
  supabase: SupabaseClient,
  itemId: string,
  sizes: MenuItemSizeInput[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("menu_item_sizes").delete().eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (sizes.length === 0) return

  const { error: insertError } = await supabase.from("menu_item_sizes").insert(
    sizes.map((size, index) => ({
      menu_item_id: itemId,
      name: size.name,
      price_delta: size.priceDelta,
      sort_order: index,
    }))
  )
  if (insertError) throw insertError
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/menu-data.ts lib/supabase/menu-data.test.ts
git commit -m "Add sortOrder to MenuItemSize, setItemSizes bulk-replace function"
```

---

### Task 3: Admin UI — Sizes editor in `menu-item-form.tsx`

**Files:**
- Modify: `components/admin/menu-item-form.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`AdminMenu` namespace)

**Interfaces:**
- Consumes: `MenuItemSizeInput` type (Task 2).
- Produces: `onSave` callback prop gains a 4th parameter `sizes: MenuItemSizeInput[]`. Task 4's `menu-management.tsx` consumes this.

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`, in the `AdminMenu` namespace, change:

```json
    "hasSizeOptionsToggle": "Has size options",
    "extrasLabel": "Extras",
```

to:

```json
    "hasSizeOptionsToggle": "Has size options",
    "sizesLabel": "Sizes",
    "noSizesYet": "No sizes yet.",
    "sizeNamePlaceholder": "e.g. M",
    "moveSizeUp": "Move up",
    "moveSizeDown": "Move down",
    "removeSize": "Remove size",
    "addSize": "Add Size",
    "sizeRequiredFieldsError": "Each size needs a name and a valid price.",
    "extrasLabel": "Extras",
```

In `messages/vi.json`, in the `AdminMenu` namespace, change:

```json
    "hasSizeOptionsToggle": "Có Tùy Chọn Kích Cỡ",
    "extrasLabel": "Tùy Chọn Thêm",
```

to:

```json
    "hasSizeOptionsToggle": "Có Tùy Chọn Kích Cỡ",
    "sizesLabel": "Kích Cỡ",
    "noSizesYet": "Chưa có kích cỡ nào.",
    "sizeNamePlaceholder": "VD: M",
    "moveSizeUp": "Di chuyển lên",
    "moveSizeDown": "Di chuyển xuống",
    "removeSize": "Xóa kích cỡ",
    "addSize": "Thêm Kích Cỡ",
    "sizeRequiredFieldsError": "Mỗi kích cỡ cần có tên và giá hợp lệ.",
    "extrasLabel": "Tùy Chọn Thêm",
```

- [ ] **Step 2: Add `ChevronUp`/`ChevronDown` to the lucide-react import**

In `components/admin/menu-item-form.tsx` line 5, change:

```tsx
import { UploadCloud, X, Plus, Pencil } from "lucide-react"
```

to:

```tsx
import { UploadCloud, X, Plus, Pencil, ChevronUp, ChevronDown } from "lucide-react"
```

- [ ] **Step 3: Import `MenuItemSizeInput`**

Line 12, change:

```tsx
import type { MenuCategory, MenuIcon, MenuItem, MenuItemInput, MenuModifierGroup } from "@/lib/supabase/menu-data"
```

to:

```tsx
import type { MenuCategory, MenuIcon, MenuItem, MenuItemInput, MenuItemSizeInput, MenuModifierGroup } from "@/lib/supabase/menu-data"
```

- [ ] **Step 4: Change the `onSave` prop type**

Line 35, change:

```tsx
  onSave: (input: MenuItemInput, extraGroupIds: string[], recipeEntries: RecipeEntry[]) => void
```

to:

```tsx
  onSave: (input: MenuItemInput, extraGroupIds: string[], recipeEntries: RecipeEntry[], sizes: MenuItemSizeInput[]) => void
```

- [ ] **Step 5: Add sizes state and handlers**

Right after line 61 (`const [isUploading, setIsUploading] = useState(false)`), add:

```tsx
  const [sizes, setSizes] = useState<{ name: string; price: string }[]>(
    initialItem?.sizes.map((s) => ({ name: s.name, price: String(s.priceDelta) })) ?? []
  )
  const [sizesError, setSizesError] = useState<string | null>(null)

  function addSize() {
    setSizes((prev) => [...prev, { name: "", price: "0" }])
  }

  function updateSizeName(index: number, name: string) {
    setSizes((prev) => prev.map((s, i) => (i === index ? { ...s, name } : s)))
  }

  function updateSizePrice(index: number, price: string) {
    setSizes((prev) => prev.map((s, i) => (i === index ? { ...s, price } : s)))
  }

  function removeSize(index: number) {
    setSizes((prev) => prev.filter((_, i) => i !== index))
  }

  function moveSize(index: number, direction: -1 | 1) {
    setSizes((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
```

- [ ] **Step 6: Validate sizes and pass them through `onSave`**

In `handleSave`, change:

```tsx
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setRecipeError(t("recipeQuantityRequiredError"))
      return
    }
    setRecipeError(null)

    // imagePreviewUrl is a blob: URL only when imageFile is also set (see
```

to:

```tsx
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setRecipeError(t("recipeQuantityRequiredError"))
      return
    }
    setRecipeError(null)

    if (sizes.some((s) => !s.name.trim())) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    const parsedSizes: MenuItemSizeInput[] = sizes.map((s) => ({ name: s.name.trim(), priceDelta: Number(s.price) }))
    if (parsedSizes.some((s) => !Number.isFinite(s.priceDelta) || s.priceDelta < 0)) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    setSizesError(null)

    // imagePreviewUrl is a blob: URL only when imageFile is also set (see
```

Then change the final `onSave(...)` call:

```tsx
    onSave(
      {
        categoryId,
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim(),
        descriptionVi: descriptionVi.trim(),
        descriptionEn: descriptionEn.trim(),
        basePrice: parsedPrice,
        icon,
        isAvailable,
        isPopular,
        hasSizeOptions,
        imageUrl: finalImageUrl,
      },
      selectedExtraIds,
      recipeEntries
    )
```

to:

```tsx
    onSave(
      {
        categoryId,
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim(),
        descriptionVi: descriptionVi.trim(),
        descriptionEn: descriptionEn.trim(),
        basePrice: parsedPrice,
        icon,
        isAvailable,
        isPopular,
        hasSizeOptions,
        imageUrl: finalImageUrl,
      },
      selectedExtraIds,
      recipeEntries,
      parsedSizes
    )
```

- [ ] **Step 7: Add the Sizes section to the JSX**

Change:

```tsx
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  hasSizeOptions ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("extrasLabel")}</label>
```

to:

```tsx
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  hasSizeOptions ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("sizesLabel")}</label>
            {sizesError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{sizesError}</p>
            )}
            <div className="space-y-2 rounded-lg border p-3">
              {sizes.length === 0 && <p className="text-sm text-muted-foreground">{t("noSizesYet")}</p>}
              {sizes.map((size, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={size.name}
                    onChange={(e) => updateSizeName(index, e.target.value)}
                    placeholder={t("sizeNamePlaceholder")}
                    className="h-9 flex-1"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={size.price}
                    onChange={(e) => updateSizePrice(index, e.target.value)}
                    className="h-9 w-28"
                  />
                  <button
                    type="button"
                    onClick={() => moveSize(index, -1)}
                    disabled={index === 0}
                    aria-label={t("moveSizeUp")}
                    title={t("moveSizeUp")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSize(index, 1)}
                    disabled={index === sizes.length - 1}
                    aria-label={t("moveSizeDown")}
                    title={t("moveSizeDown")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSize(index)}
                    aria-label={t("removeSize")}
                    title={t("removeSize")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addSize}>
              <Plus className="h-4 w-4" />
              {t("addSize")}
            </Button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("extrasLabel")}</label>
```

- [ ] **Step 8: Build to catch type errors**

Run: `npm run build`
Expected: fails (expected at this point — `menu-management.tsx` still calls the old 3-argument `onSave` shape; this will be fixed in Task 4). Confirm the *only* error is the `onSave` call-site arity mismatch in `menu-management.tsx`, not something in `menu-item-form.tsx` itself.

- [ ] **Step 9: Commit**

```bash
git add components/admin/menu-item-form.tsx messages/en.json messages/vi.json
git commit -m "Add always-editable Sizes list to the admin item form"
```

---

### Task 4: Wire `menu-management.tsx`

**Files:**
- Modify: `components/admin/menu-management.tsx`

**Interfaces:**
- Consumes: `setItemSizes`, `MenuItemSizeInput` (Task 2); `onSave`'s new 4-argument shape (Task 3).

- [ ] **Step 1: Import `setItemSizes` and `MenuItemSizeInput`**

Lines 11-21, change:

```tsx
import {
  createMenuItem,
  deleteMenuItem,
  getMenuItemById,
  setItemModifierGroups,
  updateMenuItem,
  type MenuCategory,
  type MenuIcon,
  type MenuItem,
  type MenuItemInput,
} from "@/lib/supabase/menu-data"
```

to:

```tsx
import {
  createMenuItem,
  deleteMenuItem,
  getMenuItemById,
  setItemModifierGroups,
  setItemSizes,
  updateMenuItem,
  type MenuCategory,
  type MenuIcon,
  type MenuItem,
  type MenuItemInput,
  type MenuItemSizeInput,
} from "@/lib/supabase/menu-data"
```

- [ ] **Step 2: Extend `saveItem`**

Change:

```tsx
  async function saveItem(
    input: MenuItemInput,
    extraGroupIds: string[],
    recipeEntries: RecipeEntry[],
    editingId: string | null
  ) {
    setError(null)
    try {
      const saved = editingId
        ? await updateMenuItem(supabase, editingId, input)
        : await createMenuItem(supabase, input)
      await setItemModifierGroups(supabase, saved.id, extraGroupIds)
      await setMenuItemIngredients(supabase, saved.id, recipeEntries)
      const refreshed = (await getMenuItemById(supabase, saved.id)) ?? saved
      setItems((prev) =>
        editingId ? prev.map((item) => (item.id === editingId ? refreshed : item)) : [refreshed, ...prev]
      )
      setFormMode(null)
    } catch {
      setError(t("saveError"))
    }
  }
```

to:

```tsx
  async function saveItem(
    input: MenuItemInput,
    extraGroupIds: string[],
    recipeEntries: RecipeEntry[],
    sizes: MenuItemSizeInput[],
    editingId: string | null
  ) {
    setError(null)
    try {
      const saved = editingId
        ? await updateMenuItem(supabase, editingId, input)
        : await createMenuItem(supabase, input)
      await setItemModifierGroups(supabase, saved.id, extraGroupIds)
      await setMenuItemIngredients(supabase, saved.id, recipeEntries)
      await setItemSizes(supabase, saved.id, sizes)
      const refreshed = (await getMenuItemById(supabase, saved.id)) ?? saved
      setItems((prev) =>
        editingId ? prev.map((item) => (item.id === editingId ? refreshed : item)) : [refreshed, ...prev]
      )
      setFormMode(null)
    } catch {
      setError(t("saveError"))
    }
  }
```

- [ ] **Step 3: Update the `<MenuItemForm>` call site**

Change:

```tsx
          onSave={(input, extraGroupIds, recipeEntries) =>
            saveItem(input, extraGroupIds, recipeEntries, formMode?.type === "edit" ? formMode.item.id : null)
          }
```

to:

```tsx
          onSave={(input, extraGroupIds, recipeEntries, sizes) =>
            saveItem(input, extraGroupIds, recipeEntries, sizes, formMode?.type === "edit" ? formMode.item.id : null)
          }
```

- [ ] **Step 4: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/menu-management.tsx
git commit -m "Wire the Sizes editor into menu item save"
```

---

### Task 5: Full verification, deploy, live-verify

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all pass (existing count + 2 new from Task 2).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Live-verify on `https://phadincafe.vercel.app`**

1. As admin, edit an item that currently has no sizes (or add a new item): add two sizes via "Add Size" (e.g. "M" priced 0, "L" priced 8000), save, confirm no error.
2. Reload Menu Management, re-open the same item's edit form: confirm both sizes appear with the correct name/price, in the order added.
3. On the customer side (Product Detail and the quick-add popup for that item, with `hasSizeOptions` on), confirm the size picker shows exactly "M" and "L" (no phantom "S"), with L correctly adding +8.000đ to the price when selected.
4. Back in the admin form, use the down-arrow to reorder L above M, save, reload the form: confirm the new order persisted.
5. Confirm the customer-side size picker now shows L before M, matching the reorder.
6. Remove one size, save, confirm it no longer appears as a customer-side choice.
7. Attempt to save with a blank size name: confirm the error message shows and save is blocked.
8. Confirm `hasSizeOptions` toggle still works independently (turning it off hides the size picker on the customer side regardless of how many size rows exist).

- [ ] **Step 5: `daily.md` — leave as-is unless verification caught a real bug**

Per this project's current convention (`daily.md` trimmed to open work only, see its own header), don't add a shipped-feature narrative entry here. If live verification in Step 4 surfaces a real bug that gets fixed, note it briefly in `daily.md`'s Known gaps only if it's *not* fully fixed before finishing this task.
