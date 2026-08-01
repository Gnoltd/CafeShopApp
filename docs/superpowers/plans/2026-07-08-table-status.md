# Table Status (Occupancy + Cleaning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tables.is_occupied` (boolean) with a 3-state `status`
enum (`available | occupied | cleaning`), driven automatically by order
lifecycle events via a Postgres trigger, surfaced in KDS (new 4th board
column), Admin Tables, Admin Dashboard, and the guest table-landing page
(with a "Notify staff" action while a table is Cleaning).

**Architecture:** One migration adds the enum column + trigger + guest
RPC (source of truth in Postgres, matching `handle_order_paid`'s
precedent). One query-layer function replaces `setTableOccupied`; one
new query-layer function adds guest notification. Four UI surfaces
consume the same `useTables()` Realtime hook, already wired app-wide.

**Tech Stack:** Next.js/TypeScript/Tailwind, Supabase Postgres (via MCP
`apply_migration`), Vitest for the query-layer tests, next-intl for
`en`/`vi` copy.

## Global Constraints

- Every new/changed translation key must be added to **both**
  `messages/en.json` and `messages/vi.json` in the same task.
- Query-layer functions in `lib/supabase/*.ts` take `SupabaseClient` as
  their first argument (DI'd, testable with a mocked client) — follow
  the existing pattern in `tables-data.ts`.
- Verification is against the deployed Vercel URL, not
  `npm run dev`, per this project's standing convention — local
  `build`/`tsc`/`vitest` are for fast feedback only.
- Commit directly to `main` after each task (no feature branch), per
  this project's established convention for this session.

---

### Task 1: Migration — `table_status` enum, trigger, guest RPC

**Files:**
- Create: `supabase/migrations/0021_table_status.sql`

**Interfaces:**
- Produces: enum type `public.table_occupancy_status` (`'available' |
  'occupied' | 'cleaning'`); `public.tables.status` (not null, default
  `'available'`); `public.tables.cleaning_notified_at` (nullable
  `timestamptz`); trigger `on_order_table_occupancy` on
  `public.orders`; RPC `public.notify_table_cleaning(p_table_id uuid)
  returns public.tables`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0021_table_status.sql
-- Replaces tables.is_occupied (boolean) with a 3-state status enum
-- (available/occupied/cleaning), driven by an orders trigger, plus a
-- guest-safe RPC for flagging an uncleaned table. See
-- docs/superpowers/specs/2026-07-08-table-status-design.md.

create type public.table_occupancy_status as enum ('available', 'occupied', 'cleaning');

alter table public.tables add column status public.table_occupancy_status not null default 'available';
update public.tables set status = case when is_occupied then 'occupied' else 'available' end;
alter table public.tables drop column is_occupied;

alter table public.tables add column cleaning_notified_at timestamptz;

create or replace function public.sync_table_occupancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.order_type = 'dine_in' and new.table_id is not null then
      update public.tables
      set status = 'occupied', cleaning_notified_at = null
      where id = new.table_id;
    end if;
    return new;
  end if;

  if new.table_id is not null
     and new.status in ('completed', 'cancelled')
     and old.status not in ('completed', 'cancelled') then
    if not exists (
      select 1 from public.orders
      where table_id = new.table_id
        and status not in ('completed', 'cancelled')
        and id <> new.id
    ) then
      update public.tables set status = 'cleaning' where id = new.table_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_order_table_occupancy on public.orders;
create trigger on_order_table_occupancy
  after insert or update of status on public.orders
  for each row
  execute function public.sync_table_occupancy();

create or replace function public.notify_table_cleaning(
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
    set cleaning_notified_at = now()
    where id = p_table_id and status = 'cleaning'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'table % not found or not cleaning', p_table_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.notify_table_cleaning(uuid) from public;
grant execute on function public.notify_table_cleaning(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with name
`table_status` and the SQL above (project `qhiypdqnrnzndxdwqxbx`).

- [ ] **Step 3: Verify via `list_tables`/`execute_sql`**

Confirm `public.tables` has `status` (enum, not null, default
`available`) and `cleaning_notified_at` (nullable timestamptz), and
`is_occupied` is gone. Confirm the trigger and RPC exist via
`select proname from pg_proc where proname in ('sync_table_occupancy',
'notify_table_cleaning');`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0021_table_status.sql
git commit -m "Add tables.status enum (available/occupied/cleaning) + occupancy trigger + guest notify RPC"
```

---

### Task 2: Query layer — `tables-data.ts`

**Files:**
- Modify: `lib/supabase/tables-data.ts`
- Modify: `lib/supabase/tables-data.test.ts`

**Interfaces:**
- Consumes: migration from Task 1 (`tables.status`,
  `tables.cleaning_notified_at`, `notify_table_cleaning` RPC).
- Produces: `TableOccupancyStatus = "available" | "occupied" |
  "cleaning"`; `TableRecord.status: TableOccupancyStatus`;
  `TableRecord.cleaningNotifiedAt: string | null`;
  `setTableStatus(supabase, id, status: TableOccupancyStatus):
  Promise<TableRecord>`; `notifyTableCleaning(supabase, id):
  Promise<TableRecord>`. `setTableOccupied` is removed.

- [ ] **Step 1: Update the type, row shape, and mapper**

In `lib/supabase/tables-data.ts`, replace:

```typescript
export type TableRecord = {
  id: string
  number: string
  qrToken: string
  locationVi: string
  locationEn: string
  isOccupied: boolean
  scanCount: number
}
```

with:

```typescript
export type TableOccupancyStatus = "available" | "occupied" | "cleaning"

export type TableRecord = {
  id: string
  number: string
  qrToken: string
  locationVi: string
  locationEn: string
  status: TableOccupancyStatus
  cleaningNotifiedAt: string | null
  scanCount: number
}
```

Replace `TABLE_SELECT`:

```typescript
const TABLE_SELECT =
  "id, table_number, qr_code_token, location_vi, location_en, status, cleaning_notified_at, scan_count"
```

Replace `TableRow`:

```typescript
export type TableRow = {
  id: string
  table_number: string
  qr_code_token: string
  location_vi: string
  location_en: string
  status: TableOccupancyStatus
  cleaning_notified_at: string | null
  scan_count: number
}
```

Replace `mapTableRow`:

```typescript
export function mapTableRow(row: TableRow): TableRecord {
  return {
    id: row.id,
    number: row.table_number,
    qrToken: row.qr_code_token,
    locationVi: row.location_vi,
    locationEn: row.location_en,
    status: row.status,
    cleaningNotifiedAt: row.cleaning_notified_at,
    scanCount: row.scan_count,
  }
}
```

- [ ] **Step 2: Replace `setTableOccupied` with `setTableStatus`**

```typescript
export async function setTableStatus(
  supabase: SupabaseClient,
  id: string,
  status: TableOccupancyStatus
): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ status })
    .eq("id", id)
    .select(TABLE_SELECT)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}
