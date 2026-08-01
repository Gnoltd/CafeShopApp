# Real Table Data + Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `hooks/useTables.tsx`'s local `useState`+`localStorage`
mock **table directory** with real Supabase-backed data (already-applied
schema from migration `0005_orders.sql`), add Realtime sync across admin
sessions, and support a guest-writable scan counter without weakening the
existing admin-only write RLS on `tables`.

**Architecture:** One new migration (bilingual/occupied/scan-count
columns, a `security definer` scan-increment RPC for guest writes, a
`security invoker` QR-regeneration RPC for admin writes, Realtime
publication) applied via the Supabase MCP tools. One new query module
(`lib/supabase/tables-data.ts`, DI'd like `menu-data.ts`/
`inventory-data.ts`). `hooks/useTables.tsx`'s **table list** becomes a
real Context+Provider that fetches once and subscribes to
`postgres_changes`; its **`activeTable`** (a single tab's "which table am
I ordering at" session) keeps its existing `localStorage` persistence
unchanged — dropping it would silently regress the already-fixed
locale-switch-wipes-state bug class from two sessions ago (see the design
spec's Section 3 for the full reasoning).

**Tech Stack:** Next.js Client Components, `@supabase/supabase-js`
(Realtime via `postgres_changes`), two Postgres `plpgsql` functions (one
`security definer` for guest scan-count writes, one `security invoker`
for admin QR regeneration), Vitest.

## Global Constraints

- Every new/changed piece of UI text needs keys in **both**
  `messages/en.json` and `messages/vi.json`.
- DI convention: every function in `lib/supabase/tables-data.ts` takes
  `supabase: SupabaseClient` as its first argument, unit-tested with a
  fake/spy client — same style as `lib/supabase/menu-data.test.ts`/
  `lib/supabase/inventory-data.test.ts`.
- Every SQL migration is applied via `mcp__supabase__apply_migration`
  against the live project `qhiypdqnrnzndxdwqxbx`, then verified with
  `mcp__supabase__execute_sql` before moving on — same process used for
  migrations `0001`-`0011`.
- `activeTable`'s `localStorage` persistence (key
  `phadincafe-active-table`) is **unchanged** by this plan — only the
  `tables` list's persistence (key `phadincafe-tables`) is removed.
  Don't touch the `activeTable` `useEffect`/hydrate logic beyond making
  `setActiveTableByToken` async.
- Base UI's `Button` has no `asChild` — polymorphic rendering uses
  `render={<Link .../>}` + `nativeButton={false}` (already used correctly
  in `table-landing.tsx`, not touched by this plan).

---

### Task 1: Migration `0012` — bilingual/occupied/scan columns, scan RPC, QR-regen RPC, Realtime publication

**Files:**
- Create: `supabase/migrations/0012_tables_i18n_and_scan_fn.sql`

**Interfaces:**
- Produces: `tables(location_vi, location_en, is_occupied, scan_count)`;
  `public.increment_table_scan_count(p_table_id uuid) returns
  public.tables` (`security definer`); `public.regenerate_table_qr_token(p_table_id
  uuid) returns public.tables` (`security invoker`); `tables` added to
  the `supabase_realtime` publication.

- [ ] **Step 1: Verify pre-conditions**

Use `mcp__supabase__execute_sql`:

```sql
select count(*) as table_rows from public.tables;

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'tables';
```

Expected: `table_rows = 0` (confirms the new `not null` columns below are
safe to add with no data to migrate), and the second query returns **no
rows** (confirms `tables` isn't already in the publication). If either
assumption is false, stop and re-plan this task.

- [ ] **Step 2: Write the migration SQL**

```sql
-- 0012_tables_i18n_and_scan_fn.sql
-- Bilingual location + occupied + scan-count columns on tables
-- (previously mock-only fields with no real columns), a guest-writable
-- scan-count RPC (security definer — a QR-scanning customer has no role
-- and would otherwise be blocked by tables_admin_all), an admin-only
-- QR-token-regeneration RPC (security invoker, matching
-- adjust_ingredient_stock's reasoning), and Realtime replication.

alter table public.tables add column location_vi text not null default '';
alter table public.tables add column location_en text not null default '';
alter table public.tables add column is_occupied boolean not null default false;
alter table public.tables add column scan_count integer not null default 0;

create or replace function public.increment_table_scan_count(
  p_table_id uuid
) returns public.tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tables;
begin
  update public.tables
    set scan_count = scan_count + 1
    where id = p_table_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'table % not found', p_table_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.increment_table_scan_count(uuid) from public;
grant execute on function public.increment_table_scan_count(uuid) to anon, authenticated;

create or replace function public.regenerate_table_qr_token(
  p_table_id uuid
) returns public.tables
language plpgsql
security invoker
as $$
declare
  v_row public.tables;
begin
  update public.tables
    set qr_code_token = encode(gen_random_bytes(16), 'hex')
    where id = p_table_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'table % not found', p_table_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.regenerate_table_qr_token(uuid) to authenticated;

alter publication supabase_realtime add table public.tables;
```

`increment_table_scan_count` is `security definer` with an explicit `set
search_path = public` (standard hardening for definer functions, so it
can't be tricked by a caller-controlled `search_path` into resolving
`public.tables` to something else) and `revoke all ... from public`
before the explicit `grant` — this function bypasses RLS by design, so
its own body is the only thing standing between "any guest can increment
a scan count" and "any guest can do anything to `tables`." The body
only ever updates `scan_count` on the row matching the given id, with no
other parameters — there is no way to smuggle a rename, location change,
or token regeneration through it.

- [ ] **Step 3: Apply the migration**

Use `mcp__supabase__apply_migration` with `name:
"0012_tables_i18n_and_scan_fn"` and the SQL from Step 2 as `query`.

- [ ] **Step 4: Verify the schema, functions, and publication**

Use `mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'tables'
order by ordinal_position;

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('increment_table_scan_count', 'regenerate_table_qr_token');

select grantee, privilege_type
from information_schema.role_routine_grants
where routine_name = 'increment_table_scan_count';

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'tables';
```

Expected: `tables` columns include `location_vi`/`location_en`/
`is_occupied`/`scan_count` alongside the original `id`/`table_number`/
`qr_code_token`; `increment_table_scan_count` shows `security_type =
'DEFINER'`, `regenerate_table_qr_token` shows `'INVOKER'`;
`increment_table_scan_count`'s grants include both `anon` and
`authenticated`; the publication query returns `tables`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_tables_i18n_and_scan_fn.sql
git commit -m "Add bilingual table columns, scan-count + QR-regen RPCs, Realtime publication"
```

---

### Task 2: Query layer — `lib/supabase/tables-data.ts`

**Files:**
- Create: `lib/supabase/tables-data.ts`
- Create: `lib/supabase/tables-data.test.ts`

**Interfaces:**
- Consumes: `tables` table and the two RPCs from Task 1.
- Produces: `TableRecord`, `TableInput` types and `getTables`,
  `createTable`, `renameTable`, `updateTableLocation`,
  `setTableOccupied`, `regenerateQrToken`, `incrementScanCount`,
  `getTableByToken` — used by Task 3 (`hooks/useTables.tsx`).

- [ ] **Step 1: Write the failing test for `getTables`**

```ts
// lib/supabase/tables-data.test.ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getTables } from "./tables-data"

describe("getTables", () => {
  it("maps snake_case DB rows to camelCase TableRecord", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc123",
      location_vi: "Khu vực cửa sổ",
      location_en: "Window Area",
      is_occupied: false,
      scan_count: 3,
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getTables(supabase)

    expect(result).toEqual([
      {
        id: "tbl-1",
        number: "1",
        qrToken: "abc123",
        locationVi: "Khu vực cửa sổ",
        locationEn: "Window Area",
        isOccupied: false,
        scanCount: 3,
      },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/tables-data.test.ts`
Expected: FAIL — `Cannot find module './tables-data'`.

- [ ] **Step 3: Write `tables-data.ts` (all functions)**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type TableRecord = {
  id: string
  number: string
  qrToken: string
  locationVi: string
  locationEn: string
  isOccupied: boolean
  scanCount: number
}

export type TableInput = {
  number: string
  locationVi: string
  locationEn: string
}

const TABLE_SELECT = "id, table_number, qr_code_token, location_vi, location_en, is_occupied, scan_count"

export type TableRow = {
  id: string
  table_number: string
  qr_code_token: string
  location_vi: string
  location_en: string
  is_occupied: boolean
  scan_count: number
}

export function mapTableRow(row: TableRow): TableRecord {
  return {
    id: row.id,
    number: row.table_number,
    qrToken: row.qr_code_token,
    locationVi: row.location_vi,
    locationEn: row.location_en,
    isOccupied: row.is_occupied,
    scanCount: row.scan_count,
  }
}

export async function getTables(supabase: SupabaseClient): Promise<TableRecord[]> {
  const { data, error } = await supabase.from("tables").select(TABLE_SELECT).order("table_number")
  if (error) throw error
  return ((data ?? []) as TableRow[]).map(mapTableRow)
}

export async function createTable(supabase: SupabaseClient, input: TableInput): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .insert({ table_number: input.number, location_vi: input.locationVi, location_en: input.locationEn })
    .select(TABLE_SELECT)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function renameTable(supabase: SupabaseClient, id: string, number: string): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ table_number: number })
    .eq("id", id)
    .select(TABLE_SELECT)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function updateTableLocation(
  supabase: SupabaseClient,
  id: string,
  locationVi: string,
  locationEn: string
): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ location_vi: locationVi, location_en: locationEn })
    .eq("id", id)
    .select(TABLE_SELECT)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function setTableOccupied(
  supabase: SupabaseClient,
  id: string,
  isOccupied: boolean
): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ is_occupied: isOccupied })
    .eq("id", id)
    .select(TABLE_SELECT)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function regenerateQrToken(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("regenerate_table_qr_token", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function incrementScanCount(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("increment_table_scan_count", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function getTableByToken(supabase: SupabaseClient, token: string): Promise<TableRecord | null> {
  const { data, error } = await supabase
    .from("tables")
    .select(TABLE_SELECT)
    .eq("qr_code_token", token)
    .maybeSingle()
  if (error) throw error
  return data ? mapTableRow(data as TableRow) : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/supabase/tables-data.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the remaining tests**

Append to `lib/supabase/tables-data.test.ts`:

```ts
import { getTables, createTable, regenerateQrToken, incrementScanCount, getTableByToken } from "./tables-data"

describe("createTable", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertedRow = {
      id: "tbl-new",
      table_number: "7",
      qr_code_token: "def456",
      location_vi: "Sân vườn",
      location_en: "Garden",
      is_occupied: false,
      scan_count: 0,
    }
    const insertSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createTable(supabase, { number: "7", locationVi: "Sân vườn", locationEn: "Garden" })

    expect(insertSpy).toHaveBeenCalledWith({
      table_number: "7",
      location_vi: "Sân vườn",
      location_en: "Garden",
    })
    expect(result.number).toBe("7")
    expect(result.qrToken).toBe("def456")
  })

  it("propagates a unique-constraint error instead of swallowing it", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint" } }),
      }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    await expect(createTable(supabase, { number: "1", locationVi: "", locationEn: "" })).rejects.toBeTruthy()
  })
})

describe("regenerateQrToken", () => {
  it("calls the regenerate_table_qr_token RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "newtoken",
      location_vi: "",
      location_en: "",
      is_occupied: false,
      scan_count: 0,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await regenerateQrToken(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("regenerate_table_qr_token", { p_table_id: "tbl-1" })
    expect(result.qrToken).toBe("newtoken")
  })
})

describe("incrementScanCount", () => {
  it("calls the increment_table_scan_count RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      is_occupied: false,
      scan_count: 4,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await incrementScanCount(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("increment_table_scan_count", { p_table_id: "tbl-1" })
    expect(result.scanCount).toBe(4)
  })
})

describe("getTableByToken", () => {
  it("returns null when no table matches the token", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getTableByToken(supabase, "nonexistent-token")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run lib/supabase/tables-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/tables-data.ts lib/supabase/tables-data.test.ts
git commit -m "Add tables-data query layer for real tables/scans/QR tokens"
```

---

### Task 3: Rewrite `hooks/useTables.tsx` for real data + Realtime

**Files:**
- Modify: `hooks/useTables.tsx` (full rewrite)

**Interfaces:**
- Consumes: everything from Task 2's `lib/supabase/tables-data.ts`.
- Produces: `useTables()` keeps its exact existing public shape
  (`tables`, `addTable`, `renameTable`, `updateLocation`,
  `toggleOccupied`, `regenerateToken`, `activeTable`,
  `setActiveTableByToken`, `clearActiveTable`) so
  `tables-management.tsx`/`checkout-view.tsx`/`pos-terminal.tsx` need
  minimal changes — except `addTable` now takes a `TableInput` argument
  (Task 6 needs this to supply a real table number) and
  `setActiveTableByToken` is now `async` (Task 4 needs to `await` it).
  Re-exports `TableRecord`/`TableInput` from `tables-data.ts`.

- [ ] **Step 1: Rewrite `hooks/useTables.tsx`**

```tsx
"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import {
  createTable as createTableQuery,
  getTableByToken,
  getTables,
  incrementScanCount,
  mapTableRow,
  regenerateQrToken as regenerateQrTokenQuery,
  renameTable as renameTableQuery,
  setTableOccupied,
  updateTableLocation,
  type TableInput,
  type TableRecord,
  type TableRow,
} from "@/lib/supabase/tables-data"

export type { TableRecord, TableInput }

type TablesContextValue = {
  tables: TableRecord[]
  addTable: (input: TableInput) => Promise<void>
  renameTable: (id: string, number: string) => Promise<void>
  updateLocation: (id: string, locationVi: string, locationEn: string) => Promise<void>
  toggleOccupied: (id: string) => Promise<void>
  regenerateToken: (id: string) => Promise<void>
  activeTable: TableRecord | null
  setActiveTableByToken: (token: string) => Promise<TableRecord | null>
  clearActiveTable: () => void
}

const TablesContext = createContext<TablesContextValue | null>(null)

const ACTIVE_TABLE_STORAGE_KEY = "phadincafe-active-table"

export function TablesProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [tables, setTables] = useState<TableRecord[]>([])
  const [activeTable, setActiveTable] = useState<TableRecord | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const tablesRef = useRef<TableRecord[]>([])

  useEffect(() => {
    tablesRef.current = tables
  }, [tables])

  // activeTable persistence is unchanged from before this hook was
  // rewritten — it must survive a VI/EN locale switch, which remounts
  // this whole provider (see the design spec's Section 3).
  useEffect(() => {
    try {
      const storedActive = window.localStorage.getItem(ACTIVE_TABLE_STORAGE_KEY)
      if (storedActive) setActiveTable(JSON.parse(storedActive))
    } catch {
      // ignore malformed/unavailable storage
    } finally {
      setHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (activeTable) {
      window.localStorage.setItem(ACTIVE_TABLE_STORAGE_KEY, JSON.stringify(activeTable))
    } else {
      window.localStorage.removeItem(ACTIVE_TABLE_STORAGE_KEY)
    }
  }, [activeTable, hydrated])

  useEffect(() => {
    let cancelled = false

    getTables(supabase).then((rows) => {
      if (!cancelled) setTables(rows)
    })

    const channel = supabase
      .channel("tables-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables" },
        (payload: RealtimePostgresChangesPayload<TableRow>) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string }).id
            if (!oldId) return
            setTables((prev) => prev.filter((t) => t.id !== oldId))
            return
          }
          const mapped = mapTableRow(payload.new as TableRow)
          setTables((prev) =>
            prev.some((t) => t.id === mapped.id) ? prev.map((t) => (t.id === mapped.id ? mapped : t)) : [...prev, mapped]
          )
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Tables realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // Runs once on mount; `supabase` is a stable client held in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addTable(input: TableInput) {
    await createTableQuery(supabase, input)
  }

  async function renameTable(id: string, number: string) {
    await renameTableQuery(supabase, id, number)
    setActiveTable((prev) => (prev?.id === id ? { ...prev, number } : prev))
  }

  async function updateLocation(id: string, locationVi: string, locationEn: string) {
    await updateTableLocation(supabase, id, locationVi, locationEn)
    setActiveTable((prev) => (prev?.id === id ? { ...prev, locationVi, locationEn } : prev))
  }

  async function toggleOccupied(id: string) {
    const table = tablesRef.current.find((t) => t.id === id)
    if (!table) return
    await setTableOccupied(supabase, id, !table.isOccupied)
  }

  async function regenerateToken(id: string) {
    await regenerateQrTokenQuery(supabase, id)
  }

  async function setActiveTableByToken(token: string): Promise<TableRecord | null> {
    const found = await getTableByToken(supabase, token)
    if (found) {
      incrementScanCount(supabase, found.id).catch(() => {
        // A missed scan-count increment is a cosmetic admin-stat miss,
        // not something worth failing table resolution over.
      })
    }
    setActiveTable(found)
    return found
  }

  function clearActiveTable() {
    setActiveTable(null)
  }

  return (
    <TablesContext.Provider
      value={{
        tables,
        addTable,
        renameTable,
        updateLocation,
        toggleOccupied,
        regenerateToken,
        activeTable,
        setActiveTableByToken,
        clearActiveTable,
      }}
    >
      {children}
    </TablesContext.Provider>
  )
}

export function useTables(): TablesContextValue {
  const ctx = useContext(TablesContext)
  if (!ctx) throw new Error("useTables must be used within a TablesProvider")
  return ctx
}
```

Note: `renameTable`/`updateLocation` still directly update `activeTable`
optimistically (unlike Inventory's mutations, which rely purely on the
Realtime echo) — this is intentional, not an inconsistency: `activeTable`
is per-tab local state, not part of the shared `tables` list Realtime
keeps in sync, so there's no Realtime event that would ever update it on
its own. Without this direct update, a customer's already-active session
would keep showing a stale table number/location after an admin renames
it mid-visit.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i "useTables\|tables-management\|checkout-view\|pos-terminal\|table-landing"`
Expected: errors in `tables-management.tsx` (old `addTable()` call with
no args) and `table-landing.tsx` (calling the now-async function
synchronously) — both fixed in Tasks 4 and 6. `checkout-view.tsx` should
show no error (it only reads `activeTable`, untouched).

- [ ] **Step 3: Commit**

```bash
git add hooks/useTables.tsx
git commit -m "Rewrite useTables to fetch real table data and subscribe to Realtime"
```

(Leaving the codebase mid-type-error between commits is normal here —
the plan's remaining tasks fix each consumer in turn, same sequencing
`useInventory.tsx`'s rewrite used relative to its consumers.)

---

### Task 4: Update `table-landing.tsx` for the now-async table lookup

**Files:**
- Modify: `components/customer/table-landing.tsx`

**Interfaces:**
- Consumes: `setActiveTableByToken` (now `Promise<TableRecord | null>`)
  from Task 3.

- [ ] **Step 1: Update the resolution effect**

Replace:

```tsx
useEffect(() => {
  setResolvedTable(setActiveTableByToken(qrToken))
  // Runs once per token; setActiveTableByToken is stable within a TablesProvider lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [qrToken])
```

With:

```tsx
useEffect(() => {
  let cancelled = false
  setActiveTableByToken(qrToken).then((table) => {
    if (!cancelled) setResolvedTable(table)
  })
  return () => {
    cancelled = true
  }
  // Runs once per token; setActiveTableByToken is stable within a TablesProvider lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [qrToken])
```

The rest of the component (the `resolvedTable === undefined` "still
resolving" branch, the invalid-token screen, the success screen) is
unchanged — `undefined` now covers real network latency instead of
always resolving on the same tick, which the existing branch already
handles correctly.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i table-landing`
Expected: no output (no errors in this file anymore).

- [ ] **Step 3: Commit**

```bash
git add components/customer/table-landing.tsx
git commit -m "Await the now-async table lookup in table-landing.tsx"
```

---

### Task 5: Fix POS's table dropdown for async-loaded tables

**Files:**
- Modify: `components/staff/pos-terminal.tsx`

**Interfaces:**
- Consumes: `tables` (now async-loaded, starts as `[]`) from Task 3.

- [ ] **Step 1: Add the import**

```tsx
import { useEffect, useMemo, useState } from "react"
```

(adds `useEffect` to the existing `import { useMemo, useState } from "react"` line)

- [ ] **Step 2: Sync `selectedTableId` once `tables` finishes loading**

Add right after the existing `const selectedTable = tables.find((tbl) => tbl.id === selectedTableId) ?? tables[0]` line:

```tsx
useEffect(() => {
  if (!selectedTableId && tables.length > 0) {
    setSelectedTableId(tables[0].id)
  }
}, [tables, selectedTableId])
```

Without this, `<select value={selectedTableId}>` (line 256) renders with
`value=""` after `tables` loads, which matches none of the real UUID
`<option>` values — the dropdown would show no visible selection even
though `selectedTable` itself already resolves correctly via the
`?? tables[0]` fallback used elsewhere in this file.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -i pos-terminal`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add components/staff/pos-terminal.tsx
git commit -m "Fix POS table dropdown selection once tables load asynchronously"
```

---

### Task 6: Admin UI — real "Add Table" + async mutation error handling

**Files:**
- Create: `components/admin/table-form.tsx`
- Modify: `components/admin/tables-management.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `TableInput` from `@/hooks/useTables` (Task 3);
  `addTable`/`renameTable`/`updateLocation`/`toggleOccupied`/
  `regenerateToken` (all now `async`) from `useTables()`.
- Produces: `TableForm` component; a real "+ Add Table" modal; inline
  error surfacing for a table-number collision on add or rename.

- [ ] **Step 1: Create `components/admin/table-form.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TableInput } from "@/hooks/useTables"

export function TableForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (input: TableInput) => Promise<void>
}) {
  const t = useTranslations("AdminTables")
  const [number, setNumber] = useState("")
  const [locationVi, setLocationVi] = useState("")
  const [locationEn, setLocationEn] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    if (!number.trim()) {
      setError(t("tableNumberRequiredError"))
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await onSave({ number: number.trim(), locationVi: locationVi.trim(), locationEn: locationEn.trim() })
    } catch {
      setError(t("tableNumberTakenError"))
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-card-foreground">{t("addTable")}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label={t("cancel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("tableNumberLabel")}</label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("locationViLabel")}</label>
            <Input value={locationVi} onChange={(e) => setLocationVi(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("locationEnLabel")}</label>
            <Input value={locationEn} onChange={(e) => setLocationEn(e.target.value)} className="h-10" />
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

- [ ] **Step 2: Wire it into `components/admin/tables-management.tsx`**

Add imports:

```tsx
import { TableForm } from "@/components/admin/table-form"
```

Add state near the existing `qrCodes` state:

```tsx
const [showAddForm, setShowAddForm] = useState(false)
const [error, setError] = useState<string | null>(null)
```

Replace the "+ Add New Table" button's `onClick`:

```tsx
<Button className="h-10 gap-2" onClick={() => setShowAddForm(true)}>
  <Plus className="h-4 w-4" />
  {t("addTable")}
</Button>
```

Add an error banner right after the header row (matching the pattern in
`inventory-management.tsx`/`menu-management.tsx`):

```tsx
{error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
```

Update `saveEditing` to handle the async rename/location calls and
surface a rename collision:

```tsx
async function saveEditing(id: string) {
  setError(null)
  const trimmed = draftNumber.trim()
  try {
    if (trimmed) await renameTable(id, trimmed)
    await updateLocation(id, draftLocationVi.trim(), draftLocationEn.trim())
    setEditingId(null)
  } catch {
    setError(t("tableNumberTakenError"))
  }
}
```

Update `toggleOccupied`'s and `regenerateToken`'s call sites (the
buttons calling them directly) to swallow-with-error-banner instead of
fire-and-forget, matching the same pattern:

```tsx
onClick={() => toggleOccupied(table.id).catch(() => setError(t("updateError")))}
```

(replaces the existing `onClick={() => toggleOccupied(table.id)}`), and:

```tsx
onClick={() => regenerateToken(table.id).catch(() => setError(t("updateError")))}
```

(replaces the existing `onClick={() => regenerateToken(table.id)}`).

Add the modal render, near the end of the component, after the closing
`</div>` of the table grid:

```tsx
{showAddForm && (
  <TableForm
    onCancel={() => setShowAddForm(false)}
    onSave={async (input) => {
      await addTable(input)
      setShowAddForm(false)
    }}
  />
)}
```

- [ ] **Step 3: Add new translation keys**

`messages/en.json`, inside `"AdminTables"`:

```json
"tableNumberLabel": "Table Number",
"tableNumberRequiredError": "Enter a table number.",
"tableNumberTakenError": "That table number is already taken.",
"updateError": "Failed to update table. Try again."
```

`messages/vi.json`, inside `"AdminTables"`:

```json
"tableNumberLabel": "Số Bàn",
"tableNumberRequiredError": "Vui lòng nhập số bàn.",
"tableNumberTakenError": "Số bàn này đã được sử dụng.",
"updateError": "Cập nhật bàn thất bại. Vui lòng thử lại."
```

- [ ] **Step 4: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors anywhere now (Tasks 3-6 together resolve every
consumer), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/admin/table-form.tsx components/admin/tables-management.tsx messages/en.json messages/vi.json
git commit -m "Add real Add Table UI and async error handling to Admin Tables"
```

---

### Task 7: Live verification, docs, and finishing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `daily.md`

**Interfaces:**
- Consumes: the fully wired feature from Tasks 1-6.
- Produces: updated project docs; confirmation of a green
  build/test/lint pipeline; a decision on merge/PR/discard via
  `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Run the full local verification pipeline**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Expected: no type errors; lint clean (same pre-existing baseline documented
in the Inventory plan — do not let this task's changes add a *new* one);
all tests pass; build succeeds.

- [ ] **Step 2: Push and wait for the Vercel deployment**

```bash
git push
```

Confirm the resulting deployment on `https://phadincafe.vercel.app`
reaches `Ready` before proceeding.

- [ ] **Step 3: Live verification with Playwright**

Two admin sessions (both logged in, both on `/en/admin/tables`):

1. In context A: click "+ Add Table", create a new table (e.g. number
   "99", location "Test Area"). Confirm it appears in context B's grid
   **without reloading**.
2. In context A: rename that table to "98". Confirm B sees the rename
   live. Then try renaming a *different* table to "98" too — confirm the
   collision surfaces `t("tableNumberTakenError")` inline, not a silent
   failure or crash.
3. In context A: toggle the new table's occupied badge. Confirm B sees
   the badge change live.
4. In context A: click "Regenerate Code" on the new table. Confirm the
   QR image visibly changes in A, and B's copy of that table's `qrToken`
   text also updates live.

Guest scan check (no login, matches how a real customer reaches this
page — literally scanning a printed code):

5. In a fresh, unauthenticated browser context, visit
   `/en/table/{the new table's real qr_code_token}` (read the token from
   A's table card). Confirm the "You're ordering at Table 98" (or
   whichever number it ended up renamed to) screen renders.
6. Via `mcp__supabase__execute_sql`, confirm that table's `scan_count`
   incremented by 1 and that the guest request did **not** need to be
   authenticated to do so (the point of the `security definer` RPC).
7. Switch the guest tab's language (VI ⇄ EN via the switcher). Confirm
   the "You're ordering at Table X" state survives the switch (proves
   `activeTable`'s `localStorage` persistence wasn't accidentally broken
   by this plan — this is the specific regression the design spec's
   Section 3 correction was about).

If any check fails, treat it as a real bug per
`superpowers:systematic-debugging` — do not proceed to Step 4 with a
known-broken feature.

- [ ] **Step 4: Clean up test data**

Via `mcp__supabase__execute_sql`, delete the test table(s) created in
Step 3 (matching the Inventory plan's precedent of not leaving synthetic
verification rows in the live database):

```sql
delete from public.tables where table_number in ('98', '99');
```

Verify only the original 6 tables remain:

```sql
select table_number from public.tables order by table_number;
```

- [ ] **Step 5: Update `CLAUDE.md`**

Add a new subsection under "Table identity flow" (or extend the existing
`hooks/useTables.tsx` bullet in the Admin pages section, matching how
Inventory's writeup was structured) documenting: Tables is now real
Supabase data with Realtime for the table **directory**, `activeTable`
deliberately keeps its `localStorage` persistence (state why, briefly,
linking back to the locale-switch gotcha), the guest-writable
`security definer` scan-count RPC and why it needs definer unlike every
other RPC in this project, and that the previously-documented "QR
regen doesn't invalidate an active session" gap is resolved as
"working as intended" (not a remaining gap). Update "Building the rest"
to reflect Tables as done, Orders next.

- [ ] **Step 6: Update `daily.md`**

Summarize this session's Tables work; set "Next session starts here" to
sub-project #3 (Orders — the biggest slice, unifying customer
Checkout/Tracking/History with staff POS/Kitchen Display).

- [ ] **Step 7: Commit the docs**

```bash
git add CLAUDE.md daily.md
git commit -m "Document real table data + realtime feature as shipped"
```

- [ ] **Step 8: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete
this work." Follow `superpowers:finishing-a-development-branch` — verify
tests, detect environment (normal repo, direct `main` work, same as every
prior feature this session), and since there's nothing to merge/PR
(already on `main`, already pushed), report that directly.
