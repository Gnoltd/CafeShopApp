# Staff Order History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the staff-facing Order History page (search/filter/paginate completed+cancelled orders, plus a detail page), wiring up the existing disabled "Order History" nav link on the Kitchen Display sidebar.

**Architecture:** A new `security invoker` Postgres function `get_order_history()` does server-side search/filter/pagination in one round trip; a plain (non-Context) `useOrderHistory` hook drives the list page's Realtime-refreshed table; the detail page is a server component that 404s via `notFound()` on an unknown order id, following the existing Product Detail Page pattern.

**Tech Stack:** Next.js App Router (server + client components), Supabase (Postgres function + RLS + Realtime `postgres_changes`), next-intl, Vitest with fake-Supabase-client spies.

## Global Constraints

- Migrations are applied to the live hosted Supabase project (`qhiypdqnrnzndxdwqxbx`) via the Supabase MCP server's `apply_migration` tool — not just committed as a file. The latest applied migration is `0018_cancel_pending_order_fn.sql`; this plan's migration is `0019_staff_order_history_fn.sql`.
- Every new translation key goes into **both** `messages/vi.json` and `messages/en.json` in the same task — never one without the other.
- Verification of UI/data-flow behavior targets the live Vercel deployment (`https://phadincafe.vercel.app`), not localhost, per this project's established convention. `npm run build`/`tsc --noEmit` are fine for fast local feedback but are not the source of truth for "does it work."
- Base UI's `Button` has no `asChild` — use `render={<Link .../>}` with `nativeButton={false}` for any polymorphic button-as-link.
- New hand-rolled toggle switches (none needed in this plan) must anchor the thumb with an explicit `left-0.5`, not rely on static positioning — not applicable here, listed only because it's a standing project gotcha.
- Default statuses for order history are `completed`/`cancelled` only; default date range is the last 7 days when neither bound is given — both enforced **inside** the SQL function, not just client-side.

---

### Task 1: `get_order_history()` SQL function

**Files:**
- Create: `supabase/migrations/0019_staff_order_history_fn.sql`

**Interfaces:**
- Produces: a Postgres function `public.get_order_history(p_date_from date, p_date_to date, p_statuses order_status[], p_order_type order_type, p_search text, p_limit int, p_offset int) returns json` callable via `supabase.rpc("get_order_history", {...})`. Returns `{"rows": [...], "totalCount": <int>}`. Each row: `{"id": uuid, "created_at": timestamptz, "order_type": order_type, "table_number": text|null, "customer_name": text|null, "payment_method": payment_method, "status": order_status, "total": integer}`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0019_staff_order_history_fn.sql
-- Staff-facing Order History search: one round trip returning a page of
-- completed/cancelled orders plus a total count, matching p_search
-- against the short order-id prefix, table number, or customer
-- name/phone. security invoker (not definer) — RLS already grants
-- staff/manager/admin full read on orders/tables/profiles via
-- orders_select_staff/tables_select_all/profiles_select_staff, so no
-- bypass is needed. Defaults (completed/cancelled statuses, last-7-days
-- range) are enforced here, not just client-side, so a client bug can't
-- accidentally pull active orders or the whole table's history.

create or replace function public.get_order_history(
  p_date_from date default null,
  p_date_to date default null,
  p_statuses order_status[] default array['completed', 'cancelled']::order_status[],
  p_order_type order_type default null,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
) returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date_to date := coalesce(p_date_to, current_date);
  v_date_from date := coalesce(p_date_from, v_date_to - 7);
  v_from date := least(v_date_from, v_date_to);
  v_to date := greatest(v_date_from, v_date_to);
  v_rows json;
  v_total bigint;