```

- [ ] **Step 3: Add `notifyTableCleaning`**

```typescript
export async function notifyTableCleaning(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("notify_table_cleaning", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}
```

- [ ] **Step 4: Update `tables-data.test.ts` fixtures**

Every row fixture in this file currently has `is_occupied: false` and
expects `isOccupied: false` in the mapped result. Replace each with
`status: "available"` / `cleaning_notified_at: null` in the fixture,
and `status: "available"` / `cleaningNotifiedAt: null` in the expected
mapped output (4 fixtures: `getTables`, `createTable`,
`regenerateQrToken`, `incrementScanCount` describe blocks).

Add two new test blocks:

```typescript
describe("setTableStatus", () => {
  it("updates status and returns the mapped row", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      status: "cleaning",
      cleaning_notified_at: null,
      scan_count: 0,
    }
    const eqSpy = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    const result = await setTableStatus(supabase, "tbl-1", "cleaning")

    expect(updateSpy).toHaveBeenCalledWith({ status: "cleaning" })
    expect(result.status).toBe("cleaning")
  })
})

describe("notifyTableCleaning", () => {
  it("calls the notify_table_cleaning RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      status: "cleaning",
      cleaning_notified_at: "2026-07-08T10:00:00Z",
      scan_count: 0,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await notifyTableCleaning(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("notify_table_cleaning", { p_table_id: "tbl-1" })
    expect(result.cleaningNotifiedAt).toBe("2026-07-08T10:00:00Z")
  })
})
```

Also update the import line to include `setTableStatus` and
`notifyTableCleaning` alongside the existing imports.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/supabase/tables-data.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/tables-data.ts lib/supabase/tables-data.test.ts
git commit -m "Replace tables.isOccupied boolean with 3-state status + notify-cleaning RPC in query layer"
```

