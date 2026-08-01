# Menu Item Extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin create reusable, priced "extras" (e.g. "Extra Shot +10.000đ") and attach a subset of them to specific menu items; customers see the price and can independently select any number of them on the Product Detail Page.

**Architecture:** Each extra is its own single-option `modifier_group` (no schema change — reuses the existing `modifier_groups`/`modifiers`/`menu_item_modifier_groups` tables from migration `0003_menu`). Three new functions in `lib/supabase/menu-data.ts` read/write this; the admin Add/Edit Item form gets a new "Extras" checklist + inline creator; the customer Product Detail Page gets a real toggle-off fix so optional extras can be deselected.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/supabase-js`), Vitest, TypeScript, Tailwind v4.

## Global Constraints

- **No DB migration** — this feature is built entirely on existing tables.
- Every new user-facing string gets a key in both `messages/vi.json` and
  `messages/en.json`, in the same commit as the code using it.
- New query-layer functions follow the existing DI'd-`SupabaseClient`
  convention (client passed as first argument, same as `getCategories`/
  `createMenuItem`/etc.) and get unit tests with a fake Supabase client,
  same style as `lib/supabase/menu-data.test.ts`.
- **Out of scope, do not build**: editing an existing extra's name/price,
  deleting an extra from the shared library, any change to multi-option
  groups like "Milk Options".

---

### Task 1: Query layer — `getModifierGroups`, `createModifierGroup`, `setItemModifierGroups`

**Files:**
- Modify: `lib/supabase/menu-data.ts`
- Test: `lib/supabase/menu-data.test.ts`

**Interfaces:**
- Consumes: existing `MenuModifierGroup`/`MenuModifierOption` types and
  the existing `ModifierGroupRow`/`ModifierRow` row types already defined
  in this file — reuse them, don't redefine.
- Produces: `getModifierGroups(supabase: SupabaseClient): Promise<MenuModifierGroup[]>`,
  `type ModifierGroupInput = { nameVi: string; nameEn: string; priceDelta: number }`,
  `createModifierGroup(supabase: SupabaseClient, input: ModifierGroupInput): Promise<MenuModifierGroup>`,
  `setItemModifierGroups(supabase: SupabaseClient, itemId: string, groupIds: string[]): Promise<void>`
  — Tasks 2 and 3 call these by these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Add to `lib/supabase/menu-data.test.ts` (append after the existing
`createMenuItem` describe block):

```ts
describe("getModifierGroups", () => {
  it("maps snake_case DB rows (with nested modifiers) to camelCase MenuModifierGroup", async () => {
    const row = {
      id: "grp-extra-shot",
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      is_required: false,
      modifiers: [{ id: "mod-extra-shot", name_vi: "Thêm Shot", name_en: "Extra Shot", price_delta: 10000 }],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getModifierGroups(supabase)

    expect(result).toEqual([
      {
        id: "grp-extra-shot",
        nameVi: "Thêm Shot",
        nameEn: "Extra Shot",
        required: false,
        options: [{ id: "mod-extra-shot", nameVi: "Thêm Shot", nameEn: "Extra Shot", priceDelta: 10000 }],
      },
    ])
  })
})

describe("createModifierGroup", () => {
  it("inserts a non-required, single-option modifier_group and its one modifier", async () => {
    const groupInsertSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "grp-new", name_vi: "Thêm Shot", name_en: "Extra Shot", is_required: false },
            error: null,
          }),
      }),
    }))
    const modifierInsertSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "mod-new", name_vi: "Thêm Shot", name_en: "Extra Shot", price_delta: 10000 },
            error: null,
          }),
      }),
    }))
    const supabase = {
      from: (table: string) => {
        if (table === "modifier_groups") return { insert: groupInsertSpy }
        if (table === "modifiers") return { insert: modifierInsertSpy }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    const result = await createModifierGroup(supabase, {
      nameVi: "Thêm Shot",
      nameEn: "Extra Shot",
      priceDelta: 10000,
    })

    expect(groupInsertSpy).toHaveBeenCalledWith({
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      is_required: false,
      max_selections: 1,
    })
    expect(modifierInsertSpy).toHaveBeenCalledWith({
      modifier_group_id: "grp-new",
      name_vi: "Thêm Shot",
      name_en: "Extra Shot",
      price_delta: 10000,
    })
    expect(result).toEqual({
      id: "grp-new",
      nameVi: "Thêm Shot",
      nameEn: "Extra Shot",
      required: false,
      options: [{ id: "mod-new", nameVi: "Thêm Shot", nameEn: "Extra Shot", priceDelta: 10000 }],
    })
  })
})