begin
  select count(*) into v_total
  from public.orders o
  left join public.tables tb on tb.id = o.table_id
  left join public.profiles p on p.id = o.customer_id
  where o.status = any(p_statuses)
    and o.created_at::date between v_from and v_to
    and (p_order_type is null or o.order_type = p_order_type)
    and (
      p_search is null or p_search = '' or
      o.id::text ilike p_search || '%' or
      tb.table_number ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.phone ilike '%' || p_search || '%'
    );

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_rows
  from (
    select
      o.id,
      o.created_at,
      o.order_type,
      tb.table_number as table_number,
      p.full_name as customer_name,
      o.payment_method,
      o.status,
      o.total
    from public.orders o
    left join public.tables tb on tb.id = o.table_id
    left join public.profiles p on p.id = o.customer_id
    where o.status = any(p_statuses)
      and o.created_at::date between v_from and v_to
      and (p_order_type is null or o.order_type = p_order_type)
      and (
        p_search is null or p_search = '' or
        o.id::text ilike p_search || '%' or
        tb.table_number ilike '%' || p_search || '%' or
        p.full_name ilike '%' || p_search || '%' or
        p.phone ilike '%' || p_search || '%'
      )
    order by o.created_at desc
    limit p_limit offset p_offset
  ) r;

  return json_build_object('rows', v_rows, 'totalCount', v_total);
end;
$$;

grant execute on function public.get_order_history(date, date, order_status[], order_type, text, int, int) to authenticated;
```

- [ ] **Step 2: Apply the migration to the hosted project**

Use the Supabase MCP server's `apply_migration` tool with `name: "staff_order_history_fn"` and the SQL body above (the tool prefixes the numeric migration id itself — confirm the resulting file matches `0019_staff_order_history_fn.sql` via `list_migrations`).

- [ ] **Step 3: Verify live with a manual RPC call**

Using the Supabase MCP server's `execute_sql` tool (or the SQL editor), run as a staff-role test session (or via `execute_sql` which runs with elevated access — cross-check row counts against a plain `select count(*) from orders where status in ('completed','cancelled')`):

```sql
select public.get_order_history();
```

Expected: a JSON object with `rows` (array, up to 20 items, only `completed`/`cancelled` statuses, all within the last 7 days) and `totalCount` (integer). Then verify search:

```sql
select public.get_order_history(p_search := 'A1B2C3D4');
```

Expected: either an empty `rows` array (if no such id prefix exists) or rows whose `id` starts with that prefix case-insensitively — confirms the `ilike` cast works on the `uuid` column without erroring.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0019_staff_order_history_fn.sql
git commit -m "feat: add get_order_history SQL function for staff order lookup"
```

---

### Task 2: Query layer — `getOrderHistory` / `getOrderHistoryDetail` in `lib/supabase/orders-data.ts`

**Files:**
- Modify: `lib/supabase/orders-data.ts`
- Modify (tests): `lib/supabase/orders-data.test.ts`

**Interfaces:**
- Consumes: `RealOrderStatus`, `RealOrderType`, `OrderType`, `fromRealOrderType`/`toRealOrderType` (already in this file, unchanged).
- Produces:
  ```ts
  export type OrderHistoryFilters = {
    dateFrom?: string   // "YYYY-MM-DD"
    dateTo?: string     // "YYYY-MM-DD"
    statuses?: RealOrderStatus[]
    orderType?: OrderType
    search?: string
  }
  export type OrderHistoryRow = {
    id: string
    createdAt: number
    orderType: OrderType
    table?: string
    customerName?: string
    paymentMethod: "stripe" | "cash" | "vnpay"
    status: RealOrderStatus
    total: number
  }
  export type OrderHistoryPage = { rows: OrderHistoryRow[]; totalCount: number }
  export type OrderHistoryDetail = OrderForTracking & {
    paymentMethod: "stripe" | "cash" | "vnpay"
    paymentStatus: string
    customerName?: string
  }

  export async function getOrderHistory(supabase: SupabaseClient, filters: OrderHistoryFilters, page: { limit: number; offset: number }): Promise<OrderHistoryPage>
  export async function getOrderHistoryDetail(supabase: SupabaseClient, orderId: string): Promise<OrderHistoryDetail | null>
  ```
  These are consumed by Task 3's `useOrderHistory` hook and Task 5's detail page.

- [ ] **Step 1: Write the failing tests**

Append to `lib/supabase/orders-data.test.ts` (add `getOrderHistory`, `getOrderHistoryDetail` to the existing top import list):

