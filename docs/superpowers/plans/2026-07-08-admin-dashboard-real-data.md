# Admin Dashboard Real Data + Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Admin Dashboard's mock revenue/orders/loyalty KPIs, 7-day chart, and best sellers with real Supabase data (Realtime, Vietnam-local date bucketing), and add a 5-sheet Excel export button.

**Architecture:** One new Postgres RPC (`get_dashboard_stats()`, `security invoker`) computes all aggregates server-side in one round trip. A thin DI'd query-layer function wraps it; a plain hook (matching `useOrderHistory`'s pattern — this data has exactly one consumer, no Context needed) fetches on mount and refetches on any `orders`/`order_items`/`loyalty_transactions` Realtime event. The Excel export runs entirely client-side via the `xlsx` library against data already in the browser (the new hook plus the existing `useInventory`/`useTables`).

**Tech Stack:** Next.js/TypeScript, Supabase Postgres (migration via MCP `apply_migration`), `xlsx` (SheetJS, new dependency), Vitest for `lib/supabase/*.ts`, next-intl for `en`/`vi` copy.

## Global Constraints

- Every new/changed translation key goes into **both** `messages/en.json` and `messages/vi.json` in the same task that introduces it.
- Query-layer functions in `lib/supabase/*.ts` take `SupabaseClient` as their first argument (DI'd, testable with a mocked client) — follow the existing pattern in `lib/supabase/tables-data.ts`/`orders-data.ts`.
- All date bucketing ("today," the 7-day window) is **Vietnam-local** (`Asia/Ho_Chi_Minh`), both in the SQL (already handled in the RPC below) and in any client-side date parsing — parse `YYYY-MM-DD` strings into local `Date` components manually (`new Date(year, month-1, day)`), never `new Date(isoString)`, which parses as UTC and can shift the displayed weekday depending on the browser's timezone.
- Migrations apply live via the Supabase MCP `apply_migration` tool (project `qhiypdqnrnzndxdwqxbx`), verified afterward via `execute_sql`.
- Commit directly to `main` after each task (no feature branch), matching this project's established convention for this session.
- Verification is against the deployed Vercel URL, not `npm run dev` — local `build`/`tsc`/`vitest` are for fast feedback only.
- This data has exactly one consumer (`DashboardView`) — the hook is a plain function like `useOrderHistory`, not a Context+Provider like `useInventory`/`useTables` (which are genuinely shared across multiple pages).

---

### Task 1: Migration — `get_dashboard_stats()` RPC

**Files:**
- Create: `supabase/migrations/0026_dashboard_stats_fn.sql`

**Interfaces:**
- Produces: `get_dashboard_stats()` returns `jsonb` shaped `{ todayRevenue: number, ordersToday: number, loyaltyIssuedToday: number, sevenDayRevenue: { date: string, revenue: number }[], bestSellers: { nameVi: string, nameEn: string, quantitySold: number }[] }`. Keys are already camelCase inside the function — no snake_case mapping needed downstream.

- [ ] **Step 1: Write the migration file**

```sql
-- 0026_dashboard_stats_fn.sql
-- Real Admin Dashboard data: today's revenue/orders/loyalty, a rolling
-- 7-day revenue chart, and best sellers -- all Vietnam-local ("today"
-- via `at time zone 'Asia/Ho_Chi_Minh'`, matching the precedent
-- already set by place-order's VNPay date handling). security invoker,
-- not definer -- orders_select_staff/order_items_select/
-- loyalty_transactions_select_staff already grant staff/manager/admin
-- full read access, and this dashboard is manager/admin-only via
-- middleware anyway. See
-- docs/superpowers/specs/2026-07-08-admin-dashboard-real-data-design.md.

create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_result jsonb;
begin
  select jsonb_build_object(
    'todayRevenue', coalesce((
      select sum(total) from public.orders
      where payment_status = 'paid'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'ordersToday', coalesce((
      select count(*) from public.orders
      where payment_status = 'paid'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'loyaltyIssuedToday', coalesce((
      select sum(points_change) from public.loyalty_transactions
      where type = 'earn'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today
    ), 0),
    'sevenDayRevenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d::date, 'YYYY-MM-DD'), 'revenue', coalesce(r.revenue, 0)
      ) order by d), '[]'::jsonb)
      from generate_series(v_today - 6, v_today, interval '1 day') d
      left join (
        select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, sum(total) as revenue
        from public.orders
        where payment_status = 'paid'
          and (created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_today - 6 and v_today
        group by 1
      ) r on r.day = d::date
    ),
    'bestSellers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nameVi', mi.name_vi, 'nameEn', mi.name_en, 'quantitySold', s.quantity_sold
      ) order by s.quantity_sold desc), '[]'::jsonb)
      from (
        select oi.menu_item_id, sum(oi.quantity) as quantity_sold
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.payment_status = 'paid'
          and (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date between v_today - 6 and v_today
        group by oi.menu_item_id
        order by quantity_sold desc
        limit 3
      ) s
      join public.menu_items mi on mi.id = s.menu_item_id
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_dashboard_stats() to authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `dashboard_stats_fn` and the SQL above.

- [ ] **Step 3: Verify**

```sql
select get_dashboard_stats();
```
Expected: a single jsonb value with all 5 keys present; `sevenDayRevenue` has exactly 7 entries with consecutive dates ending today (Vietnam-local); `bestSellers` has at most 3 entries.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0026_dashboard_stats_fn.sql
git commit -m "Add get_dashboard_stats() RPC for real Admin Dashboard KPIs/chart/best sellers"
```

---

### Task 2: Query layer — `lib/supabase/dashboard-data.ts`

**Files:**
- Create: `lib/supabase/dashboard-data.ts`
- Create: `lib/supabase/dashboard-data.test.ts`

**Interfaces:**
- Consumes: `get_dashboard_stats()` RPC from Task 1.
- Produces: `DashboardStats`, `DashboardDayRevenue`, `DashboardBestSeller` types; `getDashboardStats(supabase): Promise<DashboardStats>`.

- [ ] **Step 1: Write the query-layer file**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"

export type DashboardDayRevenue = { date: string; revenue: number }
export type DashboardBestSeller = { nameVi: string; nameEn: string; quantitySold: number }

export type DashboardStats = {
  todayRevenue: number
  ordersToday: number
  loyaltyIssuedToday: number
  sevenDayRevenue: DashboardDayRevenue[]
  bestSellers: DashboardBestSeller[]
}

export async function getDashboardStats(supabase: SupabaseClient): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("get_dashboard_stats")
  if (error) throw error
  return data as DashboardStats
}
```

- [ ] **Step 2: Write the test file**

```typescript
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getDashboardStats } from "./dashboard-data"