describe("setItemModifierGroups", () => {
  it("deletes existing links then inserts one row per group id", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemModifierGroups(supabase, "item-1", ["grp-a", "grp-b"])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_item_id: "item-1", modifier_group_id: "grp-a" },
      { menu_item_id: "item-1", modifier_group_id: "grp-b" },
    ])
  })

  it("skips the insert call when groupIds is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({
        delete: () => ({ eq: deleteEqSpy }),
        insert: insertSpy,
      }),
    } as unknown as SupabaseClient

    await setItemModifierGroups(supabase, "item-1", [])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
```

Also add the three new imports to the top of the test file, alongside
the existing ones:

```ts
import { getModifierGroups } from "./menu-data"
import { createModifierGroup } from "./menu-data"
import { setItemModifierGroups } from "./menu-data"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: FAIL — `getModifierGroups`/`createModifierGroup`/`setItemModifierGroups` are not exported from `./menu-data` yet.

- [ ] **Step 3: Implement the three functions**

In `lib/supabase/menu-data.ts`, add after the existing `deleteMenuItem` function:

```ts
export async function getModifierGroups(supabase: SupabaseClient): Promise<MenuModifierGroup[]> {
  const { data, error } = await supabase
    .from("modifier_groups")
    .select("id, name_vi, name_en, is_required, modifiers ( id, name_vi, name_en, price_delta )")
    .order("name_en")
  if (error) throw error
  return ((data ?? []) as unknown as ModifierGroupRow[]).map((row) => ({
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    required: row.is_required,
    options: (row.modifiers ?? []).map((m) => ({
      id: m.id,
      nameVi: m.name_vi,
      nameEn: m.name_en,
      priceDelta: m.price_delta,
    })),
  }))
}

export type ModifierGroupInput = {
  nameVi: string
  nameEn: string
  priceDelta: number
}

export async function createModifierGroup(
  supabase: SupabaseClient,
  input: ModifierGroupInput
): Promise<MenuModifierGroup> {
  const { data: groupRow, error: groupError } = await supabase
    .from("modifier_groups")
    .insert({ name_vi: input.nameVi, name_en: input.nameEn, is_required: false, max_selections: 1 })
    .select("id, name_vi, name_en, is_required")
    .single()
  if (groupError) throw groupError

  const { data: modifierRow, error: modifierError } = await supabase
    .from("modifiers")
    .insert({
      modifier_group_id: groupRow.id,
      name_vi: input.nameVi,
      name_en: input.nameEn,
      price_delta: input.priceDelta,
    })
    .select("id, name_vi, name_en, price_delta")
    .single()
  if (modifierError) throw modifierError

  return {
    id: groupRow.id,
    nameVi: groupRow.name_vi,
    nameEn: groupRow.name_en,
    required: groupRow.is_required,
    options: [
      {
        id: modifierRow.id,
        nameVi: modifierRow.name_vi,
        nameEn: modifierRow.name_en,
        priceDelta: modifierRow.price_delta,
      },
    ],
  }
}

export async function setItemModifierGroups(
  supabase: SupabaseClient,
  itemId: string,
  groupIds: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("menu_item_modifier_groups")
    .delete()
    .eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (groupIds.length === 0) return

  const { error: insertError } = await supabase
    .from("menu_item_modifier_groups")
    .insert(groupIds.map((groupId) => ({ menu_item_id: itemId, modifier_group_id: groupId })))
  if (insertError) throw insertError
}
```