---

### Task 3: `useTables.tsx` — expose `setStatus`/`notifyCleaning`

**Files:**
- Modify: `hooks/useTables.tsx`

**Interfaces:**
- Consumes: `setTableStatus`, `notifyTableCleaning`,
  `TableOccupancyStatus` from Task 2.
- Produces: `TablesContextValue.setStatus(id: string, status:
  TableOccupancyStatus): Promise<void>`;
  `TablesContextValue.notifyCleaning(id: string): Promise<void>`.
  `toggleOccupied` is removed (no remaining caller after Task 4/5).

- [ ] **Step 1: Update imports**

Replace the `setTableOccupied` import with `setTableStatus,
notifyTableCleaning` (and re-export `TableOccupancyStatus` alongside
the existing `export type { TableRecord, TableInput }`).

- [ ] **Step 2: Replace `toggleOccupied` with `setStatus`**

```typescript
async function setStatus(id: string, status: TableOccupancyStatus) {
  await setTableStatus(supabase, id, status)
}

async function notifyCleaning(id: string) {
  await notifyTableCleaning(supabase, id)
}
```

Remove the old `toggleOccupied` function (it read `table.isOccupied`,
which no longer exists).

- [ ] **Step 3: Update the context type and provider value**

In `TablesContextValue`, replace `toggleOccupied: (id: string) =>
Promise<void>` with `setStatus: (id: string, status:
TableOccupancyStatus) => Promise<void>` and add `notifyCleaning: (id:
string) => Promise<void>`. Update the `<TablesContext.Provider
value={{ ... }}>` object to match (replace `toggleOccupied` with
`setStatus`, add `notifyCleaning`).

- [ ] **Step 4: Commit**

```bash
git add hooks/useTables.tsx
git commit -m "Expose setStatus/notifyCleaning from useTables, replacing toggleOccupied"
```

---

### Task 4: Admin Tables — 3-state contextual action

**Files:**
- Modify: `components/admin/tables-management.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`AdminTables`
  namespace)

**Interfaces:**
- Consumes: `useTables()`'s `setStatus` from Task 3;
  `TableRecord.status`.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `AdminTables` block, add after
`"markOccupied": "Mark Occupied",`:

```json
    "cleaning": "Cleaning",
    "markCleaning": "Mark Cleaning",
    "cleaningDone": "Cleaning Done",
```

In `messages/vi.json`'s `AdminTables` block, add after
`"markOccupied": "Đánh Dấu Đang Dùng",`:

```json
    "cleaning": "Đang Dọn",
    "markCleaning": "Đánh Dấu Đang Dọn",
    "cleaningDone": "Đã Dọn Xong",
```

- [ ] **Step 2: Replace the occupancy stat + toggle button**

In `components/admin/tables-management.tsx`, replace:

```typescript
  const occupiedCount = tables.filter((table) => table.isOccupied).length
```

with:

```typescript
  const occupiedCount = tables.filter((table) => table.status === "occupied").length
  const cleaningCount = tables.filter((table) => table.status === "cleaning").length
```

Replace the `available` stat card's count expression
`tables.length - occupiedCount` with `tables.filter((table) => table.status === "available").length`,
and add a 4th stat card (matching the existing 3-card grid style,
change `sm:grid-cols-3` to `sm:grid-cols-4`) for Cleaning using
`cleaningCount`, an appropriate icon (e.g. `Sparkles` from
`lucide-react`, already available as a package import elsewhere in
this codebase) and the same `rounded-full` icon-badge treatment as the
other three cards (amber palette: `bg-amber-100 text-amber-700`).

- [ ] **Step 3: Replace the toggle button with a 3-state contextual button**

Replace:

```typescript
              <button
                type="button"
                onClick={() => toggleOccupied(table.id).catch(() => setError(t("updateError")))}
                title={table.isOccupied ? t("markAvailable") : t("markOccupied")}
                className={cn(
                  "inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                  table.isOccupied
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    : "bg-green-100 text-green-700 hover:bg-green-200"
                )}
              >
                {table.isOccupied ? <User className="h-3 w-3" /> : <CircleCheck className="h-3 w-3" />}
                {table.isOccupied ? t("occupied") : t("available")}
              </button>