```ts
describe("getOrderHistory", () => {
  it("calls the RPC with snake_case params built from camelCase filters", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(
      supabase,
      { dateFrom: "2026-07-01", dateTo: "2026-07-07", statuses: ["completed"], orderType: "dine-in", search: "A1B2" },
      { limit: 20, offset: 0 }
    )

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: "2026-07-01",
      p_date_to: "2026-07-07",
      p_statuses: ["completed"],
      p_order_type: "dine_in",
      p_search: "A1B2",
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("omits order type and passes null search when not provided", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [], totalCount: 0 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(rpcSpy).toHaveBeenCalledWith("get_order_history", {
      p_date_from: null,
      p_date_to: null,
      p_statuses: null,
      p_order_type: null,
      p_search: null,
      p_limit: 20,
      p_offset: 0,
    })
  })

  it("maps snake_case rows to camelCase, translating order_type and defaulting a null customer name to undefined", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "dine_in",
      table_number: "5",
      customer_name: null,
      payment_method: "cash",
      status: "completed",
      total: 60000,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: { rows: [row], totalCount: 1 }, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getOrderHistory(supabase, {}, { limit: 20, offset: 0 })

    expect(result.totalCount).toBe(1)
    expect(result.rows[0]).toEqual({
      id: "ord-1",
      createdAt: new Date("2026-07-06T10:00:00.000Z").getTime(),
      orderType: "dine-in",
      table: "5",
      customerName: undefined,
      paymentMethod: "cash",
      status: "completed",
      total: 60000,
    })
  })
})

describe("getOrderHistoryDetail", () => {
  it("selects a single order by id with the staff detail shape and maps a guest's null profile to an undefined customerName", async () => {
    const row = {
      id: "ord-1",
      created_at: "2026-07-06T10:00:00.000Z",
      order_type: "pickup",
      status: "completed",
      subtotal: 60000,
      discount_amount: 0,
      total: 60000,
      payment_method: "cash",
      payment_status: "paid",
      tables: null,
      profiles: null,
      order_items: [{ quantity: 1, unit_price: 60000, note: null, menu_items: { name_vi: "a", name_en: "b" } }],
    }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "ord-1")

    expect(eqSpy).toHaveBeenCalledWith("id", "ord-1")
    expect(result?.customerName).toBeUndefined()
    expect(result?.paymentMethod).toBe("cash")
    expect(result?.paymentStatus).toBe("paid")
  })

  it("returns null when no matching row is found", async () => {
    const singleSpy = vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } }))
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: singleSpy }) }) }),
    } as unknown as SupabaseClient

    const result = await getOrderHistoryDetail(supabase, "unknown-id")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- orders-data`
Expected: FAIL — `getOrderHistory`/`getOrderHistoryDetail` are not exported from `./orders-data`.

- [ ] **Step 3: Implement `getOrderHistory` and `getOrderHistoryDetail`**

Add to `lib/supabase/orders-data.ts` (after the existing `getMyOrders`, near the other Kds row helpers):

```ts
export type OrderHistoryFilters = {
  dateFrom?: string
  dateTo?: string
  statuses?: RealOrderStatus[]
  orderType?: OrderType
  search?: string
}

export type OrderHistoryRow = {
  id: string
  createdAt: number
  orderType: OrderType
  table?: string
  customerName?: string
  paymentMethod: "stripe" | "cash" | "vnpay"
  status: RealOrderStatus
  total: number
}

export type OrderHistoryPage = { rows: OrderHistoryRow[]; totalCount: number }

type OrderHistoryRpcRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  table_number: string | null
  customer_name: string | null
  payment_method: "stripe" | "cash" | "vnpay"
  status: RealOrderStatus
  total: number
}

function mapOrderHistoryRow(row: OrderHistoryRpcRow): OrderHistoryRow {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    orderType: fromRealOrderType(row.order_type),
    table: row.table_number ?? undefined,
    customerName: row.customer_name ?? undefined,
    paymentMethod: row.payment_method,
    status: row.status,
    total: row.total,
  }
}

export async function getOrderHistory(
  supabase: SupabaseClient,
  filters: OrderHistoryFilters,
  page: { limit: number; offset: number }
): Promise<OrderHistoryPage> {
  const { data, error } = await supabase.rpc("get_order_history", {
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_statuses: filters.statuses ?? null,
    p_order_type: filters.orderType ? toRealOrderType(filters.orderType) : null,
    p_search: filters.search ?? null,
    p_limit: page.limit,
    p_offset: page.offset,
  })
  if (error) throw error
  const result = data as { rows: OrderHistoryRpcRow[]; totalCount: number }
  return { rows: result.rows.map(mapOrderHistoryRow), totalCount: result.totalCount }
}

export type OrderHistoryDetail = OrderForTracking & {
  paymentMethod: "stripe" | "cash" | "vnpay"
  paymentStatus: string
  customerName?: string
}

type OrderHistoryDetailRow = OrderRow & {
  payment_method: "stripe" | "cash" | "vnpay"
  payment_status: string
  profiles: { full_name: string } | null
}

const ORDER_HISTORY_DETAIL_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, total,
  payment_method, payment_status,
  tables ( table_number ),
  profiles ( full_name ),
  order_items ( quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`