describe("getDashboardStats", () => {
  it("calls the RPC and returns its jsonb result directly", async () => {
    const result = {
      todayRevenue: 500000,
      ordersToday: 12,
      loyaltyIssuedToday: 50,
      sevenDayRevenue: [{ date: "2026-07-08", revenue: 500000 }],
      bestSellers: [{ nameVi: "Phin Sữa Đá", nameEn: "Iced Milk Coffee", quantitySold: 20 }],
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: result, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const stats = await getDashboardStats(supabase)

    expect(rpcSpy).toHaveBeenCalledWith("get_dashboard_stats")
    expect(stats.todayRevenue).toBe(500000)
    expect(stats.ordersToday).toBe(12)
    expect(stats.sevenDayRevenue).toEqual(result.sevenDayRevenue)
    expect(stats.bestSellers).toEqual(result.bestSellers)
  })

  it("propagates an RPC error instead of swallowing it", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: { message: "permission denied" } }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(getDashboardStats(supabase)).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/supabase/dashboard-data.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/dashboard-data.ts lib/supabase/dashboard-data.test.ts
git commit -m "Add dashboard-data query layer wrapping get_dashboard_stats()"
```

---

### Task 3: Date helpers — `lib/format.ts`

**Files:**
- Modify: `lib/format.ts`

**Interfaces:**
- Produces: `parseIsoDateLocal(isoDate: string): Date`; `formatWeekdayShort(isoDate: string, locale: string): string`. Both reused by Task 4 (chart labels) and Task 6 (Excel export's "Day" column) — defined once here to avoid duplicating the UTC-parsing pitfall in two places.

- [ ] **Step 1: Add the two functions**

Add to the end of `lib/format.ts`:

```typescript
/**
 * Parses a "YYYY-MM-DD" string as a LOCAL date, not UTC -- `new
 * Date(isoString)` parses as UTC midnight, which can display as the
 * wrong calendar day depending on the browser's timezone. This app's
 * dates are already Vietnam-local from the source (get_dashboard_stats
 * RPC); this just avoids re-introducing a timezone shift on the way
 * back out.
 */
export function parseIsoDateLocal(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function formatWeekdayShort(isoDate: string, locale: string): string {
  return parseIsoDateLocal(isoDate).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", { weekday: "short" })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/format.ts
git commit -m "Add parseIsoDateLocal/formatWeekdayShort date helpers"
```

---

### Task 4: Hook — `hooks/useDashboardStats.tsx`

**Files:**
- Create: `hooks/useDashboardStats.tsx`

**Interfaces:**
- Consumes: `getDashboardStats` from Task 2.
- Produces: `useDashboardStats(): { stats: DashboardStats, isLoading: boolean }`. Plain hook (not Context) — this data has exactly one consumer, `DashboardView`.

- [ ] **Step 1: Write the hook**

```typescript
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getDashboardStats, type DashboardStats } from "@/lib/supabase/dashboard-data"

export type { DashboardStats }

const EMPTY_STATS: DashboardStats = {
  todayRevenue: 0,
  ordersToday: 0,
  loyaltyIssuedToday: 0,
  sevenDayRevenue: [],
  bestSellers: [],
}

export function useDashboardStats(): { stats: DashboardStats; isLoading: boolean } {
  const [supabase] = useState(() => createClient())
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    function refetch() {
      getDashboardStats(supabase)
        .then((result) => {
          if (!cancelled) setStats(result)
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }

    refetch()

    const channel = supabase
      .channel("dashboard-stats-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        if (!cancelled) refetch()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        if (!cancelled) refetch()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "loyalty_transactions" }, () => {
        if (!cancelled) refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Dashboard stats realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // Runs once on mount; `supabase` is a stable client held in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { stats, isLoading }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useDashboardStats.tsx
git commit -m "Add useDashboardStats hook, Realtime on orders/order_items/loyalty_transactions"
```

---

### Task 5: `dashboard-view.tsx` — swap mocks for real data

**Files:**
- Modify: `components/admin/dashboard-view.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`Dashboard` namespace)

**Interfaces:**
- Consumes: `useDashboardStats` from Task 4; `formatWeekdayShort` from Task 3.

- [ ] **Step 1: Remove the mock constants and add the hook**

Replace:

```typescript
/**
 * No orders/analytics tables yet — revenue/orders/loyalty figures are fixed
 * mock data matching the approved Stitch mockup's example numbers. Becomes
 * a real aggregation query once Supabase's orders/loyalty_transactions
 * exist. Low-stock data below is real, shared state (hooks/useInventory.tsx)
 * — not a separate mock copy.
 */
const MOCK_REVENUE_TODAY = 5420000
const MOCK_ORDERS_TODAY = 142
const MOCK_LOYALTY_ISSUED = 850

const MOCK_REVENUE_BARS = [40, 55, 45, 70, 60, 85, 75] // percent height, Mon-Sun
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const MOCK_BEST_SELLERS = [
  { nameVi: "Phin Sữa Đá", nameEn: "Iced Milk Coffee", sold: 248 },
  { nameVi: "Bánh Mì Que", nameEn: "Crispy Breadsticks", sold: 195 },
  { nameVi: "Trà Đào Cam Sả", nameEn: "Peach Tea", sold: 162 },
]
```

with nothing (delete these constants entirely).

Update the imports:

```typescript
"use client"

import { useTranslations } from "next-intl"
import { Banknote, ShoppingBag, Gift, TriangleAlert, Coffee, Droplet, Wheat, Candy, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatVND, formatWeekdayShort } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useInventory, type IngredientIcon } from "@/hooks/useInventory"
import { useTables } from "@/hooks/useTables"
import { useDashboardStats } from "@/hooks/useDashboardStats"
```

- [ ] **Step 2: Wire the hook into the component**

Replace:

```typescript
export function DashboardView({ locale }: { locale: string }) {
  const t = useTranslations("Dashboard")
  const { ingredients, restock, isLoading } = useInventory()
  const lowStock = ingredients.filter((i) => i.stock < i.threshold)
  const { tables } = useTables()
  const availableCount = tables.filter((tbl) => tbl.status === "available").length
  const occupiedCount = tables.filter((tbl) => tbl.status === "occupied").length
  const cleaningCount = tables.filter((tbl) => tbl.status === "cleaning").length
  const needsCleaningAttention = tables.filter((tbl) => tbl.cleaningNotifiedAt !== null).length
```

with:

```typescript
export function DashboardView({ locale }: { locale: string }) {
  const t = useTranslations("Dashboard")
  const { ingredients, restock, isLoading } = useInventory()
  const lowStock = ingredients.filter((i) => i.stock < i.threshold)
  const { tables } = useTables()
  const availableCount = tables.filter((tbl) => tbl.status === "available").length
  const occupiedCount = tables.filter((tbl) => tbl.status === "occupied").length
  const cleaningCount = tables.filter((tbl) => tbl.status === "cleaning").length
  const needsCleaningAttention = tables.filter((tbl) => tbl.cleaningNotifiedAt !== null).length
  const { stats, isLoading: isStatsLoading } = useDashboardStats()
  const maxRevenue = Math.max(...stats.sevenDayRevenue.map((d) => d.revenue), 1)
```

- [ ] **Step 3: Add the `loadingStats` translation key**

In `messages/en.json`'s `Dashboard` block, add after `"tablesNeedCleaning": "{count} table(s) need cleaning attention"`:

```json
    ,
    "loadingStats": "…"
```

In `messages/vi.json`'s `Dashboard` block, add after `"tablesNeedCleaning": "{count} bàn cần được dọn dẹp"`:

```json
    ,
    "loadingStats": "…"
```

- [ ] **Step 4: Replace the three KPI card values, with a loading state**

Replace:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">{formatVND(MOCK_REVENUE_TODAY)}</h3>
```

with:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : formatVND(stats.todayRevenue)}
          </h3>
```

Replace:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">{MOCK_ORDERS_TODAY}</h3>
```

with:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : stats.ordersToday}
          </h3>
```

Replace:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">{MOCK_LOYALTY_ISSUED}</h3>
```

with:

```typescript
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : stats.loyaltyIssuedToday}
          </h3>
```

This is the loading-state treatment for the KPI row (matching Inventory
Status's `loadingInventory` convention in spirit — a translated
loading label — adapted to fit a single bold number rather than a
table row, since these cards have no room for a full sentence).

- [ ] **Step 5: Replace the chart bars and weekday labels**

Replace:

```typescript
            {MOCK_REVENUE_BARS.map((height, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 rounded-t-lg transition-colors",
                  index === MOCK_REVENUE_BARS.length - 1 ? "bg-primary" : "bg-primary/20 hover:bg-primary/40"
                )}
                style={{ height: `${height}%` }}
              />
            ))}
```

with:

```typescript
            {stats.sevenDayRevenue.map((day, index) => (
              <div
                key={day.date}
                className={cn(
                  "flex-1 rounded-t-lg transition-colors",
                  index === stats.sevenDayRevenue.length - 1 ? "bg-primary" : "bg-primary/20 hover:bg-primary/40"
                )}
                style={{ height: `${(day.revenue / maxRevenue) * 100}%` }}
              />
            ))}
```

Replace:

```typescript
            {WEEKDAY_LABELS.map((day) => (
              <span key={day}>{day}</span>
            ))}
```

with:

```typescript
            {stats.sevenDayRevenue.map((day) => (
              <span key={day.date}>{formatWeekdayShort(day.date, locale)}</span>
            ))}
```

- [ ] **Step 6: Replace best sellers**

Replace:

```typescript
            {MOCK_BEST_SELLERS.map((item) => (
              <div key={item.nameEn} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Coffee className="h-5 w-5" />
                </div>
                <p className="flex-1 truncate text-sm font-bold text-card-foreground">
                  {locale === "vi" ? item.nameVi : item.nameEn}
                </p>
                <div className="text-right">
                  <p className="font-bold text-primary">{item.sold}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("sold")}</p>
                </div>
              </div>
            ))}
```

with:

```typescript
            {stats.bestSellers.map((item, index) => (
              <div key={`${item.nameEn}-${index}`} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Coffee className="h-5 w-5" />
                </div>
                <p className="flex-1 truncate text-sm font-bold text-card-foreground">
                  {locale === "vi" ? item.nameVi : item.nameEn}
                </p>
                <div className="text-right">
                  <p className="font-bold text-primary">{item.quantitySold}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("sold")}</p>
                </div>
              </div>
            ))}
```

- [ ] **Step 7: Commit**

```bash
git add components/admin/dashboard-view.tsx messages/en.json messages/vi.json
git commit -m "Dashboard: replace mock KPIs/chart/best-sellers with real data"
```

---

### Task 6: Excel export

**Files:**
- Modify: `package.json` (add `xlsx` dependency)
- Create: `lib/export-dashboard-excel.ts`
- Modify: `components/admin/dashboard-view.tsx`
- Modify: `messages/en.json`, `messages/vi.json` (`Dashboard` namespace)

**Interfaces:**
- Consumes: `DashboardStats` (Task 2/4), `Ingredient` (`hooks/useInventory.tsx`, already exists — `{ id, nameVi, nameEn, subtitleVi, subtitleEn, unit, stock, threshold, icon }`).
- Produces: `exportDashboardExcel(input: DashboardExportInput): void` — triggers a browser file download, no return value.

- [ ] **Step 1: Add the `xlsx` dependency**

```bash
npm install xlsx
```

`xlsx` ships its own TypeScript definitions — no separate `@types/xlsx` package needed (unlike `qrcode`, which does need `@types/qrcode`).

- [ ] **Step 2: Write the export function**

```typescript
import * as XLSX from "xlsx"
import type { DashboardStats } from "@/hooks/useDashboardStats"
import type { Ingredient } from "@/hooks/useInventory"
import { parseIsoDateLocal } from "@/lib/format"

export type DashboardExportInput = {
  stats: DashboardStats
  lowStock: Ingredient[]
  tableCounts: { available: number; occupied: number; cleaning: number }
  locale: string
}

const VND_FORMAT = '#,##0" đ"'

function applyNumberFormat(sheet: XLSX.WorkSheet, colIndex: number, rowCount: number, format: string): void {
  for (let r = 1; r <= rowCount; r++) {
    const cellRef = XLSX.utils.encode_cell({ r, c: colIndex })
    const cell = sheet[cellRef]
    if (cell) cell.z = format
  }
}

export function exportDashboardExcel(input: DashboardExportInput): void {
  const { stats, lowStock, tableCounts, locale } = input
  const localeTag = locale === "vi" ? "vi-VN" : "en-US"
  const workbook = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet([
    { Metric: "Today's Revenue (VND)", Value: stats.todayRevenue },
    { Metric: "Orders Today", Value: stats.ordersToday },
    { Metric: "Loyalty Points Issued Today", Value: stats.loyaltyIssuedToday },
    { Metric: "Low Stock Alerts", Value: lowStock.length },
    { Metric: "Exported At", Value: new Date().toLocaleString(localeTag) },
  ])
  applyNumberFormat(summarySheet, 1, 1, VND_FORMAT)
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary")

  const revenueSheet = XLSX.utils.json_to_sheet(
    stats.sevenDayRevenue.map((day) => ({
      Date: day.date,
      Day: parseIsoDateLocal(day.date).toLocaleDateString(localeTag, { weekday: "short" }),
      "Revenue (VND)": day.revenue,
    }))
  )
  applyNumberFormat(revenueSheet, 2, stats.sevenDayRevenue.length, VND_FORMAT)
  XLSX.utils.book_append_sheet(workbook, revenueSheet, "7-Day Revenue")

  const bestSellersSheet = XLSX.utils.json_to_sheet(
    stats.bestSellers.map((item) => ({
      "Name (VI)": item.nameVi,
      "Name (EN)": item.nameEn,
      "Quantity Sold": item.quantitySold,
    }))
  )
  XLSX.utils.book_append_sheet(workbook, bestSellersSheet, "Best Sellers")

  const inventorySheet = XLSX.utils.json_to_sheet(
    lowStock.map((item) => ({
      "Product (VI)": item.nameVi,
      "Product (EN)": item.nameEn,
      "Category (VI)": item.subtitleVi,
      "Category (EN)": item.subtitleEn,
      Stock: item.stock,
      Unit: item.unit,
    }))
  )
  XLSX.utils.book_append_sheet(workbook, inventorySheet, "Inventory Status")

  const tableStatusSheet = XLSX.utils.json_to_sheet([
    { Available: tableCounts.available, Occupied: tableCounts.occupied, Cleaning: tableCounts.cleaning },
  ])
  XLSX.utils.book_append_sheet(workbook, tableStatusSheet, "Table Status")

  const todayIso = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `phadincafe-dashboard-${todayIso}.xlsx`)
}
```

- [ ] **Step 3: Add translation keys**

In `messages/en.json`'s `Dashboard` block, add after `"tablesNeedCleaning": "{count} table(s) need cleaning attention"`:

```json
    ,
    "exportExcel": "Export Excel"
```

In `messages/vi.json`'s `Dashboard` block, add after `"tablesNeedCleaning": "{count} bàn cần được dọn dẹp"`:

```json
    ,
    "exportExcel": "Xuất Excel"
```

- [ ] **Step 4: Add the button to `dashboard-view.tsx`**

Add the import:

```typescript
import { FileSpreadsheet } from "lucide-react"
import { exportDashboardExcel } from "@/lib/export-dashboard-excel"
```

(Add `FileSpreadsheet` to the existing `lucide-react` import line rather than a new line.)

Replace the page header:

```typescript
      <div>
        <h2 className="text-2xl font-bold text-card-foreground">{t("overview")}</h2>
        <p className="text-muted-foreground">{t("welcomeMessage")}</p>
      </div>
```

with:

```typescript
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">{t("overview")}</h2>
          <p className="text-muted-foreground">{t("welcomeMessage")}</p>
        </div>
        <Button
          variant="outline"
          className="h-10 gap-2"
          onClick={() =>
            exportDashboardExcel({
              stats,
              lowStock,
              tableCounts: { available: availableCount, occupied: occupiedCount, cleaning: cleaningCount },
              locale,
            })
          }
        >
          <FileSpreadsheet className="h-4 w-4" />
          {t("exportExcel")}
        </Button>
      </div>
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/export-dashboard-excel.ts components/admin/dashboard-view.tsx messages/en.json messages/vi.json
git commit -m "Add Excel export button (5-sheet .xlsx, real numeric cells, VND format)"
```

---

### Task 7: Full verification

- [ ] **Step 1: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the new `dashboard-data.test.ts`.

- [ ] **Step 3: Push to `main`**

```bash
git push
```

- [ ] **Step 4: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app`:
- Admin Dashboard shows real, non-zero KPI numbers matching actual paid orders (cross-check one number, e.g. Orders Today, against Staff Order History filtered to today).
- The 7-day chart's rightmost bar is today and is highlighted; bar heights look proportionally correct; weekday labels are correct for the actual current week.
- Best Sellers reflects real order data from the last 7 days (not the old mock names).
- Place a new paid order and confirm the dashboard updates without a page reload (Realtime).
- Click "Export Excel," open the downloaded file, and confirm: all 5 sheets are present with correct data, Vietnamese names display correctly (no mojibake), and the revenue/quantity columns are real numbers (right-aligned by default, summable — not left-aligned text).