(`ModifierGroupRow` is the existing type already defined earlier in this
file for `getMenuItems`'s nested read — reuse it, don't redefine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: PASS, all tests (existing + 4 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/menu-data.ts lib/supabase/menu-data.test.ts
git commit -m "$(cat <<'EOF'
Add query-layer functions for menu item extras

getModifierGroups/createModifierGroup/setItemModifierGroups, DI'd
against a SupabaseClient like the rest of menu-data.ts. Each "extra" is
its own single-option modifier_group -- no schema change needed, reuses
the existing modifier_groups/modifiers/menu_item_modifier_groups tables.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Admin form — Extras section in `menu-item-form.tsx`

**Files:**
- Modify: `components/admin/menu-item-form.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `getModifierGroups`, `createModifierGroup`, `type ModifierGroupInput`,
  `type MenuModifierGroup` (Task 1); `createClient` from `@/lib/supabase/client`
  (existing); `formatVND` from `@/lib/format` (existing).
- Produces: `MenuItemForm`'s `onSave` prop type changes from
  `(input: MenuItemInput) => void` to `(input: MenuItemInput, extraGroupIds: string[]) => void`
  — Task 3's call site must match this new signature.

- [ ] **Step 1: Add the new `AdminMenu` translation keys**

In `messages/vi.json`, inside the existing `"AdminMenu"` object, add
(after `"popularToggle"`):

```json
"extrasLabel": "Tùy Chọn Thêm",
"noExtrasYet": "Chưa có tùy chọn thêm nào.",
"addNewExtra": "+ Thêm Tùy Chọn Mới",
"extraNameViPlaceholder": "Tên (Tiếng Việt)",
"extraNameEnPlaceholder": "Tên (English)",
"extraPricePlaceholder": "Giá thêm (VNĐ)",
"confirmAddExtra": "Thêm",
"extraRequiredFieldsError": "Vui lòng nhập đầy đủ tên và giá cho tùy chọn thêm.",
"extraSaveError": "Không thể lưu tùy chọn thêm. Vui lòng thử lại."
```

In `messages/en.json`, inside the existing `"AdminMenu"` object, add
(after `"popularToggle"`):

```json
"extrasLabel": "Extras",
"noExtrasYet": "No extras yet.",
"addNewExtra": "+ Add New Extra",
"extraNameViPlaceholder": "Name (Vietnamese)",
"extraNameEnPlaceholder": "Name (English)",
"extraPricePlaceholder": "Extra price (VND)",
"confirmAddExtra": "Add",
"extraRequiredFieldsError": "Please fill in both names and a price for the extra.",
"extraSaveError": "Failed to save the extra. Try again."
```

- [ ] **Step 2: Add imports, state, and the load-on-mount effect**

In `components/admin/menu-item-form.tsx`, change the imports at the top to:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { UploadCloud, X, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { createModifierGroup, getModifierGroups } from "@/lib/supabase/menu-data"
import type { MenuCategory, MenuIcon, MenuItem, MenuItemInput, MenuModifierGroup } from "@/lib/supabase/menu-data"
```

Add new state right after the existing `error` state declaration
(`const [error, setError] = useState<string | null>(null)`):

```tsx
  const supabase = createClient()
  const [extraGroups, setExtraGroups] = useState<MenuModifierGroup[]>([])
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>(
    initialItem?.modifierGroups.filter((g) => g.options.length === 1).map((g) => g.id) ?? []
  )
  const [showAddExtraForm, setShowAddExtraForm] = useState(false)
  const [newExtraNameVi, setNewExtraNameVi] = useState("")
  const [newExtraNameEn, setNewExtraNameEn] = useState("")
  const [newExtraPrice, setNewExtraPrice] = useState("")
  const [extrasError, setExtrasError] = useState<string | null>(null)

  useEffect(() => {
    getModifierGroups(supabase).then((groups) => {
      setExtraGroups(groups.filter((g) => g.options.length === 1))
    })
    // Runs once on mount; supabase is a fresh client instance each render
    // but functionally equivalent, so depending on it would only cause
    // needless repeated fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 3: Add the `handleAddExtra` function**

Add after the existing `removeImage` function:

```tsx
  async function handleAddExtra() {
    const parsedPrice = Number(newExtraPrice)
    if (!newExtraNameVi.trim() || !newExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setExtrasError(t("extraRequiredFieldsError"))
      return
    }
    setExtrasError(null)
    try {
      const created = await createModifierGroup(supabase, {
        nameVi: newExtraNameVi.trim(),
        nameEn: newExtraNameEn.trim(),
        priceDelta: parsedPrice,
      })
      setExtraGroups((prev) => [...prev, created])
      setSelectedExtraIds((prev) => [...prev, created.id])
      setNewExtraNameVi("")
      setNewExtraNameEn("")
      setNewExtraPrice("")
      setShowAddExtraForm(false)
    } catch {
      setExtrasError(t("extraSaveError"))
    }
  }
```

- [ ] **Step 4: Update `onSave`'s type and `handleSave`'s call**

Change the component's prop type:

```tsx
export function MenuItemForm({
  categories,
  initialItem,
  onCancel,
  onSave,
}: {
  categories: MenuCategory[]
  initialItem?: MenuItem
  onCancel: () => void
  onSave: (input: MenuItemInput, extraGroupIds: string[]) => void
}) {
```

Change `handleSave`'s `onSave(...)` call to pass `selectedExtraIds`:

```tsx
  function handleSave() {
    const parsedPrice = Number(price)
    if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError(t("requiredFieldsError"))
      return
    }

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
        imageUrl: imagePreviewUrl?.startsWith("blob:") ? null : imagePreviewUrl,
      },
      selectedExtraIds
    )
  }