export async function getOrderHistoryDetail(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderHistoryDetail | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_HISTORY_DETAIL_SELECT)
    .eq("id", orderId)
    .single()
  if (error) return null
  const row = data as unknown as OrderHistoryDetailRow
  return {
    ...mapOrderRow(row),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    customerName: row.profiles?.full_name ?? undefined,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- orders-data`
Expected: PASS, all `getOrderHistory`/`getOrderHistoryDetail` tests green, and all pre-existing tests in the file still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "feat: add getOrderHistory/getOrderHistoryDetail query-layer functions"
```

---

### Task 3: `useOrderHistory` hook + filter-mapping pure function

**Files:**
- Create: `hooks/useOrderHistory.tsx`
- Create (tests): `hooks/useOrderHistory.test.ts`

**Interfaces:**
- Consumes: `getOrderHistory`, `type OrderHistoryFilters`, `type OrderHistoryRow` from `@/lib/supabase/orders-data`; `createClient` from `@/lib/supabase/client`.
- Produces:
  ```ts
  export function buildDateRange(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string }
  export function useOrderHistory(filters: OrderHistoryFilters, page: number, pageSize: number): {
    rows: OrderHistoryRow[]
    totalCount: number
    isLoading: boolean
  }
  ```
  `useOrderHistory` is consumed by Task 4's `order-history-list.tsx`.

- [ ] **Step 1: Write the failing test for the pure filter-mapping function**

Create `hooks/useOrderHistory.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildDateRange } from "./useOrderHistory"

describe("buildDateRange", () => {
  it("defaults to the last 7 days when neither bound is given", () => {
    const today = new Date().toISOString().slice(0, 10)
    const result = buildDateRange(undefined, undefined)
    expect(result.dateTo).toBe(today)
    expect(new Date(result.dateFrom) < new Date(result.dateTo)).toBe(true)
  })

  it("passes both bounds through unchanged when from <= to", () => {
    expect(buildDateRange("2026-07-01", "2026-07-07")).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-07-07" })
  })

  it("swaps an inverted range instead of erroring", () => {
    expect(buildDateRange("2026-07-07", "2026-07-01")).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-07-07" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useOrderHistory`
Expected: FAIL — `useOrderHistory.tsx` does not exist yet.

- [ ] **Step 3: Implement the hook**

Create `hooks/useOrderHistory.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getOrderHistory, type OrderHistoryFilters, type OrderHistoryRow } from "@/lib/supabase/orders-data"

export function buildDateRange(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string } {
  const to = dateTo ? new Date(dateTo) : new Date()
  const from = dateFrom ? new Date(dateFrom) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  return { dateFrom: lo.toISOString().slice(0, 10), dateTo: hi.toISOString().slice(0, 10) }
}

export function useOrderHistory(filters: OrderHistoryFilters, page: number, pageSize: number) {
  const [supabase] = useState(() => createClient())
  const [rows, setRows] = useState<OrderHistoryRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const { dateFrom, dateTo } = buildDateRange(filters.dateFrom, filters.dateTo)
  const resolvedFilters: OrderHistoryFilters = { ...filters, dateFrom, dateTo }
  const filtersKey = JSON.stringify(resolvedFilters)

  useEffect(() => {
    let cancelled = false

    function refetch() {
      setIsLoading(true)
      getOrderHistory(supabase, resolvedFilters, { limit: pageSize, offset: (page - 1) * pageSize })
        .then(({ rows, totalCount }) => {
          if (!cancelled) {
            setRows(rows)
            setTotalCount(totalCount)
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }

    refetch()

    const channel = supabase
      .channel("order-history-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        if (!cancelled) refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Order history realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize])

  return { rows, totalCount, isLoading }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- useOrderHistory`
Expected: PASS for all three `buildDateRange` cases.

- [ ] **Step 5: Commit**

```bash
git add hooks/useOrderHistory.tsx hooks/useOrderHistory.test.ts
git commit -m "feat: add useOrderHistory hook with Realtime refresh"
```

---

### Task 4: List page — `order-history-list.tsx` + route + translations

**Files:**
- Create: `components/staff/order-history-list.tsx`
- Create: `app/[locale]/staff/orders/history/page.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `useOrderHistory`, `buildDateRange` from `@/hooks/useOrderHistory`; `formatOrderId`, `formatVND` from `@/lib/format`; `type OrderHistoryFilters`, `type OrderHistoryRow`, `type RealOrderStatus` from `@/lib/supabase/orders-data`; `Link` from `@/i18n/navigation`.
- Produces: `export function OrderHistoryList()` (client component, no props — owns its own filter/page state), rendered by the new list page route. Consumed by Task 6's sidebar link (as a navigation target, not an import).

- [ ] **Step 1: Add the `StaffOrderHistory` translation namespace**

In `messages/en.json`, add a new top-level key (alongside `KitchenDisplay`, matching its indentation):

```json
"StaffOrderHistory": {
  "title": "Order History",
  "searchPlaceholder": "Search by order ID, table, name, or phone...",
  "dateRangeLabel": "Date Range",
  "statusAll": "All Statuses",
  "statusCompleted": "Completed",
  "statusCancelled": "Cancelled",
  "orderTypeAll": "All Types",
  "orderTypePickup": "Pickup",
  "orderTypeDineIn": "Dine-in",
  "columnOrderId": "Order ID",
  "columnDateTime": "Date/Time",
  "columnCustomer": "Customer",
  "columnTable": "Table/Type",
  "columnPayment": "Payment",
  "columnStatus": "Status",
  "columnTotal": "Total",
  "guestLabel": "Guest",
  "paginationSummary": "Showing {from}-{to} of {total} orders",
  "previous": "Previous",
  "next": "Next",
  "empty": "No orders match your filters.",
  "loading": "Loading orders…"
}
```

In `messages/vi.json`, add the matching Vietnamese block in the same position:

```json
"StaffOrderHistory": {
  "title": "Lịch Sử Đơn Hàng",
  "searchPlaceholder": "Tìm theo mã đơn, số bàn, tên hoặc SĐT...",
  "dateRangeLabel": "Khoảng Thời Gian",
  "statusAll": "Tất Cả Trạng Thái",
  "statusCompleted": "Hoàn Tất",
  "statusCancelled": "Đã Hủy",
  "orderTypeAll": "Tất Cả Loại",
  "orderTypePickup": "Mang Đi",
  "orderTypeDineIn": "Tại Bàn",
  "columnOrderId": "Mã Đơn",
  "columnDateTime": "Ngày/Giờ",
  "columnCustomer": "Khách Hàng",
  "columnTable": "Bàn/Loại",
  "columnPayment": "Thanh Toán",
  "columnStatus": "Trạng Thái",
  "columnTotal": "Tổng Tiền",
  "guestLabel": "Khách",
  "paginationSummary": "Hiển thị {from}-{to} trong {total} đơn hàng",
  "previous": "Trước",
  "next": "Sau",
  "empty": "Không có đơn hàng phù hợp với bộ lọc.",
  "loading": "Đang tải đơn hàng…"
}
```

- [ ] **Step 2: Implement `order-history-list.tsx`**

Create `components/staff/order-history-list.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Search } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { formatOrderId, formatVND } from "@/lib/format"
import { useOrderHistory, buildDateRange } from "@/hooks/useOrderHistory"
import type { OrderHistoryFilters, RealOrderStatus } from "@/lib/supabase/orders-data"
import type { OrderType } from "@/lib/supabase/orders-data"

