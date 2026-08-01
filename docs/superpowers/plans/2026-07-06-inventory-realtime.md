# Real Inventory Data + Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `hooks/useInventory.tsx`'s local `useState`+`localStorage`
mock model with real Supabase-backed data (already-applied schema from
migration `0004_inventory.sql`), add Realtime sync across sessions, and
build the missing admin UI to define what ingredients a menu item or extra
actually consumes (`menu_item_ingredients`/`modifier_ingredients` — tables
that exist today with zero rows and zero UI).

**Architecture:** Two new migrations (bilingual columns + an atomic
stock-adjustment RPC + Realtime publication, then seed data) applied to
the live Supabase project via the Supabase MCP tools. One new query module
(`lib/supabase/inventory-data.ts`, DI'd like `lib/supabase/menu-data.ts`).
`hooks/useInventory.tsx` becomes a real Context+Provider that fetches once
and subscribes to `postgres_changes` for live cross-session updates — no
more `localStorage`. New admin UI: an Add/Edit Ingredient modal, a shared
`RecipeChecklist` component used both for a menu item's own recipe and
(new) an edit affordance on Extras that lets an extra declare its own
ingredient usage.

**Tech Stack:** Next.js Client Components, `@supabase/supabase-js`
(Realtime via `postgres_changes`), Postgres `plpgsql` function (atomic
stock adjustment), Vitest.

## Global Constraints

- Every new/changed piece of UI text needs keys in **both**
  `messages/en.json` and `messages/vi.json`.
- DI convention: every function in `lib/supabase/inventory-data.ts` (and
  the new `updateModifierGroup` in `menu-data.ts`) takes
  `supabase: SupabaseClient` as its first argument, unit-tested with a
  fake/spy client — same style as `lib/supabase/menu-data.test.ts`.
- Every SQL migration is applied via `mcp__supabase__apply_migration`
  against the live project `qhiypdqnrnzndxdwqxbx`, then verified with
  `mcp__supabase__execute_sql` before moving on — same process used for
  migrations `0001`-`0009`.
- Base UI's `Button` has no `asChild` — polymorphic rendering uses
  `render={<Link .../>}` + `nativeButton={false}` (not needed in this
  plan, no new nav links, but keep in mind if one comes up).
- Toggle switches (none new in this plan) must anchor their thumb with
  `absolute left-0.5 top-0.5` + `translate-x-0`/`translate-x-5` — not
  relevant here since this plan adds no new toggles, noted only so it
  isn't reintroduced by copy-paste from an older, wrong example.

---

### Task 1: Migration `0010` — bilingual columns, stock-adjustment RPC, Realtime publication

**Files:**
- Create: `supabase/migrations/0010_inventory_i18n_and_stock_fn.sql`

**Interfaces:**
- Produces: `ingredients(name_vi, name_en, subtitle_vi, subtitle_en,
  icon)` (no more `name`); `public.ingredient_icon` enum; a callable
  `adjust_ingredient_stock(p_ingredient_id uuid, p_change numeric,
  p_reason inventory_log_reason) returns public.ingredients` RPC;
  `ingredients`/`inventory_logs` added to the `supabase_realtime`
  publication.

- [ ] **Step 1: Verify pre-conditions**

Use `mcp__supabase__execute_sql`:

```sql
select count(*) as ingredient_rows from public.ingredients;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('ingredients', 'inventory_logs');
```

Expected: `ingredient_rows = 0` (confirms the `drop column name`/`not
null` additions below are safe with no data to migrate), and the second
query returns **no rows** (confirms neither table is already in the
publication, so `alter publication ... add table` in Step 2 won't error).
If either assumption is false, stop and re-plan this task — don't proceed
with a migration written against a different starting state.

- [ ] **Step 2: Write the migration SQL**

```sql
-- 0010_inventory_i18n_and_stock_fn.sql
-- Bilingual name/subtitle + icon on ingredients (previously mock-only
-- fields with no real columns), an atomic stock-adjustment RPC (replaces
-- the old mock's client-side clamp-then-write, which was only safe with a
-- single browser tab), and Realtime replication for ingredients/
-- inventory_logs so every open admin session sees the same live state.

create type public.ingredient_icon as enum ('coffee', 'droplet', 'wheat', 'candy');

alter table public.ingredients add column name_vi text not null default '';
alter table public.ingredients add column name_en text not null default '';
alter table public.ingredients alter column name_vi drop default;
alter table public.ingredients alter column name_en drop default;

alter table public.ingredients add column subtitle_vi text not null default '';
alter table public.ingredients add column subtitle_en text not null default '';
alter table public.ingredients alter column subtitle_vi drop default;
alter table public.ingredients alter column subtitle_en drop default;

alter table public.ingredients add column icon public.ingredient_icon not null default 'coffee';

alter table public.ingredients drop column name;

create or replace function public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_change numeric,
  p_reason inventory_log_reason
) returns public.ingredients
language plpgsql
security invoker
as $$
declare
  v_current numeric;
  v_clamped_change numeric;
  v_row public.ingredients;
begin
  select stock_quantity into v_current
    from public.ingredients
    where id = p_ingredient_id
    for update;

  if v_current is null then
    raise exception 'ingredient % not found', p_ingredient_id;
  end if;

  v_clamped_change := greatest(p_change, -v_current);

  update public.ingredients
    set stock_quantity = round(stock_quantity + v_clamped_change, 2)
    where id = p_ingredient_id
    returning * into v_row;

  insert into public.inventory_logs (ingredient_id, change_quantity, reason, created_by)
    values (p_ingredient_id, v_clamped_change, p_reason, auth.uid());

  return v_row;
end;
$$;

grant execute on function public.adjust_ingredient_stock(uuid, numeric, inventory_log_reason) to authenticated;

alter publication supabase_realtime add table public.ingredients;
alter publication supabase_realtime add table public.inventory_logs;
```

`security invoker` (the default, stated explicitly) means this function
runs under the *calling* session's own role — the existing
`ingredients_admin_all`/`inventory_logs_admin_all` RLS policies
(`manager|admin` only) still gate who can call it. This is not a
privilege escalation; it only makes the read-clamp-write-log sequence
atomic in one round trip instead of three separate client round trips.

- [ ] **Step 3: Apply the migration**

Use `mcp__supabase__apply_migration` with `name:
"0010_inventory_i18n_and_stock_fn"` and the SQL from Step 2 as `query`.

- [ ] **Step 4: Verify the schema, function, and publication**

Use `mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'ingredients'
order by ordinal_position;

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'adjust_ingredient_stock';

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename in ('ingredients', 'inventory_logs');
```

Expected: `ingredients` columns show `name_vi`/`name_en`/`subtitle_vi`/
`subtitle_en`/`icon`/`unit`/`stock_quantity`/`low_stock_threshold`/`id`
(no `name`); `adjust_ingredient_stock` exists with `security_type =
'INVOKER'`; the publication query returns both `ingredients` and
`inventory_logs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_inventory_i18n_and_stock_fn.sql
git commit -m "Add bilingual ingredient columns, stock-adjustment RPC, Realtime publication"
```

---

### Task 2: Migration `0011` — seed ingredient data

**Files:**
- Create: `supabase/migrations/0011_seed_inventory_data.sql`

**Interfaces:**
- Consumes: `adjust_ingredient_stock` from Task 1.
- Produces: 4 real `ingredients` rows matching what's currently
  hardcoded in `hooks/useInventory.tsx`'s `INITIAL_INGREDIENTS`, each with
  one `inventory_logs` row recording its initial stock (reason
  `'adjustment'`) — keeps the invariant "every nonzero stock value has a
  log entry" true from row zero.

- [ ] **Step 1: Write the seed SQL**

```sql
-- 0011_seed_inventory_data.sql
-- Seeds the 4 ingredients already on screen in the mock Inventory page
-- (hooks/useInventory.tsx's INITIAL_INGREDIENTS) as real rows, so Admin
-- Inventory/Dashboard show identical content once the query layer swap
-- (Task 5) lands. Stock is set via adjust_ingredient_stock, not a raw
-- insert value, so the very first stock number is logged like every
-- later change will be.

do $$
declare
  v_id uuid;
begin
  insert into public.ingredients (name_vi, name_en, subtitle_vi, subtitle_en, unit, low_stock_threshold, icon)
    values ('Hạt Robusta Đặc Sản', 'Coffee Beans (Roasted)', 'Nguyên liệu', 'Raw material', 'kg', 10, 'coffee')
    returning id into v_id;
  perform public.adjust_ingredient_stock(v_id, 5.2, 'adjustment');

  insert into public.ingredients (name_vi, name_en, subtitle_vi, subtitle_en, unit, low_stock_threshold, icon)
    values ('Sữa Đặc Ông Thọ', 'Condensed Milk', 'Hàng tiêu dùng', 'Consumable', 'lon / cans', 12, 'droplet')
    returning id into v_id;
  perform public.adjust_ingredient_stock(v_id, 24, 'adjustment');

  insert into public.ingredients (name_vi, name_en, subtitle_vi, subtitle_en, unit, low_stock_threshold, icon)
    values ('Bột Kem Béo', 'Creamer Powder', 'Nguyên liệu', 'Raw material', 'kg', 5, 'wheat')
    returning id into v_id;
  perform public.adjust_ingredient_stock(v_id, 8.5, 'adjustment');

  insert into public.ingredients (name_vi, name_en, subtitle_vi, subtitle_en, unit, low_stock_threshold, icon)
    values ('Đường Cát Trắng', 'White Sugar', 'Nguyên liệu', 'Raw material', 'kg', 15, 'candy')
    returning id into v_id;
  perform public.adjust_ingredient_stock(v_id, 2.1, 'adjustment');
end $$;
```

- [ ] **Step 2: Apply the migration**

Use `mcp__supabase__apply_migration` with `name: "0011_seed_inventory_data"`
and the SQL from Step 1 as `query`.

- [ ] **Step 3: Verify the seed**

Use `mcp__supabase__execute_sql`:

```sql
select name_en, unit, stock_quantity, low_stock_threshold, icon from public.ingredients order by name_en;
select reason, change_quantity from public.inventory_logs order by created_at;
```

Expected: 4 rows (Coffee Beans (Roasted)/Condensed Milk/Creamer Powder/
White Sugar) with the stock/threshold/icon values from Step 1 above, and
4 matching `inventory_logs` rows all with `reason = 'adjustment'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_seed_inventory_data.sql
git commit -m "Seed real ingredient data matching the current mock values"
```

---

### Task 3: Query layer — `lib/supabase/inventory-data.ts`

**Files:**
- Create: `lib/supabase/inventory-data.ts`
- Create: `lib/supabase/inventory-data.test.ts`

**Interfaces:**
- Consumes: `ingredients`/`inventory_logs`/`menu_item_ingredients`/
  `modifier_ingredients` tables and the `adjust_ingredient_stock` RPC
  from Task 1.
- Produces: `Ingredient`, `IngredientIcon`, `IngredientInput`,
  `InventoryLogReason`, `InventoryLog`, `RecipeEntry` types and
  `getIngredients`, `createIngredient`, `updateIngredient`, `adjustStock`,
  `getInventoryLogs`, `getMenuItemIngredients`, `setMenuItemIngredients`,
  `getModifierIngredients`, `setModifierIngredients` — used by Task 5
  (`hooks/useInventory.tsx`), Task 6 (ingredient form), Task 8 (menu item
  Recipe section), and Task 9 (Extras edit).

- [ ] **Step 1: Write the failing test for `getIngredients`**

```ts
// lib/supabase/inventory-data.test.ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getIngredients } from "./inventory-data"

describe("getIngredients", () => {
  it("maps snake_case DB rows to camelCase Ingredient", async () => {
    const row = {
      id: "ing-1",
      name_vi: "Hạt Robusta Đặc Sản",
      name_en: "Coffee Beans (Roasted)",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      stock_quantity: 5.2,
      low_stock_threshold: 10,
      icon: "coffee",
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getIngredients(supabase)

    expect(result).toEqual([
      {
        id: "ing-1",
        nameVi: "Hạt Robusta Đặc Sản",
        nameEn: "Coffee Beans (Roasted)",
        subtitleVi: "Nguyên liệu",
        subtitleEn: "Raw material",
        unit: "kg",
        stock: 5.2,
        threshold: 10,
        icon: "coffee",
      },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/inventory-data.test.ts`
Expected: FAIL — `Cannot find module './inventory-data'`.

- [ ] **Step 3: Write `inventory-data.ts` (all functions — implementing them one test at a time would leave later steps' tests unable to import the module at all)**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type IngredientIcon = "coffee" | "droplet" | "wheat" | "candy"

export type Ingredient = {
  id: string
  nameVi: string
  nameEn: string
  subtitleVi: string
  subtitleEn: string
  unit: string
  stock: number
  threshold: number
  icon: IngredientIcon
}

export type IngredientInput = {
  nameVi: string
  nameEn: string
  subtitleVi: string
  subtitleEn: string
  unit: string
  threshold: number
  icon: IngredientIcon
}

export type InventoryLogReason = "restock" | "adjustment" | "waste" | "order_deduction"

export type InventoryLog = {
  id: string
  ingredientId: string
  ingredientNameVi: string
  ingredientNameEn: string
  change: number
  reason: InventoryLogReason
  timestamp: number
}

export type RecipeEntry = { ingredientId: string; quantityUsed: number }

const INGREDIENT_SELECT = "id, name_vi, name_en, subtitle_vi, subtitle_en, unit, stock_quantity, low_stock_threshold, icon"

export type IngredientRow = {
  id: string
  name_vi: string
  name_en: string
  subtitle_vi: string
  subtitle_en: string
  unit: string
  stock_quantity: number
  low_stock_threshold: number
  icon: IngredientIcon
}

export function mapIngredientRow(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    subtitleVi: row.subtitle_vi,
    subtitleEn: row.subtitle_en,
    unit: row.unit,
    stock: row.stock_quantity,
    threshold: row.low_stock_threshold,
    icon: row.icon,
  }
}

export async function getIngredients(supabase: SupabaseClient): Promise<Ingredient[]> {
  const { data, error } = await supabase.from("ingredients").select(INGREDIENT_SELECT).order("name_en")
  if (error) throw error
  return ((data ?? []) as IngredientRow[]).map(mapIngredientRow)
}

function toIngredientRow(input: IngredientInput) {
  return {
    name_vi: input.nameVi,
    name_en: input.nameEn,
    subtitle_vi: input.subtitleVi,
    subtitle_en: input.subtitleEn,
    unit: input.unit,
    low_stock_threshold: input.threshold,
    icon: input.icon,
  }
}

export async function createIngredient(supabase: SupabaseClient, input: IngredientInput): Promise<Ingredient> {
  const { data, error } = await supabase
    .from("ingredients")
    .insert(toIngredientRow(input))
    .select(INGREDIENT_SELECT)
    .single()
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

export async function updateIngredient(
  supabase: SupabaseClient,
  id: string,
  input: IngredientInput
): Promise<Ingredient> {
  const { data, error } = await supabase
    .from("ingredients")
    .update(toIngredientRow(input))
    .eq("id", id)
    .select(INGREDIENT_SELECT)
    .single()
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

export async function adjustStock(
  supabase: SupabaseClient,
  id: string,
  change: number,
  reason: InventoryLogReason
): Promise<Ingredient> {
  const { data, error } = await supabase.rpc("adjust_ingredient_stock", {
    p_ingredient_id: id,
    p_change: change,
    p_reason: reason,
  })
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

type InventoryLogRow = {
  id: string
  ingredient_id: string
  change_quantity: number
  reason: InventoryLogReason
  created_at: string
}

export function mapInventoryLogRow(
  row: InventoryLogRow,
  ingredientNameVi: string,
  ingredientNameEn: string
): InventoryLog {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    ingredientNameVi,
    ingredientNameEn,
    change: row.change_quantity,
    reason: row.reason,
    timestamp: new Date(row.created_at).getTime(),
  }
}

type InventoryLogJoinRow = InventoryLogRow & {
  ingredients: { name_vi: string; name_en: string } | null
}

export async function getInventoryLogs(supabase: SupabaseClient): Promise<InventoryLog[]> {
  const { data, error } = await supabase
    .from("inventory_logs")
    .select("id, ingredient_id, change_quantity, reason, created_at, ingredients ( name_vi, name_en )")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw error
  return ((data ?? []) as unknown as InventoryLogJoinRow[]).map((row) =>
    mapInventoryLogRow(row, row.ingredients?.name_vi ?? "", row.ingredients?.name_en ?? "")
  )
}

type RecipeRow = { ingredient_id: string; quantity_used: number }

export async function getMenuItemIngredients(supabase: SupabaseClient, menuItemId: string): Promise<RecipeEntry[]> {
  const { data, error } = await supabase
    .from("menu_item_ingredients")
    .select("ingredient_id, quantity_used")
    .eq("menu_item_id", menuItemId)
  if (error) throw error
  return ((data ?? []) as RecipeRow[]).map((row) => ({ ingredientId: row.ingredient_id, quantityUsed: row.quantity_used }))
}

export async function setMenuItemIngredients(
  supabase: SupabaseClient,
  menuItemId: string,
  entries: RecipeEntry[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("menu_item_ingredients").delete().eq("menu_item_id", menuItemId)
  if (deleteError) throw deleteError
  if (entries.length === 0) return
  const { error: insertError } = await supabase
    .from("menu_item_ingredients")
    .insert(entries.map((e) => ({ menu_item_id: menuItemId, ingredient_id: e.ingredientId, quantity_used: e.quantityUsed })))
  if (insertError) throw insertError
}

export async function getModifierIngredients(supabase: SupabaseClient, modifierId: string): Promise<RecipeEntry[]> {
  const { data, error } = await supabase
    .from("modifier_ingredients")
    .select("ingredient_id, quantity_used")
    .eq("modifier_id", modifierId)
  if (error) throw error
  return ((data ?? []) as RecipeRow[]).map((row) => ({ ingredientId: row.ingredient_id, quantityUsed: row.quantity_used }))
}

export async function setModifierIngredients(
  supabase: SupabaseClient,
  modifierId: string,
  entries: RecipeEntry[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("modifier_ingredients").delete().eq("modifier_id", modifierId)
  if (deleteError) throw deleteError
  if (entries.length === 0) return
  const { error: insertError } = await supabase
    .from("modifier_ingredients")
    .insert(entries.map((e) => ({ modifier_id: modifierId, ingredient_id: e.ingredientId, quantity_used: e.quantityUsed })))
  if (insertError) throw insertError
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/supabase/inventory-data.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the remaining tests**

Append to `lib/supabase/inventory-data.test.ts`:

```ts
import {
  getIngredients,
  createIngredient,
  adjustStock,
  getInventoryLogs,
  setMenuItemIngredients,
  setModifierIngredients,
} from "./inventory-data"

describe("createIngredient", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertedRow = {
      id: "ing-new",
      name_vi: "Đường Cát Trắng",
      name_en: "White Sugar",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      stock_quantity: 0,
      low_stock_threshold: 15,
      icon: "candy",
    }
    const insertSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createIngredient(supabase, {
      nameVi: "Đường Cát Trắng",
      nameEn: "White Sugar",
      subtitleVi: "Nguyên liệu",
      subtitleEn: "Raw material",
      unit: "kg",
      threshold: 15,
      icon: "candy",
    })

    expect(insertSpy).toHaveBeenCalledWith({
      name_vi: "Đường Cát Trắng",
      name_en: "White Sugar",
      subtitle_vi: "Nguyên liệu",
      subtitle_en: "Raw material",
      unit: "kg",
      low_stock_threshold: 15,
      icon: "candy",
    })
    expect(result.stock).toBe(0)
  })
})

describe("adjustStock", () => {
  it("calls the adjust_ingredient_stock RPC with the right argument names", async () => {
    const row = {
      id: "ing-1",
      name_vi: "a",
      name_en: "a",
      subtitle_vi: "a",
      subtitle_en: "a",
      unit: "kg",
      stock_quantity: 10.2,
      low_stock_threshold: 10,
      icon: "coffee",
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await adjustStock(supabase, "ing-1", 5, "restock")

    expect(rpcSpy).toHaveBeenCalledWith("adjust_ingredient_stock", {
      p_ingredient_id: "ing-1",
      p_change: 5,
      p_reason: "restock",
    })
    expect(result.stock).toBe(10.2)
  })
})

describe("getInventoryLogs", () => {
  it("maps joined rows, falling back to empty names when the ingredient join is null", async () => {
    const rows = [
      {
        id: "log-1",
        ingredient_id: "ing-1",
        change_quantity: -2,
        reason: "waste",
        created_at: "2026-07-06T10:00:00.000Z",
        ingredients: { name_vi: "Đường", name_en: "Sugar" },
      },
      {
        id: "log-2",
        ingredient_id: "ing-deleted",
        change_quantity: 3,
        reason: "restock",
        created_at: "2026-07-06T09:00:00.000Z",
        ingredients: null,
      },
    ]
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getInventoryLogs(supabase)

    expect(result[0]).toEqual({
      id: "log-1",
      ingredientId: "ing-1",
      ingredientNameVi: "Đường",
      ingredientNameEn: "Sugar",
      change: -2,
      reason: "waste",
      timestamp: new Date("2026-07-06T10:00:00.000Z").getTime(),
    })
    expect(result[1].ingredientNameVi).toBe("")
    expect(result[1].ingredientNameEn).toBe("")
  })
})

describe("setMenuItemIngredients", () => {
  it("deletes existing rows then inserts one row per entry", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setMenuItemIngredients(supabase, "item-1", [{ ingredientId: "ing-1", quantityUsed: 0.02 }])

    expect(deleteEqSpy).toHaveBeenCalledWith("menu_item_id", "item-1")
    expect(insertSpy).toHaveBeenCalledWith([{ menu_item_id: "item-1", ingredient_id: "ing-1", quantity_used: 0.02 }])
  })

  it("skips the insert call when entries is empty", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setMenuItemIngredients(supabase, "item-1", [])

    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("setModifierIngredients", () => {
  it("deletes existing rows keyed by modifier_id then inserts", async () => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: deleteEqSpy }), insert: insertSpy }),
    } as unknown as SupabaseClient

    await setModifierIngredients(supabase, "mod-1", [{ ingredientId: "ing-1", quantityUsed: 0.01 }])

    expect(deleteEqSpy).toHaveBeenCalledWith("modifier_id", "mod-1")
    expect(insertSpy).toHaveBeenCalledWith([{ modifier_id: "mod-1", ingredient_id: "ing-1", quantity_used: 0.01 }])
  })
})
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run lib/supabase/inventory-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/inventory-data.ts lib/supabase/inventory-data.test.ts
git commit -m "Add inventory-data query layer for real ingredients/logs/recipes"
```

---

### Task 4: `updateModifierGroup` in `lib/supabase/menu-data.ts`

**Files:**
- Modify: `lib/supabase/menu-data.ts`
- Modify: `lib/supabase/menu-data.test.ts`

**Interfaces:**
- Consumes: `ModifierGroupInput`, `MenuModifierGroup` (already defined).
- Produces: `updateModifierGroup(supabase, groupId, input)` — used by
  Task 9's Extras edit affordance.

- [ ] **Step 1: Write the failing test**

Append to `lib/supabase/menu-data.test.ts`:

```ts
import { updateModifierGroup } from "./menu-data"

describe("updateModifierGroup", () => {
  it("updates the group's names then its one modifier's names/price", async () => {
    const groupUpdateEqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const modifierUpdateEqSpy = vi.fn(() => ({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "mod-1", name_vi: "Thêm Shot Đậm", name_en: "Extra Strong Shot", price_delta: 12000 },
            error: null,
          }),
      }),
    }))
    const supabase = {
      from: (table: string) => {
        if (table === "modifier_groups") return { update: () => ({ eq: groupUpdateEqSpy }) }
        if (table === "modifiers") return { update: () => ({ eq: modifierUpdateEqSpy }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    const result = await updateModifierGroup(supabase, "grp-1", {
      nameVi: "Thêm Shot Đậm",
      nameEn: "Extra Strong Shot",
      priceDelta: 12000,
    })

    expect(groupUpdateEqSpy).toHaveBeenCalledWith("id", "grp-1")
    expect(modifierUpdateEqSpy).toHaveBeenCalledWith("modifier_group_id", "grp-1")
    expect(result).toEqual({
      id: "grp-1",
      nameVi: "Thêm Shot Đậm",
      nameEn: "Extra Strong Shot",
      required: false,
      options: [{ id: "mod-1", nameVi: "Thêm Shot Đậm", nameEn: "Extra Strong Shot", priceDelta: 12000 }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: FAIL — `updateModifierGroup is not a function`.

- [ ] **Step 3: Implement `updateModifierGroup`**

Append to `lib/supabase/menu-data.ts` (after `setItemModifierGroups`):

```ts
export async function updateModifierGroup(
  supabase: SupabaseClient,
  groupId: string,
  input: ModifierGroupInput
): Promise<MenuModifierGroup> {
  const { error: groupError } = await supabase
    .from("modifier_groups")
    .update({ name_vi: input.nameVi, name_en: input.nameEn })
    .eq("id", groupId)
  if (groupError) throw groupError

  const { data: modifierRow, error: modifierError } = await supabase
    .from("modifiers")
    .update({ name_vi: input.nameVi, name_en: input.nameEn, price_delta: input.priceDelta })
    .eq("modifier_group_id", groupId)
    .select("id, name_vi, name_en, price_delta")
    .single()
  if (modifierError) throw modifierError

  return {
    id: groupId,
    nameVi: input.nameVi,
    nameEn: input.nameEn,
    required: false,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/supabase/menu-data.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/menu-data.ts lib/supabase/menu-data.test.ts
git commit -m "Add updateModifierGroup for editing an existing extra"
```

---

### Task 5: Rewrite `hooks/useInventory.tsx` for real data + Realtime

**Files:**
- Modify: `hooks/useInventory.tsx` (full rewrite)
- Modify: `components/admin/inventory-management.tsx` (loading/error only)
- Modify: `components/admin/dashboard-view.tsx` (loading only)
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: everything from Task 3's `lib/supabase/inventory-data.ts`.
- Produces: `useInventory()` now exposes `ingredients`, `logs`,
  `isLoading`, `error`, `restock`, `adjustStock`, `setOutOfStock` (all
  four now `async`, same call signatures as before), plus new
  `addIngredient`, `updateIngredientDetails` — consumed by Task 6.
  Re-exports `Ingredient`/`IngredientIcon`/`IngredientInput`/
  `InventoryLog`/`InventoryLogReason` from `inventory-data.ts` so existing
  `import type { ... } from "@/hooks/useInventory"` call sites
  (`inventory-management.tsx`, `dashboard-view.tsx`,
  `stock-adjust-form.tsx`) keep working unchanged.

- [ ] **Step 1: Rewrite `hooks/useInventory.tsx`**

```tsx
"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import {
  adjustStock as adjustStockQuery,
  createIngredient,
  getIngredients,
  getInventoryLogs,
  mapIngredientRow,
  mapInventoryLogRow,
  updateIngredient as updateIngredientQuery,
  type Ingredient,
  type IngredientIcon,
  type IngredientInput,
  type IngredientRow,
  type InventoryLog,
  type InventoryLogReason,
} from "@/lib/supabase/inventory-data"

export type { Ingredient, IngredientIcon, IngredientInput, InventoryLog, InventoryLogReason }

type InventoryContextValue = {
  ingredients: Ingredient[]
  logs: InventoryLog[]
  isLoading: boolean
  error: string | null
  restock: (id: string) => Promise<void>
  adjustStock: (id: string, change: number, reason: InventoryLogReason) => Promise<void>
  setOutOfStock: (id: string) => Promise<void>
  addIngredient: (input: IngredientInput) => Promise<void>
  updateIngredientDetails: (id: string, input: IngredientInput) => Promise<void>
}

const InventoryContext = createContext<InventoryContextValue | null>(null)

type InventoryLogRow = {
  id: string
  ingredient_id: string
  change_quantity: number
  reason: InventoryLogReason
  created_at: string
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [logs, setLogs] = useState<InventoryLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ingredientsRef = useRef<Ingredient[]>([])

  useEffect(() => {
    ingredientsRef.current = ingredients
  }, [ingredients])

  useEffect(() => {
    let cancelled = false

    Promise.all([getIngredients(supabase), getInventoryLogs(supabase)])
      .then(([ingredientRows, logRows]) => {
        if (cancelled) return
        setIngredients(ingredientRows)
        setLogs(logRows)
      })
      .catch(() => {
        if (!cancelled) setError("load-failed")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const channel = supabase
      .channel("inventory-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ingredients" },
        (payload: RealtimePostgresChangesPayload<IngredientRow>) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string }).id
            if (!oldId) return
            setIngredients((prev) => prev.filter((i) => i.id !== oldId))
            return
          }
          const mapped = mapIngredientRow(payload.new as IngredientRow)
          setIngredients((prev) =>
            prev.some((i) => i.id === mapped.id)
              ? prev.map((i) => (i.id === mapped.id ? mapped : i))
              : [...prev, mapped]
          )
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inventory_logs" },
        (payload: RealtimePostgresChangesPayload<InventoryLogRow>) => {
          const row = payload.new as InventoryLogRow
          const ingredient = ingredientsRef.current.find((i) => i.id === row.ingredient_id)
          setLogs((prev) => [mapInventoryLogRow(row, ingredient?.nameVi ?? "", ingredient?.nameEn ?? ""), ...prev])
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Inventory realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // Runs once on mount; `supabase` is a stable client held in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function restock(id: string) {
    const ingredient = ingredientsRef.current.find((i) => i.id === id)
    if (!ingredient) return
    await adjustStockQuery(supabase, id, ingredient.threshold, "restock")
  }

  async function adjustStock(id: string, change: number, reason: InventoryLogReason) {
    if (change === 0) return
    await adjustStockQuery(supabase, id, change, reason)
  }

  async function setOutOfStock(id: string) {
    const ingredient = ingredientsRef.current.find((i) => i.id === id)
    if (!ingredient) return
    await adjustStockQuery(supabase, id, -ingredient.stock, "adjustment")
  }

  async function addIngredient(input: IngredientInput) {
    await createIngredient(supabase, input)
  }

  async function updateIngredientDetails(id: string, input: IngredientInput) {
    await updateIngredientQuery(supabase, id, input)
  }

  return (
    <InventoryContext.Provider
      value={{
        ingredients,
        logs,
        isLoading,
        error,
        restock,
        adjustStock,
        setOutOfStock,
        addIngredient,
        updateIngredientDetails,
      }}
    >
      {children}
    </InventoryContext.Provider>
  )
}

export function useInventory(): InventoryContextValue {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error("useInventory must be used within an InventoryProvider")
  return ctx
}
```

Note: mutation functions (`restock`/`adjustStock`/`setOutOfStock`) never
call `setIngredients`/`setLogs` themselves — the Realtime subscription
delivers the same change back to this session too, so there is exactly
one code path that updates local state, not two that could drift apart.

- [ ] **Step 2: Update `components/admin/inventory-management.tsx` for loading/error**

At the top of the component body, after destructuring `useInventory()`,
add `isLoading`/`error` to the destructure:

```tsx
const { ingredients, logs, isLoading, error, adjustStock, setOutOfStock } = useInventory()
```

After the `<h2>` title, add an inline error banner (same pattern as
`menu-management.tsx`):

```tsx
{error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("loadError")}</p>}
```

In the ingredients table body, wrap the existing `.map(...)` so a loading
state doesn't render an empty table with no explanation:

```tsx
<tbody className="divide-y">
  {isLoading ? (
    <tr>
      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
        {t("loadingIngredients")}
      </td>
    </tr>
  ) : (
    ingredients.map((ingredient) => {
      const Icon = ICONS[ingredient.icon]
      const isOut = ingredient.stock <= 0
      const isLow = !isOut && ingredient.stock < ingredient.threshold
      return (
        <tr key={ingredient.id}>
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-card-foreground">
                  {locale === "vi" ? ingredient.nameVi : ingredient.nameEn}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === "vi" ? ingredient.subtitleVi : ingredient.subtitleEn}
                </p>
              </div>
            </div>
          </td>
          <td className="px-4 py-3 text-muted-foreground">{ingredient.unit}</td>
          <td className="px-4 py-3 font-bold text-card-foreground">
            {ingredient.stock} {ingredient.unit}
          </td>
          <td className="px-4 py-3 text-muted-foreground">
            {ingredient.threshold} {ingredient.unit}
          </td>
          <td className="px-4 py-3">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-bold",
                isOut
                  ? "border-destructive/40 bg-destructive text-destructive-foreground"
                  : isLow
                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                    : "border-green-200 bg-green-100 text-green-700"
              )}
            >
              {isOut ? t("outOfStock") : isLow ? t("lowStock") : t("inStock")}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setEditingId(ingredient.id)}>
              {t("adjustStock")}
            </Button>
          </td>
        </tr>
      )
    })
  )}
</tbody>
```

(The actions cell above is unchanged from today — Task 6's Step 2 comes
back and adds a pencil edit button next to this "Adjust Stock" button.)

- [ ] **Step 3: Update `components/admin/dashboard-view.tsx` for loading**

```tsx
const { ingredients, restock, isLoading } = useInventory()
const lowStock = ingredients.filter((i) => i.stock < i.threshold)
```

In the low-stock table body, add a loading branch before the existing
`lowStock.length === 0` check:

```tsx
{isLoading ? (
  <tr>
    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
      {t("loadingInventory")}
    </td>
  </tr>
) : lowStock.length === 0 ? (
  <tr>
    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
      {t("noLowStock")}
    </td>
  </tr>
) : (
  lowStock.map((item) => {
    const Icon = INGREDIENT_ICONS[item.icon]
    return (
      <tr key={item.id}>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2 font-bold text-card-foreground">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {locale === "vi" ? item.nameVi : item.nameEn}
          </div>
        </td>
        <td className="px-3 py-3 text-muted-foreground">
          {locale === "vi" ? item.subtitleVi : item.subtitleEn}
        </td>
        <td className="px-3 py-3 text-center font-bold text-destructive">
          {item.stock} {item.unit}
        </td>
        <td className="px-3 py-3">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {t("critical")}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <Button size="sm" className="h-8" onClick={() => restock(item.id)}>
            {t("restock")}
          </Button>
        </td>
      </tr>
    )
  })
)}
```

This is the existing `lowStock.map(...)`/`noLowStock` JSX from
`dashboard-view.tsx`, unchanged except for the new `isLoading` branch
added above it.

- [ ] **Step 4: Add new translation keys**

`messages/en.json`, inside `"AdminInventory"`:

```json
"loadingIngredients": "Loading ingredients…",
"loadError": "Failed to load inventory data. Try refreshing.",
```

`messages/vi.json`, inside `"AdminInventory"`:

```json
"loadingIngredients": "Đang tải nguyên liệu…",
"loadError": "Không thể tải dữ liệu kho hàng. Vui lòng làm mới trang.",
```

`messages/en.json`, inside `"Dashboard"`:

```json
"loadingInventory": "Loading inventory…",
```

`messages/vi.json`, inside `"Dashboard"`:

```json
"loadingInventory": "Đang tải kho hàng…",
```

- [ ] **Step 5: Run the full test suite and type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add hooks/useInventory.tsx components/admin/inventory-management.tsx components/admin/dashboard-view.tsx messages/en.json messages/vi.json
git commit -m "Rewrite useInventory to fetch real data and subscribe to Realtime"
```

---

### Task 6: Add/Edit Ingredient admin UI

**Files:**
- Create: `components/admin/ingredient-form.tsx`
- Modify: `components/admin/inventory-management.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `Ingredient`, `IngredientIcon`, `IngredientInput` from
  `@/hooks/useInventory` (Task 5); `addIngredient`/`updateIngredientDetails`
  from `useInventory()`.
- Produces: `IngredientForm` component, an "+ Add Ingredient" button and
  a per-row edit affordance on the Inventory page.

- [ ] **Step 1: Create `components/admin/ingredient-form.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { X, Coffee, Droplet, Wheat, Candy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Ingredient, IngredientIcon, IngredientInput } from "@/hooks/useInventory"

const ICON_OPTIONS: IngredientIcon[] = ["coffee", "droplet", "wheat", "candy"]
const ICONS: Record<IngredientIcon, typeof Coffee> = {
  coffee: Coffee,
  droplet: Droplet,
  wheat: Wheat,
  candy: Candy,
}

export function IngredientForm({
  initialIngredient,
  onCancel,
  onSave,
}: {
  initialIngredient?: Ingredient
  onCancel: () => void
  onSave: (input: IngredientInput) => Promise<void>
}) {
  const t = useTranslations("AdminInventory")
  const isEditing = Boolean(initialIngredient)

  const [nameVi, setNameVi] = useState(initialIngredient?.nameVi ?? "")
  const [nameEn, setNameEn] = useState(initialIngredient?.nameEn ?? "")
  const [subtitleVi, setSubtitleVi] = useState(initialIngredient?.subtitleVi ?? "")
  const [subtitleEn, setSubtitleEn] = useState(initialIngredient?.subtitleEn ?? "")
  const [unit, setUnit] = useState(initialIngredient?.unit ?? "")
  const [threshold, setThreshold] = useState(initialIngredient ? String(initialIngredient.threshold) : "")
  const [icon, setIcon] = useState<IngredientIcon>(initialIngredient?.icon ?? "coffee")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    const parsedThreshold = Number(threshold)
    if (
      !nameVi.trim() ||
      !nameEn.trim() ||
      !subtitleVi.trim() ||
      !subtitleEn.trim() ||
      !unit.trim() ||
      !Number.isFinite(parsedThreshold) ||
      parsedThreshold < 0
    ) {
      setError(t("ingredientRequiredFieldsError"))
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await onSave({
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim(),
        subtitleVi: subtitleVi.trim(),
        subtitleEn: subtitleEn.trim(),
        unit: unit.trim(),
        threshold: parsedThreshold,
        icon,
      })
    } catch {
      setError(t("ingredientSaveError"))
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-card-foreground">
            {isEditing ? t("editIngredientTitle") : t("addIngredientTitle")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("ingredientNameViLabel")}</label>
              <Input value={nameVi} onChange={(e) => setNameVi(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("ingredientNameEnLabel")}</label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="h-10" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("ingredientSubtitleViLabel")}</label>
              <Input value={subtitleVi} onChange={(e) => setSubtitleVi(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("ingredientSubtitleEnLabel")}</label>
              <Input value={subtitleEn} onChange={(e) => setSubtitleEn(e.target.value)} className="h-10" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("ingredientUnitLabel")}</label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={t("ingredientUnitPlaceholder")}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("threshold")}</label>
              <Input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-10" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("ingredientIconLabel")}</label>
            <div className="flex gap-2">
              {ICON_OPTIONS.map((option) => {
                const Icon = ICONS[option]
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setIcon(option)}
                    aria-pressed={icon === option}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg border-2 transition-colors",
                      icon === option ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `components/admin/inventory-management.tsx`**

Add imports:

```tsx
import { Plus, Pencil } from "lucide-react"
import { IngredientForm } from "@/components/admin/ingredient-form"
import type { Ingredient } from "@/hooks/useInventory"
```

Add state and destructure the new hook functions:

```tsx
const { ingredients, logs, isLoading, error, adjustStock, setOutOfStock, addIngredient, updateIngredientDetails } = useInventory()
const [formMode, setFormMode] = useState<{ type: "add" } | { type: "edit"; ingredient: Ingredient } | null>(null)
const [formError, setFormError] = useState<string | null>(null)
```

Replace the page header (`<h2>{t("title")}</h2>`) with a header row that
also has the Add button:

```tsx
<div className="flex items-center justify-between">
  <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
  <Button className="h-10 gap-2" onClick={() => setFormMode({ type: "add" })}>
    <Plus className="h-4 w-4" />
    {t("addIngredient")}
  </Button>
</div>
```

In the ingredients table's actions cell, add a pencil button next to the
existing "Adjust Stock" button:

```tsx
<td className="px-4 py-3 text-right">
  <div className="flex justify-end gap-1">
    <button
      type="button"
      onClick={() => setFormMode({ type: "edit", ingredient })}
      aria-label={t("edit")}
      title={t("edit")}
      className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
    >
      <Pencil className="h-4 w-4" />
    </button>
    <Button size="sm" variant="outline" className="h-8" onClick={() => setEditingId(ingredient.id)}>
      {t("adjustStock")}
    </Button>
  </div>
</td>
```

After the existing `{editingIngredient && <StockAdjustForm .../>}` block,
add the new form:

```tsx
{formMode && (
  <IngredientForm
    initialIngredient={formMode.type === "edit" ? formMode.ingredient : undefined}
    onCancel={() => setFormMode(null)}
    onSave={async (input) => {
      if (formMode.type === "edit") {
        await updateIngredientDetails(formMode.ingredient.id, input)
      } else {
        await addIngredient(input)
      }
      setFormMode(null)
    }}
  />
)}
```

- [ ] **Step 3: Add new translation keys**

`messages/en.json`, inside `"AdminInventory"`:

```json
"addIngredient": "+ Add Ingredient",
"addIngredientTitle": "Add Ingredient",
"editIngredientTitle": "Edit Ingredient",
"ingredientNameViLabel": "Name (Vietnamese)",
"ingredientNameEnLabel": "Name (English)",
"ingredientSubtitleViLabel": "Category label (Vietnamese)",
"ingredientSubtitleEnLabel": "Category label (English)",
"ingredientUnitLabel": "Unit",
"ingredientUnitPlaceholder": "e.g. kg, cans, liters",
"ingredientIconLabel": "Icon",
"ingredientRequiredFieldsError": "Please fill in all fields with a valid threshold.",
"ingredientSaveError": "Failed to save ingredient. Try again.",
"edit": "Edit",
"cancel": "Cancel",
"save": "Save",
```

`messages/vi.json`, inside `"AdminInventory"`:

```json
"addIngredient": "+ Thêm Nguyên Liệu",
"addIngredientTitle": "Thêm Nguyên Liệu",
"editIngredientTitle": "Sửa Nguyên Liệu",
"ingredientNameViLabel": "Tên (Tiếng Việt)",
"ingredientNameEnLabel": "Tên (English)",
"ingredientSubtitleViLabel": "Nhãn phân loại (Tiếng Việt)",
"ingredientSubtitleEnLabel": "Nhãn phân loại (English)",
"ingredientUnitLabel": "Đơn Vị",
"ingredientUnitPlaceholder": "VD: kg, lon, lít",
"ingredientIconLabel": "Biểu Tượng",
"ingredientRequiredFieldsError": "Vui lòng nhập đầy đủ thông tin và ngưỡng cảnh báo hợp lệ.",
"ingredientSaveError": "Lưu nguyên liệu thất bại. Vui lòng thử lại.",
"edit": "Sửa",
"cancel": "Hủy",
"save": "Lưu",
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/ingredient-form.tsx components/admin/inventory-management.tsx messages/en.json messages/vi.json
git commit -m "Add real Add/Edit Ingredient UI to Admin Inventory"
```

---

### Task 7: Shared `RecipeChecklist` component

**Files:**
- Create: `components/admin/recipe-checklist.tsx`

**Interfaces:**
- Consumes: `Ingredient` from `@/lib/supabase/inventory-data`.
- Produces: `RecipeChecklist`, `RecipeSelection` type — used by Task 8
  (menu item Recipe section) and Task 9 (Extras edit's own recipe).

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { Input } from "@/components/ui/input"
import type { Ingredient } from "@/lib/supabase/inventory-data"

export type RecipeSelection = Record<string, number>

export function RecipeChecklist({
  ingredients,
  selected,
  onChange,
  locale,
  emptyLabel,
  quantityPlaceholder,
}: {
  ingredients: Ingredient[]
  selected: RecipeSelection
  onChange: (next: RecipeSelection) => void
  locale: string
  emptyLabel: string
  quantityPlaceholder: string
}) {
  if (ingredients.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      {ingredients.map((ingredient) => {
        const checked = ingredient.id in selected
        return (
          <div key={ingredient.id} className="flex items-center justify-between gap-3 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = { ...selected }
                  if (checked) {
                    delete next[ingredient.id]
                  } else {
                    next[ingredient.id] = 0
                  }
                  onChange(next)
                }}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
              />
              <span className="text-card-foreground">{locale === "vi" ? ingredient.nameVi : ingredient.nameEn}</span>
            </label>
            {checked && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={selected[ingredient.id] || ""}
                  onChange={(e) => onChange({ ...selected, [ingredient.id]: Number(e.target.value) })}
                  placeholder={quantityPlaceholder}
                  className="h-8 w-24"
                />
                <span className="text-xs text-muted-foreground">{ingredient.unit}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors (component isn't used anywhere yet, but must compile
standalone).

- [ ] **Step 3: Commit**

```bash
git add components/admin/recipe-checklist.tsx
git commit -m "Add shared RecipeChecklist component for ingredient+quantity selection"
```

---

### Task 8: Recipe section in the menu item Add/Edit form

**Files:**
- Modify: `components/admin/menu-item-form.tsx`
- Modify: `components/admin/menu-management.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `getIngredients`, `getMenuItemIngredients`, `RecipeEntry` from
  `@/lib/supabase/inventory-data`; `RecipeChecklist`/`RecipeSelection`
  from Task 7.
- Produces: `MenuItemForm`'s `onSave` signature grows a third parameter
  (`recipeEntries: RecipeEntry[]`); `MenuManagement`'s `saveItem` persists
  them via `setMenuItemIngredients`.

- [ ] **Step 1: Add imports and state to `menu-item-form.tsx`**

Change the `next-intl` import line:

```tsx
import { useLocale, useTranslations } from "next-intl"
```

Add new imports below the existing `menu-data` import:

```tsx
import { getIngredients, getMenuItemIngredients, type Ingredient, type RecipeEntry } from "@/lib/supabase/inventory-data"
import { RecipeChecklist, type RecipeSelection } from "@/components/admin/recipe-checklist"
```

Add `locale` and new state, near the existing `extraGroups` state block:

```tsx
const locale = useLocale()
const [ingredientsList, setIngredientsList] = useState<Ingredient[]>([])
const [selectedRecipe, setSelectedRecipe] = useState<RecipeSelection>({})
const [recipeError, setRecipeError] = useState<string | null>(null)
```

- [ ] **Step 2: Fetch ingredients and the item's existing recipe on mount**

Add a second mount effect, right after the existing `getModifierGroups`
effect:

```tsx
useEffect(() => {
  getIngredients(supabase).then(setIngredientsList)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

useEffect(() => {
  if (!initialItem) return
  getMenuItemIngredients(supabase, initialItem.id).then((entries) => {
    const map: RecipeSelection = {}
    entries.forEach((e) => {
      map[e.ingredientId] = e.quantityUsed
    })
    setSelectedRecipe(map)
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 3: Update `onSave`'s type and `handleSave`**

Change the prop type:

```tsx
onSave: (input: MenuItemInput, extraGroupIds: string[], recipeEntries: RecipeEntry[]) => void
```

Update `handleSave`:

```tsx
function handleSave() {
  const parsedPrice = Number(price)
  if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    setError(t("requiredFieldsError"))
    return
  }

  const recipeEntries: RecipeEntry[] = Object.entries(selectedRecipe).map(([ingredientId, quantityUsed]) => ({
    ingredientId,
    quantityUsed,
  }))
  if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
    setRecipeError(t("recipeQuantityRequiredError"))
    return
  }
  setRecipeError(null)

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
    selectedExtraIds,
    recipeEntries
  )
}
```

- [ ] **Step 4: Render the Recipe section**

Add this section right after the existing Extras `<div>` block (before
the closing `</div>` of the scrollable form body):

```tsx
<div className="space-y-1.5">
  <label className="text-xs font-medium text-muted-foreground">{t("recipeLabel")}</label>
  {recipeError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{recipeError}</p>}
  <RecipeChecklist
    ingredients={ingredientsList}
    selected={selectedRecipe}
    onChange={setSelectedRecipe}
    locale={locale}
    emptyLabel={t("noIngredientsForRecipe")}
    quantityPlaceholder={t("recipeQuantityPlaceholder")}
  />
</div>
```

- [ ] **Step 5: Update `components/admin/menu-management.tsx`'s `saveItem`**

Add the import:

```tsx
import { setMenuItemIngredients, type RecipeEntry } from "@/lib/supabase/inventory-data"
```

Update `saveItem`:

```tsx
async function saveItem(input: MenuItemInput, extraGroupIds: string[], recipeEntries: RecipeEntry[], editingId: string | null) {
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

Update the `MenuItemForm` call site:

```tsx
<MenuItemForm
  categories={categories}
  initialItem={formMode.type === "edit" ? formMode.item : undefined}
  onCancel={() => setFormMode(null)}
  onSave={(input, extraGroupIds, recipeEntries) =>
    saveItem(input, extraGroupIds, recipeEntries, formMode?.type === "edit" ? formMode.item.id : null)
  }
/>
```

- [ ] **Step 6: Add new translation keys**

`messages/en.json`, inside `"AdminMenu"`:

```json
"recipeLabel": "Recipe (ingredients used)",
"noIngredientsForRecipe": "No ingredients yet — add some on the Inventory page first.",
"recipeQuantityPlaceholder": "Qty",
"recipeQuantityRequiredError": "Enter a quantity greater than 0 for each checked ingredient.",
```

`messages/vi.json`, inside `"AdminMenu"`:

```json
"recipeLabel": "Công Thức (nguyên liệu sử dụng)",
"noIngredientsForRecipe": "Chưa có nguyên liệu nào — hãy thêm ở trang Kho Hàng trước.",
"recipeQuantityPlaceholder": "SL",
"recipeQuantityRequiredError": "Vui lòng nhập số lượng lớn hơn 0 cho mỗi nguyên liệu đã chọn.",
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/admin/menu-item-form.tsx components/admin/menu-management.tsx messages/en.json messages/vi.json
git commit -m "Add Recipe section to the menu item form, wire to menu_item_ingredients"
```

---

### Task 9: Extras edit affordance (name/price + its own recipe)

**Files:**
- Modify: `components/admin/menu-item-form.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `updateModifierGroup` (Task 4); `getModifierIngredients`,
  `setModifierIngredients` (Task 3); `RecipeChecklist` (Task 7).
- Produces: a pencil-icon edit affordance per Extra row, previously
  nonexistent — the first way to change an already-created extra's name,
  price, or ingredient usage.

- [ ] **Step 1: Add imports and state**

Add to the existing `lucide-react` import line: `Pencil`.

Add to the existing `menu-data` import: `updateModifierGroup`.

Add to the existing `inventory-data` import (from Task 8):
`getModifierIngredients`, `setModifierIngredients`.

Add new state near the existing extras state block:

```tsx
const [editingExtraId, setEditingExtraId] = useState<string | null>(null)
const [editExtraNameVi, setEditExtraNameVi] = useState("")
const [editExtraNameEn, setEditExtraNameEn] = useState("")
const [editExtraPrice, setEditExtraPrice] = useState("")
const [editExtraRecipe, setEditExtraRecipe] = useState<RecipeSelection>({})
const [editExtraError, setEditExtraError] = useState<string | null>(null)
const [isSavingExtra, setIsSavingExtra] = useState(false)
```

- [ ] **Step 2: Add `openExtraEdit` and `handleSaveExtraEdit` functions**

Add below `handleAddExtra`:

```tsx
async function openExtraEdit(group: MenuModifierGroup) {
  setEditingExtraId(group.id)
  setEditExtraNameVi(group.nameVi)
  setEditExtraNameEn(group.nameEn)
  setEditExtraPrice(String(group.options[0].priceDelta))
  setEditExtraError(null)
  const entries = await getModifierIngredients(supabase, group.options[0].id)
  const map: RecipeSelection = {}
  entries.forEach((entry) => {
    map[entry.ingredientId] = entry.quantityUsed
  })
  setEditExtraRecipe(map)
}

async function handleSaveExtraEdit(group: MenuModifierGroup) {
  const parsedPrice = Number(editExtraPrice)
  if (!editExtraNameVi.trim() || !editExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
    setEditExtraError(t("extraRequiredFieldsError"))
    return
  }
  const recipeEntries = Object.entries(editExtraRecipe).map(([ingredientId, quantityUsed]) => ({
    ingredientId,
    quantityUsed,
  }))
  if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
    setEditExtraError(t("recipeQuantityRequiredError"))
    return
  }
  setEditExtraError(null)
  setIsSavingExtra(true)
  try {
    const updated = await updateModifierGroup(supabase, group.id, {
      nameVi: editExtraNameVi.trim(),
      nameEn: editExtraNameEn.trim(),
      priceDelta: parsedPrice,
    })
    await setModifierIngredients(supabase, updated.options[0].id, recipeEntries)
    setExtraGroups((prev) => prev.map((g) => (g.id === group.id ? updated : g)))
    setEditingExtraId(null)
  } catch {
    setEditExtraError(t("extraEditSaveError"))
  } finally {
    setIsSavingExtra(false)
  }
}
```

- [ ] **Step 3: Update the Extras checklist rendering**

Replace the existing `{extraGroups.map((group) => { ... })}` block with:

```tsx
{extraGroups.map((group) => {
  const checked = selectedExtraIds.includes(group.id)
  const option = group.options[0]
  const isEditingThis = editingExtraId === group.id
  return (
    <div key={group.id} className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex flex-1 items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() =>
              setSelectedExtraIds((prev) => (checked ? prev.filter((id) => id !== group.id) : [...prev, group.id]))
            }
            className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
          />
          <span className="text-card-foreground">
            {group.nameVi} / {group.nameEn}
          </span>
        </label>
        <span className="font-medium text-primary">+{formatVND(option.priceDelta)}</span>
        <button
          type="button"
          onClick={() => (isEditingThis ? setEditingExtraId(null) : openExtraEdit(group))}
          aria-label={t("editExtra")}
          title={t("editExtra")}
          className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-secondary/10"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      {isEditingThis && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          {editExtraError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{editExtraError}</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={editExtraNameVi} onChange={(e) => setEditExtraNameVi(e.target.value)} className="h-9" />
            <Input value={editExtraNameEn} onChange={(e) => setEditExtraNameEn(e.target.value)} className="h-9" />
            <Input
              type="number"
              min={0}
              value={editExtraPrice}
              onChange={(e) => setEditExtraPrice(e.target.value)}
              className="h-9"
            />
          </div>
          <RecipeChecklist
            ingredients={ingredientsList}
            selected={editExtraRecipe}
            onChange={setEditExtraRecipe}
            locale={locale}
            emptyLabel={t("noIngredientsForRecipe")}
            quantityPlaceholder={t("recipeQuantityPlaceholder")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingExtraId(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={() => handleSaveExtraEdit(group)} disabled={isSavingExtra}>
              {t("saveExtra")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})}
```

- [ ] **Step 4: Add new translation keys**

`messages/en.json`, inside `"AdminMenu"`:

```json
"editExtra": "Edit extra",
"saveExtra": "Save",
"extraEditSaveError": "Failed to save changes to the extra. Try again.",
```

`messages/vi.json`, inside `"AdminMenu"`:

```json
"editExtra": "Sửa tùy chọn thêm",
"saveExtra": "Lưu",
"extraEditSaveError": "Lưu thay đổi cho tùy chọn thêm thất bại. Vui lòng thử lại.",
```

- [ ] **Step 5: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/menu-item-form.tsx messages/en.json messages/vi.json
git commit -m "Add edit affordance for existing extras (name/price + own recipe)"
```

---

### Task 10: Live verification, docs, and finishing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `daily.md`

**Interfaces:**
- Consumes: the fully wired feature from Tasks 1-9.
- Produces: updated project docs; confirmation of a green build/test/lint
  pipeline; a decision on merge/PR/discard via
  `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Run the full local verification pipeline**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Expected: no type errors; lint clean (or only the pre-existing documented
`react-hooks/set-state-in-effect` baseline count — do not let this task's
changes add a *new* one beyond what Task 5 already accounts for); all
tests pass; build succeeds.

- [ ] **Step 2: Push and wait for the Vercel deployment**

```bash
git push
```

Confirm the resulting deployment on `https://phadincafe.vercel.app`
reaches `Ready` before proceeding (per this project's standing preference
to verify against the live URL, not localhost).

- [ ] **Step 3: Live multi-session verification with Playwright**

Using the existing admin test account (`.env.local`'s
`DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD`), open **two separate browser
contexts** (simulating two admins) both logged in and both on
`/admin/inventory`:

1. In context A: click "+ Add Ingredient", create a new ingredient (e.g.
   "Bột Cacao" / "Cocoa Powder", unit "kg", threshold 5, icon "wheat").
   Confirm it appears in context B's table **without reloading**.
2. In context A: click "Adjust Stock" on any ingredient, add 10. Confirm
   context B's stock number and Logs tab both update live.
3. In context A: click the new pencil icon, edit the ingredient's name.
   Confirm context B's table reflects the rename live.
4. Navigate context A to `/admin/menu`, edit an existing item (e.g.
   "Phin Sữa Đá"), open the new "Recipe" section, check 2 ingredients
   with quantities, save. Re-open the same item's edit form and confirm
   both checked ingredients and their quantities are still there.
5. On the same form, click the pencil on "Extra Shot" (or any existing
   extra), change its price, check one ingredient with a quantity in its
   own Recipe checklist, save. Re-open that extra's edit panel and
   confirm the price and recipe persisted.
6. On the customer-facing Product Detail Page for that item, confirm the
   edited extra's new price is what's shown and selectable (regression
   check — Task 9 must not have broken the customer-facing flow shipped
   last session).
7. Via `mcp__supabase__execute_sql`, confirm `menu_item_ingredients` and
   `modifier_ingredients` each have the expected rows with the right
   `quantity_used` values.

If any check fails, treat it as a real bug per
`superpowers:systematic-debugging` — do not proceed to Step 4 with a
known-broken feature.

- [ ] **Step 4: Update `CLAUDE.md`**

Add a new subsection under "Admin pages" (after the existing "Shared
state across pages" bullet block) documenting: Inventory is now real
Supabase data with Realtime (no more `localStorage`/mock `INITIAL_INGREDIENTS`),
the `adjust_ingredient_stock` RPC and why it's atomic, the new Add/Edit
Ingredient UI, and the new Recipe section on menu items/extras
(`menu_item_ingredients`/`modifier_ingredients` now have real admin-authored
rows, ready for the still-pending Orders sub-project's deduction trigger
to actually consume). Update the "Building the rest" section's inventory
mention to reflect this is done, and note Tables/Orders/Staff accounts
are next per `daily.md`.

- [ ] **Step 5: Update `daily.md`**

Summarize this session: real Inventory data + Realtime shipped, recipe
UI for both menu items and extras built, live multi-session verification
passed. Set the "Next session starts here" pointer to sub-project #2
(Tables) per the decomposition agreed at the start of this project.

- [ ] **Step 6: Commit the docs**

```bash
git add CLAUDE.md daily.md
git commit -m "Document real inventory data + recipes feature as shipped"
```

- [ ] **Step 7: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete
this work." Follow `superpowers:finishing-a-development-branch` — verify
tests, detect environment (this repo has been worked on directly on
`main`, same as every prior feature this session), and since there's
nothing to merge/PR (already on `main`, already pushed), report that
directly, matching how this concluded for the Profile auth-gate and menu
item extras features earlier.