```

- [ ] **Step 5: Render the Extras section**

Insert this new section right before the closing `</div>` of the
scrollable form body (immediately after the existing "Featured / Best
Seller" toggle block, i.e. after the `<div className="flex items-center
justify-between rounded-lg border p-3">...popularToggle...</div>` block
and before the body's closing `</div>`):

```tsx
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("extrasLabel")}</label>
            {extrasError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{extrasError}</p>
            )}
            <div className="space-y-2 rounded-lg border p-3">
              {extraGroups.length === 0 && !showAddExtraForm && (
                <p className="text-sm text-muted-foreground">{t("noExtrasYet")}</p>
              )}
              {extraGroups.map((group) => {
                const checked = selectedExtraIds.includes(group.id)
                const option = group.options[0]
                return (
                  <label key={group.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedExtraIds((prev) =>
                            checked ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                          )
                        }
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                      />
                      <span className="text-card-foreground">
                        {group.nameVi} / {group.nameEn}
                      </span>
                    </span>
                    <span className="font-medium text-primary">+{formatVND(option.priceDelta)}</span>
                  </label>
                )
              })}
            </div>

            {showAddExtraForm ? (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    value={newExtraNameVi}
                    onChange={(e) => setNewExtraNameVi(e.target.value)}
                    placeholder={t("extraNameViPlaceholder")}
                    className="h-9"
                  />
                  <Input
                    value={newExtraNameEn}
                    onChange={(e) => setNewExtraNameEn(e.target.value)}
                    placeholder={t("extraNameEnPlaceholder")}
                    className="h-9"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={newExtraPrice}
                    onChange={(e) => setNewExtraPrice(e.target.value)}
                    placeholder={t("extraPricePlaceholder")}
                    className="h-9"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowAddExtraForm(false)}>
                    {t("cancel")}
                  </Button>
                  <Button type="button" size="sm" onClick={handleAddExtra}>
                    {t("confirmAddExtra")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddExtraForm(true)}>
                <Plus className="h-4 w-4" />
                {t("addNewExtra")}
              </Button>
            )}
          </div>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors referencing `menu-management.tsx`'s `onSave={(input) => ...}` call site (still the old single-argument signature) — expected at this point, Task 3 fixes it. Confirm no *other* errors.

- [ ] **Step 7: Commit**

```bash
git add components/admin/menu-item-form.tsx messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Add Extras section to the admin Add/Edit Item form

Checklist of every existing extra (checkbox + bilingual name + price)
plus an inline "+ Add New Extra" mini-form that creates and
auto-attaches a new one in one step. onSave now also passes the
selected extra group ids.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `menu-management.tsx` to persist the item↔extras link