```

with:

```typescript
              <button
                type="button"
                onClick={() => {
                  const next = table.status === "available" ? "occupied" : table.status === "occupied" ? "cleaning" : "available"
                  setStatus(table.id, next).catch(() => setError(t("updateError")))
                }}
                title={
                  table.status === "available"
                    ? t("markOccupied")
                    : table.status === "occupied"
                      ? t("markCleaning")
                      : t("cleaningDone")
                }
                className={cn(
                  "inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                  table.status === "available" && "bg-green-100 text-green-700 hover:bg-green-200",
                  table.status === "occupied" && "bg-red-100 text-red-700 hover:bg-red-200",
                  table.status === "cleaning" && "bg-amber-100 text-amber-700 hover:bg-amber-200"
                )}
              >
                {table.status === "available" && <CircleCheck className="h-3 w-3" />}
                {table.status === "occupied" && <User className="h-3 w-3" />}
                {table.status === "cleaning" && <Sparkles className="h-3 w-3" />}
                {table.status === "available" ? t("available") : table.status === "occupied" ? t("occupied") : t("cleaning")}
              </button>
```

Update the destructured hook call `const { tables, addTable,
renameTable, updateLocation, toggleOccupied, regenerateToken } =
useTables()` to use `setStatus` instead of `toggleOccupied`, and add
`Sparkles` to the `lucide-react` import list at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add components/admin/tables-management.tsx messages/en.json messages/vi.json
git commit -m "Admin Tables: 3-state contextual status button + Cleaning stat card"
```

---

### Task 5: KDS — literal 4th "Tables" column

**Files:**
- Create: `components/staff/kitchen-tables-column.tsx`
- Modify: `components/staff/kitchen-board.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`KitchenDisplay`
  namespace)

**Interfaces:**
- Consumes: `useTables()` from Task 3 (`tables`, `setStatus`).
- Produces: `KitchenTablesColumn()` — no props, self-contained (reads
  `useTables()` directly, matching how `kitchen-board.tsx`'s sibling
  columns are driven by hook data passed as props from
  `kitchen-display.tsx` — but this column's data source, `useTables`,
  is independent of the orders Context `kitchen-board.tsx` already
  receives as props, so it reads its own hook rather than threading a
  new prop through).

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `KitchenDisplay` block, add after
`"columnReady": "Ready",`:

```json
    "columnTables": "Tables",
    "tableAvailable": "Available",
    "tableOccupied": "Occupied",
    "tableCleaning": "Cleaning",
    "cleaningDone": "Cleaning Done",
    "guestNotified": "Guest notified staff",
```

In `messages/vi.json`'s `KitchenDisplay` block, add after
`"columnReady": "Sẵn Sàng",`:

```json
    "columnTables": "Bàn",
    "tableAvailable": "Trống",
    "tableOccupied": "Đang Dùng",
    "tableCleaning": "Đang Dọn",
    "cleaningDone": "Đã Dọn Xong",
    "guestNotified": "Khách đã báo nhân viên",
```

- [ ] **Step 2: Create `kitchen-tables-column.tsx`**

```typescript
"use client"

import { useLocale, useTranslations } from "next-intl"
import { Bell, CircleCheck, Sparkles, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTables } from "@/hooks/useTables"