const PAGE_SIZE = 20

const STATUS_BADGE: Record<"completed" | "cancelled", string> = {
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

function formatDateTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function OrderHistoryList() {
  const locale = useLocale()
  const t = useTranslations("StaffOrderHistory")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<RealOrderStatus | "all">("all")
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderType | "all">("all")
  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined)
  const [dateTo, setDateTo] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const debounceRef = useRef<number | undefined>(undefined)

  const filters: OrderHistoryFilters = {
    dateFrom,
    dateTo,
    statuses: statusFilter === "all" ? undefined : [statusFilter],
    orderType: orderTypeFilter === "all" ? undefined : orderTypeFilter,
    search: search || undefined,
  }
  const { rows, totalCount, isLoading } = useOrderHistory(filters, page, PAGE_SIZE)

  function resetToFirstPage() {
    setPage(1)
  }

  function handleSearchChange(value: string) {
    setSearchInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setSearch(value)
      resetToFirstPage()
    }, 300)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount)

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-bold text-card-foreground">{t("title")}</h1>

      <div className="mb-3 flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dateFrom ?? buildDateRange(dateFrom, dateTo).dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value)
            resetToFirstPage()
          }}
          className="rounded-lg border bg-card px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={dateTo ?? buildDateRange(dateFrom, dateTo).dateTo}
          onChange={(e) => {
            setDateTo(e.target.value)
            resetToFirstPage()
          }}
          className="rounded-lg border bg-card px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as RealOrderStatus | "all")
            resetToFirstPage()
          }}
          className="rounded-lg border bg-card px-3 py-2 text-sm"
        >
          <option value="all">{t("statusAll")}</option>
          <option value="completed">{t("statusCompleted")}</option>
          <option value="cancelled">{t("statusCancelled")}</option>
        </select>
        <select
          value={orderTypeFilter}
          onChange={(e) => {
            setOrderTypeFilter(e.target.value as OrderType | "all")
            resetToFirstPage()
          }}
          className="rounded-lg border bg-card px-3 py-2 text-sm"
        >
          <option value="all">{t("orderTypeAll")}</option>
          <option value="pickup">{t("orderTypePickup")}</option>
          <option value="dine-in">{t("orderTypeDineIn")}</option>
        </select>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs font-bold uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("columnOrderId")}</th>
                <th className="px-4 py-3">{t("columnDateTime")}</th>
                <th className="px-4 py-3">{t("columnCustomer")}</th>
                <th className="px-4 py-3">{t("columnTable")}</th>
                <th className="px-4 py-3">{t("columnPayment")}</th>
                <th className="px-4 py-3">{t("columnStatus")}</th>
                <th className="px-4 py-3 text-right">{t("columnTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      href={`/staff/orders/history/${order.id}`}
                      className="font-bold text-primary hover:underline"
                    >
                      #{formatOrderId(order.id)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.createdAt, locale)}</td>
                  <td className="px-4 py-3">{order.customerName ?? t("guestLabel")}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {order.orderType === "dine-in" ? order.table : t("orderTypePickup")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{order.paymentMethod}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        STATUS_BADGE[order.status as "completed" | "cancelled"]
                      }`}
                    >
                      {order.status === "completed" ? t("statusCompleted") : t("statusCancelled")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-primary">{formatVND(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("paginationSummary", { from: rangeFrom, to: rangeTo, total: totalCount })}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the list page route**

Create `app/[locale]/staff/orders/history/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { OrderHistoryList } from "@/components/staff/order-history-list"

export default async function OrderHistoryPage() {
  const t = await getTranslations("StaffOrderHistory")
  return (
    <div className="h-full overflow-y-auto">
      <h1 className="sr-only">{t("title")}</h1>
      <OrderHistoryList />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by these files.

- [ ] **Step 5: Commit**

```bash
git add components/staff/order-history-list.tsx app/[locale]/staff/orders/history/page.tsx messages/vi.json messages/en.json
git commit -m "feat: add staff Order History list page"
```

---

### Task 5: Detail page — `order-history-detail.tsx` + route + translations

**Files:**
- Create: `components/staff/order-history-detail.tsx`
- Create: `app/[locale]/staff/orders/history/[orderId]/page.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `getOrderHistoryDetail`, `type OrderHistoryDetail` from `@/lib/supabase/orders-data`; `createClient` from `@/lib/supabase/server`; `formatOrderId`, `formatVND` from `@/lib/format`; `Link` from `@/i18n/navigation`; Next's `notFound` from `next/navigation`.
- Produces: `export function OrderHistoryDetailView({ order }: { order: OrderHistoryDetail })`, rendered by the new detail page route.

- [ ] **Step 1: Add detail-page translation keys**

Extend the `StaffOrderHistory` block added in Task 4 — in `messages/en.json`, add after `"loading"`:

```json
"backToList": "Back to Order History",
"orderDetailsHeading": "Order Details",
"itemCount": "{count, plural, one {# item} other {# items}}",
"subtotal": "Subtotal",
"discount": "Discount",
"total": "Total",
"paymentMethodLabel": "Payment Method",
"paymentStatusLabel": "Payment Status",
"customerLabel": "Customer",
"tableLabel": "Table {table}",
"pickupBadge": "Pickup"
```

In `messages/vi.json`, add after `"loading"`:

```json
"backToList": "Quay Lại Lịch Sử Đơn Hàng",
"orderDetailsHeading": "Chi Tiết Đơn Hàng",
"itemCount": "{count, plural, one {# món} other {# món}}",
"subtotal": "Tạm Tính",
"discount": "Giảm Giá",
"total": "Tổng Cộng",
"paymentMethodLabel": "Phương Thức Thanh Toán",
"paymentStatusLabel": "Trạng Thái Thanh Toán",
"customerLabel": "Khách Hàng",
"tableLabel": "Bàn {table}",
"pickupBadge": "Mang Đi"
```

- [ ] **Step 2: Implement `order-history-detail.tsx`**

Create `components/staff/order-history-detail.tsx`:

```tsx
"use client"

import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { formatOrderId, formatVND } from "@/lib/format"
import type { OrderHistoryDetail } from "@/lib/supabase/orders-data"

export function OrderHistoryDetailView({ order }: { order: OrderHistoryDetail }) {
  const locale = useLocale()
  const t = useTranslations("StaffOrderHistory")

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/staff/orders/history"
        className="mb-4 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("backToList")}
      </Link>

      <h2 className="mb-1 text-2xl font-bold text-primary">#{formatOrderId(order.id)}</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {order.orderType === "dine-in" ? t("tableLabel", { table: order.table ?? "" }) : t("pickupBadge")}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-muted-foreground">{t("customerLabel")}</p>
          <p className="font-bold text-card-foreground">{order.customerName ?? t("guestLabel")}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-muted-foreground">{t("paymentMethodLabel")}</p>
          <p className="font-bold text-card-foreground">{order.paymentMethod}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-muted-foreground">{t("paymentStatusLabel")}</p>
          <p className="font-bold text-card-foreground">{order.paymentStatus}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-muted-foreground">{t("columnStatus")}</p>
          <p className="font-bold text-card-foreground">
            {order.status === "completed" ? t("statusCompleted") : t("statusCancelled")}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-lg font-semibold text-card-foreground">{t("orderDetailsHeading")}</h3>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-secondary">
            {t("itemCount", { count: order.items.length })}
          </span>
        </div>
        <div className="space-y-2">
          {order.items.map((item, index) => (
            <div key={index} className="flex items-center justify-between rounded-xl p-3">
              <div>
                <h5 className="font-bold text-card-foreground">
                  {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                </h5>
                {item.note && <p className="text-xs italic text-accent-foreground">+ {item.note}</p>}
              </div>
              <span className="text-sm font-bold text-primary">{formatVND(item.unitPrice * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-xl bg-muted p-4">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("subtotal")}</span>
            <span>{formatVND(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("discount")}</span>
            <span className="text-destructive">-{formatVND(order.discount)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="font-bold text-card-foreground">{t("total")}</span>
            <span className="text-xl font-black text-primary">{formatVND(order.total)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Create the detail page route**

Create `app/[locale]/staff/orders/history/[orderId]/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { OrderHistoryDetailView } from "@/components/staff/order-history-detail"
import { createClient } from "@/lib/supabase/server"
import { getOrderHistoryDetail } from "@/lib/supabase/orders-data"

export default async function OrderHistoryDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const supabase = await createClient()
  const order = await getOrderHistoryDetail(supabase, orderId)
  if (!order) notFound()

  return <OrderHistoryDetailView order={order} />
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/staff/order-history-detail.tsx "app/[locale]/staff/orders/history/[orderId]/page.tsx" messages/vi.json messages/en.json
git commit -m "feat: add staff Order History detail page"
```

---

### Task 6: Wire the sidebar's disabled "Order History" link to the real route

**Files:**
- Modify: `components/staff/kitchen-sidebar.tsx`

**Interfaces:**
- Consumes: `Link`, `usePathname` from `@/i18n/navigation` (not currently imported in this file — added here).

- [ ] **Step 1: Replace the disabled button with a real, active-highlighted `Link`**

In `components/staff/kitchen-sidebar.tsx`, change:

```tsx
import { useTranslations } from "next-intl"
import { CookingPot, Gauge, History, Boxes } from "lucide-react"
```

to:

```tsx
import { useTranslations } from "next-intl"
import { CookingPot, Gauge, History, Boxes } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
```

Then inside the component, add before the `return`:

```tsx
const pathname = usePathname()
const isHistoryActive = pathname === "/staff/orders/history"
```

Then replace:

```tsx
        <button
          type="button"
          disabled
          title="Not implemented yet — no staff-facing order history route"
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground opacity-60"
        >
          <History className="h-4 w-4" />
          {t("orderHistoryNav")}
        </button>
```

with:

```tsx
        <Link
          href="/staff/orders/history"
          className={
            isHistoryActive
              ? "flex items-center gap-3 rounded-lg bg-secondary/20 px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <History className="h-4 w-4" />
          {t("orderHistoryNav")}
        </Link>
```

Also update the "Live Orders" item just above it to use the same `isHistoryActive`-style check instead of being unconditionally highlighted, so the two states are mutually exclusive:

Change:

```tsx
        <div className="flex items-center gap-3 rounded-lg bg-secondary/20 px-4 py-3 font-bold text-secondary">
          <Gauge className="h-4 w-4" />
          {t("liveOrders")}
        </div>
```

to:

```tsx
        <Link
          href="/staff/orders"
          className={
            !isHistoryActive
              ? "flex items-center gap-3 rounded-lg bg-secondary/20 px-4 py-3 font-bold text-secondary"
              : "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-muted-foreground hover:bg-muted/40"
          }
        >
          <Gauge className="h-4 w-4" />
          {t("liveOrders")}
        </Link>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/staff/kitchen-sidebar.tsx
git commit -m "feat: wire Kitchen Display sidebar's Order History link to the real route"
```

---

### Task 7: Deploy and verify live

**Files:** none (verification only)

- [ ] **Step 1: Push to trigger the Vercel deploy**

```bash
git push origin main
```

- [ ] **Step 2: Verify live on `https://phadincafe.vercel.app`**

Log in as the test staff account (`TEST_STAFF_EMAIL`/`TEST_STAFF_PASSWORD` from `.env.local`), and confirm:
- `/staff/orders` (Kitchen Display) → sidebar's "Order History" link is no longer disabled, navigates to `/staff/orders/history`, and highlights correctly (with "Live Orders" no longer highlighted while on this page).
- The list loads with the default last-7-days/completed+cancelled filter.
- Typing a known order's short id (from a completed test order) into the search box returns that order after the debounce.
- Searching by a table number and by a customer's name/phone (if any completed orders have one) also narrows the list correctly.
- Date range, status, and order-type filters narrow results correctly, and changing any filter resets to page 1.
- Pagination's Previous/Next buttons work and disable at the first/last page.
- Clicking a row navigates to `/staff/orders/history/[orderId]` and shows the correct items, notes, totals, payment method/status, and customer name (or "Guest" for a guest checkout order).
- Visiting `/staff/orders/history/<a-made-up-uuid>` shows a 404, not a crash.
- Completing an order elsewhere (e.g. advancing it to `completed` on the Kitchen Display board in another tab) makes it appear in the History list without a manual refresh.

- [ ] **Step 2: Update `CLAUDE.md`**

Add a short new subsection under "Staff pages" (or as its own subsection) documenting: the real staff Order History page now exists at `/staff/orders/history` + `/staff/orders/history/[orderId]`, backed by `get_order_history()` (migration `0019`), reachable from the Kitchen Display sidebar's now-real "Order History" link. Commit this doc update separately:

```bash
git add CLAUDE.md
git commit -m "docs: document the new staff Order History page in CLAUDE.md"
```