**Files:**
- Modify: `components/admin/menu-management.tsx`

**Interfaces:**
- Consumes: `setItemModifierGroups`, `getMenuItemById` (Task 1 + existing)
  from `@/lib/supabase/menu-data`; `MenuItemForm`'s new `onSave` signature
  (Task 2).
- Produces: nothing new for later tasks — this is the last piece of the
  write path.

- [ ] **Step 1: Update imports**

Change the `menu-data` import block to also pull in the two new functions:

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

- [ ] **Step 2: Update `saveItem`**

Replace the existing `saveItem` function:

```tsx
  async function saveItem(input: MenuItemInput, extraGroupIds: string[], editingId: string | null) {
    setError(null)
    try {
      const saved = editingId
        ? await updateMenuItem(supabase, editingId, input)
        : await createMenuItem(supabase, input)
      await setItemModifierGroups(supabase, saved.id, extraGroupIds)
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

(The re-fetch via `getMenuItemById` after `setItemModifierGroups` is
needed because `saved` from `createMenuItem`/`updateMenuItem` reflects
the item's `modifierGroups` from *before* the new attachments were set —
without it, re-opening the same item's Edit form right after saving
would show stale checkbox state.)

- [ ] **Step 3: Update the `MenuItemForm` call site**

Change:

```tsx
          onSave={(input) => saveItem(input, formMode?.type === "edit" ? formMode.item.id : null)}
```

to:

```tsx
          onSave={(input, extraGroupIds) =>
            saveItem(input, extraGroupIds, formMode?.type === "edit" ? formMode.item.id : null)
          }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/menu-management.tsx
git commit -m "$(cat <<'EOF'
Persist an item's attached extras on save

saveItem now calls setItemModifierGroups after the item's own
create/update, then re-fetches the item so its modifierGroups reflect
the just-set attachments (avoids stale state if the same item is
edited again without a page reload).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Customer-facing toggle-off fix

**Files:**
- Modify: `components/customer/product-detail.tsx`

**Interfaces:**
- Consumes: existing `item.modifierGroups` (`MenuModifierGroup[]`, with
  `required: boolean`).
- Produces: nothing new — terminal task for this plan's write/read path,
  only the deselect interaction changes.

- [ ] **Step 1: Change the modifier option's click handler**

Replace:

```tsx
                    onClick={() => setSelectedModifiers((prev) => ({ ...prev, [group.id]: option.id }))}
```

with:

```tsx
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/customer/product-detail.tsx
git commit -m "$(cat <<'EOF'
Fix optional modifier options being impossible to deselect

Non-required groups (e.g. a single-option "Extra Shot" extra) could be
selected but never toggled back off, since the click handler always
set the selection. Required groups (Size) are unaffected -- they keep
exactly one selection at all times.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full local verification suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`
Expected: all pass. The pre-existing `react-hooks/set-state-in-effect`
ESLint errors (predating this plan, documented in `daily.md`) should be
the only ones present — confirm the count hasn't grown beyond what it
was before this plan.

- [ ] **Step 2: Manual verification on the live Vercel deployment**

After pushing, verify against `https://phadincafe.vercel.app` (per
this project's standing preference), logged in as admin:

- Edit an existing item, add a new extra (e.g. "Extra Shot", 10000),
  confirm it appears checked for that item immediately.
- Edit a *different* item, confirm the same extra now appears in its
  Extras checklist, unchecked — check it, save.
- Re-open the first item's Edit form — confirm the extra is still
  checked there too (proves the re-fetch-after-save in Task 3 works).
- As a customer (or guest), open a Product Detail Page for an item with
  an attached extra: select it (price updates), tap it again (confirm
  it deselects and price reverts) — then select it and add to cart,
  confirm the cart/checkout total includes it.

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Product Detail Page" section, add a short note that item extras
(modifier groups) are now admin-configurable via the Add/Edit Item form,
referencing this plan and its spec doc, and that the toggle-off fix
described there is now live.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document menu item extras feature as shipped in CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