export function KitchenTablesColumn() {
  const locale = useLocale()
  const t = useTranslations("KitchenDisplay")
  const { tables, setStatus } = useTables()

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted">
      <header className="flex shrink-0 items-center justify-between bg-zinc-600 p-4 text-white">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {t("columnTables")}
          <span className="rounded bg-white/20 px-2 py-0.5 text-sm">{tables.length}</span>
        </h2>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {tables.map((table) => {
          const location = locale === "vi" ? table.locationVi : table.locationEn
          return (
            <div
              key={table.id}
              className={cn(
                "flex items-center justify-between rounded-lg border p-3",
                table.status === "available" && "bg-green-50 dark:bg-green-950/20",
                table.status === "occupied" && "bg-red-50 dark:bg-red-950/20",
                table.status === "cleaning" && "bg-amber-50 dark:bg-amber-950/20"
              )}
            >
              <div>
                <p className="font-bold text-card-foreground">{table.number}</p>
                {location && <p className="text-xs text-muted-foreground">{location}</p>}
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    table.status === "available" && "bg-green-100 text-green-700",
                    table.status === "occupied" && "bg-red-100 text-red-700",
                    table.status === "cleaning" && "bg-amber-100 text-amber-700"
                  )}
                >
                  {table.status === "available" && <CircleCheck className="h-3 w-3" />}
                  {table.status === "occupied" && <User className="h-3 w-3" />}
                  {table.status === "cleaning" && <Sparkles className="h-3 w-3" />}
                  {table.status === "available"
                    ? t("tableAvailable")
                    : table.status === "occupied"
                      ? t("tableOccupied")
                      : t("tableCleaning")}
                </span>
                {table.status === "cleaning" && table.cleaningNotifiedAt && (
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-destructive">
                    <Bell className="h-3 w-3 animate-pulse" />
                    {t("guestNotified")}
                  </span>
                )}
              </div>
              {table.status === "cleaning" && (
                <button
                  type="button"
                  onClick={() => setStatus(table.id, "available")}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:brightness-110"
                >
                  {t("cleaningDone")}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Wire the 4th column into `kitchen-board.tsx`**

Add the import:

```typescript
import { KitchenTablesColumn } from "@/components/staff/kitchen-tables-column"
```

Change the grid className from `grid h-full grid-cols-1 gap-4
overflow-hidden p-4 md:grid-cols-3` to `grid h-full grid-cols-1 gap-4
overflow-hidden p-4 md:grid-cols-4`.

After the closing `})}` of the `{COLUMNS.map((column) => { ... })}`
block (i.e. as a sibling, still inside the grid `<div>`), add:

```typescript
      <KitchenTablesColumn />
```

- [ ] **Step 4: Commit**

```bash
git add components/staff/kitchen-tables-column.tsx components/staff/kitchen-board.tsx messages/en.json messages/vi.json
git commit -m "KDS: add literal 4th Tables column with 3-state cards and Cleaning Done action"
```

---

### Task 6: Table QR landing — blocked ordering + Notify Staff

**Files:**
- Modify: `components/customer/table-landing.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`TableLanding`
  namespace)

**Interfaces:**
- Consumes: `useTables()`'s `notifyCleaning` from Task 3;
  `TableRecord.status`.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `TableLanding` block, add after
`"backToMenu": "Back to Menu"`:

```json
    ,
    "cleaningTitle": "This Table Is Being Cleaned",
    "cleaningMessage": "We're getting this table ready for the next guest. Please wait a moment.",
    "notifyStaff": "Notify Staff",
    "staffNotified": "Staff Notified"
```

In `messages/vi.json`'s `TableLanding` block, add after
`"backToMenu": "Về Thực Đơn"`:

```json
    ,
    "cleaningTitle": "Bàn Đang Được Dọn Dẹp",
    "cleaningMessage": "Chúng tôi đang chuẩn bị bàn này cho khách tiếp theo. Vui lòng đợi trong giây lát.",
    "notifyStaff": "Báo Nhân Viên",
    "staffNotified": "Đã Báo Nhân Viên"
```

- [ ] **Step 2: Add the Cleaning branch to `table-landing.tsx`**

Add `useState` for the notified flag and the `notifyCleaning` action:

Replace:

```typescript
  const { setActiveTableByToken } = useTables()
  const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
```

with:

```typescript
  const { setActiveTableByToken, notifyCleaning } = useTables()
  const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
  const [notified, setNotified] = useState(false)
```

Add a new branch after the `if (!resolvedTable) { ... }` block and
before the final `return`:

```typescript
  if (resolvedTable.status === "cleaning") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
          <Sparkles className="h-10 w-10 text-amber-700" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("cleaningTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("cleaningMessage")}</p>
        <Button
          className="h-11 w-full rounded-xl"
          disabled={notified}
          onClick={() => notifyCleaning(resolvedTable.id).then(() => setNotified(true))}
        >
          {notified ? t("staffNotified") : t("notifyStaff")}
        </Button>
      </div>
    )
  }
```

Add `Sparkles` to the `lucide-react` import (already imports `MapPin,
AlertCircle` — extend to `MapPin, AlertCircle, Sparkles`).

- [ ] **Step 3: Commit**

```bash
git add components/customer/table-landing.tsx messages/en.json messages/vi.json
git commit -m "Table QR landing: block ordering + Notify Staff while table is Cleaning"
```

---

### Task 7: Admin Dashboard — "Table Status" card

**Files:**
- Modify: `components/admin/dashboard-view.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`Dashboard`
  namespace)

**Interfaces:**
- Consumes: `useTables()` from Task 3.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`'s `Dashboard` block, add after
`"loadingInventory": "Loading inventory…"`:

```json
    ,
    "tableStatus": "Table Status",
    "tableAvailable": "Available",
    "tableOccupied": "Occupied",
    "tableCleaning": "Cleaning",
    "tablesNeedCleaning": "{count} table(s) need cleaning attention"
```

In `messages/vi.json`'s `Dashboard` block, add after
`"loadingInventory": "Đang tải kho hàng…"`:

```json
    ,
    "tableStatus": "Trạng Thái Bàn",
    "tableAvailable": "Trống",
    "tableOccupied": "Đang Dùng",
    "tableCleaning": "Đang Dọn",
    "tablesNeedCleaning": "{count} bàn cần được dọn dẹp"
```

- [ ] **Step 2: Add the card**

Add the import `import { useTables } from "@/hooks/useTables"` and
`Sparkles` to the existing `lucide-react` import line. Add
`const { tables } = useTables()` alongside the existing `useInventory()`
call, and compute:

```typescript
  const availableCount = tables.filter((t) => t.status === "available").length
  const occupiedCount = tables.filter((t) => t.status === "occupied").length
  const cleaningCount = tables.filter((t) => t.status === "cleaning").length
  const needsCleaningAttention = tables.filter((t) => t.cleaningNotifiedAt !== null).length
```

Insert a new card after the closing `</div>` of the Inventory Status
card block (before the final closing `</div>` of the component), in
the same `rounded-xl border bg-card p-5 shadow-sm` style:

```typescript
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="font-bold text-card-foreground">{t("tableStatus")}</h4>
          {needsCleaningAttention > 0 && (
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">
              {t("tablesNeedCleaning", { count: needsCleaningAttention })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-green-50 p-3 text-center dark:bg-green-950/20">
            <p className="text-xl font-bold text-green-700">{availableCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableAvailable")}</p>
          </div>
          <div className="rounded-lg bg-red-50 p-3 text-center dark:bg-red-950/20">
            <p className="text-xl font-bold text-red-700">{occupiedCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableOccupied")}</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-center dark:bg-amber-950/20">
            <p className="text-xl font-bold text-amber-700">{cleaningCount}</p>
            <p className="text-xs text-muted-foreground">{t("tableCleaning")}</p>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/dashboard-view.tsx messages/en.json messages/vi.json
git commit -m "Admin Dashboard: add real-time Table Status card with cleaning-attention alert"
```

---

### Task 8: Full verification

- [ ] **Step 1: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds (confirms every renamed
`isOccupied`/`toggleOccupied`/`setTableOccupied` reference was caught —
grep the repo for those three identifiers first and confirm zero
remaining matches outside this plan/spec/`daily.md`).

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the updated `tables-data.test.ts`.

- [ ] **Step 3: Push to `main`**

```bash
git push
```

- [ ] **Step 4: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app`: place
a dine-in order at a table (via a QR scan or `/table/[qrToken]`),
confirm it shows Occupied in Admin Tables/KDS; complete the order via
KDS, confirm it shows Cleaning (not Available); tap "Cleaning Done" in
the new KDS Tables column, confirm it flips to Available; scan that
same table's QR while it's mid-Cleaning (trigger a new order first, or
manually set status via Admin Tables), confirm the blocked "This Table
Is Being Cleaned" message and a working "Notify Staff" button, and
confirm the notified state shows on the KDS Tables column card.
