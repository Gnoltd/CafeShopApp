# Shift Closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift open/close with starting cash, per-payment-method transaction breakdown, expected ending cash, and counted-cash over/short — at `/admin/shift`, reachable from the Revenue KPI card and a new sidebar entry.

**Architecture:** One migration adds a `shifts` table (one open shift enforced by partial unique index, manager/admin-only RLS), an `orders.paid_at` column stamped by an unscoped BEFORE trigger, and three one-round-trip JSON RPCs (`open_shift`, `get_shift_report`, `close_shift`). A DI'd `lib/supabase/shift-data.ts` wraps them; a plain `useShift` hook (Realtime-refetch on `orders`) feeds a `ShiftClosing` component with three states (open form → live report + close form → final summary).

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), Next.js App Router, Vitest, next-intl.

## Global Constraints

- Migration file is `supabase/migrations/0031_shift_closing.sql` AND must be applied to the live project via `mcp__supabase__apply_migration` (name: `shift_closing`).
- All money is integer VND (matches `orders.total`).
- New strings go in **both** `messages/en.json` and `messages/vi.json`.
- Query layer is DI'd: `SupabaseClient` as first arg.
- Realtime = unfiltered subscribe + refetch (project convention).
- `/admin/shift` is manager+admin (existing `/admin/*` middleware gate; do NOT add to `ADMIN_ONLY_PREFIXES`).
- Verify against `https://phadincafe.vercel.app`, not just local.

---

### Task 1: Migration 0031 — `shifts` table, `orders.paid_at`, three RPCs

**Files:**
- Create: `supabase/migrations/0031_shift_closing.sql`

**Interfaces:**
- Produces: RPCs `open_shift(p_starting_cash int) returns json`, `get_shift_report(p_shift_id uuid default null) returns json`, `close_shift(p_counted_cash int, p_notes text default null) returns json`. Report JSON shape (camelCase, epoch-ms timestamps): `{ id, openedAt, closedAt, startingCash, countedCash, notes, byMethod: [{ method, count, total }], expectedCash, difference, transactions: [{ id, paidAt, paymentMethod, total }] }`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0031_shift_closing.sql
-- Shift closing: cash-drawer shifts with starting cash, per-method
-- breakdown, expected ending cash, counted cash + over/short.
-- Design: docs/superpowers/specs/2026-07-10-shift-closing-design.md
--
-- orders.paid_at: neither created_at nor updated_at can attribute a
-- payment to a shift window (Pay Later orders are paid long after
-- creation; updated_at moves on every touch). Stamped by an UNSCOPED
-- before-trigger (migration 0024's lesson: no OF column scope) the
-- moment payment_status is 'paid' and paid_at is still null.

alter table public.orders add column paid_at timestamptz;

create or replace function public.set_order_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

create trigger on_order_set_paid_at
  before insert or update on public.orders
  for each row execute function public.set_order_paid_at();

-- One-time backfill: best available approximation for already-paid rows.
update public.orders set paid_at = updated_at
  where payment_status = 'paid' and paid_at is null;

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  starting_cash integer not null,
  counted_cash integer,
  notes text
);

-- One shop, one drawer: at most one open shift at a time.
create unique index shifts_one_open on public.shifts ((true)) where closed_at is null;

alter table public.shifts enable row level security;

create policy "shifts_manager_admin_all" on public.shifts
  for all
  using (public.current_user_role() in ('manager', 'admin'))
  with check (public.current_user_role() in ('manager', 'admin'));

-- Report builder shared by get_shift_report and close_shift.
-- security invoker: shifts RLS is the access gate; orders are already
-- staff-readable (orders_select_staff).
create or replace function public.get_shift_report(p_shift_id uuid default null)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.shifts%rowtype;
  v_window_end timestamptz;
  v_by_method json;
  v_cash_total bigint;
  v_expected bigint;
  v_transactions json;
begin
  if p_shift_id is null then
    select * into s from public.shifts where closed_at is null;
  else
    select * into s from public.shifts where id = p_shift_id;
  end if;
  if s.id is null then
    return null;
  end if;

  v_window_end := coalesce(s.closed_at, now());

  select coalesce(json_agg(row_to_json(m)), '[]'::json) into v_by_method
  from (
    select o.payment_method as method, count(*)::int as count, coalesce(sum(o.total), 0)::bigint as total
    from public.orders o
    where o.payment_status = 'paid'
      and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
      and o.payment_method is not null
    group by o.payment_method
    order by o.payment_method
  ) m;

  select coalesce(sum(o.total), 0) into v_cash_total
  from public.orders o
  where o.payment_status = 'paid'
    and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
    and o.payment_method = 'cash';

  v_expected := s.starting_cash + v_cash_total;

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_transactions
  from (
    select
      o.id,
      (extract(epoch from o.paid_at) * 1000)::bigint as "paidAt",
      o.payment_method as "paymentMethod",
      o.total
    from public.orders o
    where o.payment_status = 'paid'
      and o.paid_at >= s.opened_at and o.paid_at <= v_window_end
      and o.payment_method is not null
    order by o.paid_at desc
  ) r;

  return json_build_object(
    'id', s.id,
    'openedAt', (extract(epoch from s.opened_at) * 1000)::bigint,
    'closedAt', case when s.closed_at is null then null else (extract(epoch from s.closed_at) * 1000)::bigint end,
    'startingCash', s.starting_cash,
    'countedCash', s.counted_cash,
    'notes', s.notes,
    'byMethod', v_by_method,
    'expectedCash', v_expected,
    'difference', case when s.counted_cash is null then null else s.counted_cash - v_expected end,
    'transactions', v_transactions
  );
end;
$$;

create or replace function public.open_shift(p_starting_cash int)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_starting_cash is null or p_starting_cash < 0 then
    raise exception 'invalid_starting_cash';
  end if;
  begin
    insert into public.shifts (opened_by, starting_cash)
      values (auth.uid(), p_starting_cash)
      returning id into v_id;
  exception when unique_violation then
    raise exception 'shift_already_open';
  end;
  return public.get_shift_report(v_id);
end;
$$;

create or replace function public.close_shift(p_counted_cash int, p_notes text default null)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'invalid_counted_cash';
  end if;
  update public.shifts
    set closed_at = now(), closed_by = auth.uid(),
        counted_cash = p_counted_cash, notes = p_notes
    where closed_at is null
    returning id into v_id;
  if v_id is null then
    raise exception 'no_open_shift';
  end if;
  return public.get_shift_report(v_id);
end;
$$;

grant execute on function public.open_shift(int) to authenticated;
grant execute on function public.get_shift_report(uuid) to authenticated;
grant execute on function public.close_shift(int, text) to authenticated;
```

- [ ] **Step 2: Apply to the live project**

Call `mcp__supabase__apply_migration` with name `shift_closing` and the SQL above. Expected: `{"success":true}`.

- [ ] **Step 3: Verify live via SQL**

Via `mcp__supabase__execute_sql`:
1. `select count(*) from orders where payment_status = 'paid' and paid_at is null` → expected `0` (backfill worked).
2. `select public.get_shift_report()` → expected `null` (no open shift; also proves the function runs — note: run as service role bypasses RLS, that's fine for smoke).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0031_shift_closing.sql
git commit -m "Add shifts table, orders.paid_at, and shift open/report/close RPCs"
```

---

### Task 2: `lib/supabase/shift-data.ts` query layer (TDD)

**Files:**
- Create: `lib/supabase/shift-data.ts`
- Test: `lib/supabase/shift-data.test.ts`

**Interfaces:**
- Produces:
  - `type ShiftMethodBreakdown = { method: "cash" | "stripe" | "vnpay"; count: number; total: number }`
  - `type ShiftTransaction = { id: string; paidAt: number; paymentMethod: string; total: number }`
  - `type ShiftReport = { id: string; openedAt: number; closedAt: number | null; startingCash: number; countedCash: number | null; notes: string | null; byMethod: ShiftMethodBreakdown[]; expectedCash: number; difference: number | null; transactions: ShiftTransaction[] }`
  - `getShiftReport(supabase): Promise<ShiftReport | null>`
  - `openShift(supabase, startingCash: number): Promise<ShiftReport>`
  - `closeShift(supabase, countedCash: number, notes?: string): Promise<ShiftReport>`

- [ ] **Step 1: Write the failing tests**

Create `lib/supabase/shift-data.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getShiftReport, openShift, closeShift } from "./shift-data"

const SAMPLE_REPORT = {
  id: "shift-1",
  openedAt: 1752100000000,
  closedAt: null,
  startingCash: 500000,
  countedCash: null,
  notes: null,
  byMethod: [{ method: "cash", count: 2, total: 90000 }],
  expectedCash: 590000,
  difference: null,
  transactions: [{ id: "ord-1", paidAt: 1752101000000, paymentMethod: "cash", total: 45000 }],
}

describe("getShiftReport", () => {
  it("calls the RPC with no shift id and returns the report as-is", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: SAMPLE_REPORT, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const report = await getShiftReport(supabase)

    expect(rpcSpy).toHaveBeenCalledWith("get_shift_report")
    expect(report?.expectedCash).toBe(590000)
    expect(report?.byMethod[0].method).toBe("cash")
  })

  it("returns null when no shift is open", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    expect(await getShiftReport(supabase)).toBeNull()
  })
})

describe("openShift", () => {
  it("passes starting cash to the RPC and returns the fresh report", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: SAMPLE_REPORT, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const report = await openShift(supabase, 500000)

    expect(rpcSpy).toHaveBeenCalledWith("open_shift", { p_starting_cash: 500000 })
    expect(report.startingCash).toBe(500000)
  })

  it("throws when the RPC errors (e.g. shift_already_open)", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("shift_already_open") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(openShift(supabase, 500000)).rejects.toThrow("shift_already_open")
  })
})

describe("closeShift", () => {
  it("passes counted cash and notes to the RPC", async () => {
    const closed = { ...SAMPLE_REPORT, closedAt: 1752110000000, countedCash: 585000, difference: -5000 }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: closed, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const report = await closeShift(supabase, 585000, "drawer short")

    expect(rpcSpy).toHaveBeenCalledWith("close_shift", { p_counted_cash: 585000, p_notes: "drawer short" })
    expect(report.difference).toBe(-5000)
  })

  it("sends null notes when omitted", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: SAMPLE_REPORT, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await closeShift(supabase, 585000)

    expect(rpcSpy).toHaveBeenCalledWith("close_shift", { p_counted_cash: 585000, p_notes: null })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/supabase/shift-data.test.ts`
Expected: FAIL — cannot find module `./shift-data`.

- [ ] **Step 3: Implement**

Create `lib/supabase/shift-data.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type ShiftMethodBreakdown = { method: "cash" | "stripe" | "vnpay"; count: number; total: number }
export type ShiftTransaction = { id: string; paidAt: number; paymentMethod: string; total: number }

export type ShiftReport = {
  id: string
  openedAt: number
  closedAt: number | null
  startingCash: number
  countedCash: number | null
  notes: string | null
  byMethod: ShiftMethodBreakdown[]
  expectedCash: number
  difference: number | null
  transactions: ShiftTransaction[]
}

export async function getShiftReport(supabase: SupabaseClient): Promise<ShiftReport | null> {
  const { data, error } = await supabase.rpc("get_shift_report")
  if (error) throw error
  return data as ShiftReport | null
}

export async function openShift(supabase: SupabaseClient, startingCash: number): Promise<ShiftReport> {
  const { data, error } = await supabase.rpc("open_shift", { p_starting_cash: startingCash })
  if (error) throw error
  return data as ShiftReport
}

export async function closeShift(supabase: SupabaseClient, countedCash: number, notes?: string): Promise<ShiftReport> {
  const { data, error } = await supabase.rpc("close_shift", { p_counted_cash: countedCash, p_notes: notes ?? null })
  if (error) throw error
  return data as ShiftReport
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/supabase/shift-data.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/shift-data.ts lib/supabase/shift-data.test.ts
git commit -m "Add shift-data query layer wrapping the shift RPCs"
```

---

### Task 3: i18n keys (both files)

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Produces: `Nav.shift` and the `AdminShift` namespace — consumed by Task 4.

- [ ] **Step 1: Add `Nav.shift`**

In `messages/en.json`'s `"Nav"` object, after `"foodCost": "Food Cost",`:

```json
    "shift": "Shift",
```

In `messages/vi.json`'s `"Nav"` object, same position:

```json
    "shift": "Ca Làm",
```

- [ ] **Step 2: Add the `AdminShift` namespace**

In `messages/en.json`, as a new top-level namespace (place it right after the `"Dashboard"` namespace's closing brace):

```json
  "AdminShift": {
    "title": "Shift Closing",
    "noShiftTitle": "No shift is open",
    "startingCashLabel": "Starting cash in drawer (VND)",
    "openShiftButton": "Open Shift",
    "openError": "Couldn't open the shift — please try again.",
    "openedAtLabel": "Opened",
    "startingCashStat": "Starting Cash",
    "cashSalesStat": "Cash Sales",
    "expectedCashStat": "Expected Cash in Drawer",
    "byMethodTitle": "Sales by Payment Method",
    "methodCash": "Cash",
    "methodStripe": "Card",
    "methodVnpay": "VNPay",
    "ordersCount": "{count} orders",
    "transactionsTitle": "Transactions This Shift",
    "emptyTransactions": "No paid transactions in this shift yet.",
    "closeShiftTitle": "Close Shift",
    "countedCashLabel": "Counted cash in drawer (VND)",
    "notesLabel": "Note (optional)",
    "closeShiftButton": "Close Shift",
    "closeError": "Couldn't close the shift — please try again.",
    "closedSummaryTitle": "Shift Closed",
    "countedCashStat": "Counted Cash",
    "differenceStat": "Difference",
    "differenceOver": "Over",
    "differenceShort": "Short",
    "differenceExact": "Exact",
    "openNewShift": "Open New Shift",
    "loading": "Loading…"
  },
```

In `messages/vi.json`, same position:

```json
  "AdminShift": {
    "title": "Chốt Ca",
    "noShiftTitle": "Chưa có ca nào đang mở",
    "startingCashLabel": "Tiền mặt đầu ca (VND)",
    "openShiftButton": "Mở Ca",
    "openError": "Không thể mở ca — vui lòng thử lại.",
    "openedAtLabel": "Mở lúc",
    "startingCashStat": "Tiền Đầu Ca",
    "cashSalesStat": "Doanh Thu Tiền Mặt",
    "expectedCashStat": "Tiền Mặt Dự Kiến Trong Két",
    "byMethodTitle": "Doanh Thu Theo Phương Thức",
    "methodCash": "Tiền Mặt",
    "methodStripe": "Thẻ",
    "methodVnpay": "VNPay",
    "ordersCount": "{count} đơn",
    "transactionsTitle": "Giao Dịch Trong Ca",
    "emptyTransactions": "Chưa có giao dịch nào trong ca.",
    "closeShiftTitle": "Chốt Ca",
    "countedCashLabel": "Tiền mặt đếm được (VND)",
    "notesLabel": "Ghi chú (không bắt buộc)",
    "closeShiftButton": "Chốt Ca",
    "closeError": "Không thể chốt ca — vui lòng thử lại.",
    "closedSummaryTitle": "Đã Chốt Ca",
    "countedCashStat": "Tiền Đếm Được",
    "differenceStat": "Chênh Lệch",
    "differenceOver": "Thừa",
    "differenceShort": "Thiếu",
    "differenceExact": "Khớp",
    "openNewShift": "Mở Ca Mới",
    "loading": "Đang tải…"
  },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add Nav.shift and AdminShift translation namespaces"
```

---

### Task 4: `useShift` hook, `ShiftClosing` component, `/admin/shift` route, nav entries

**Files:**
- Create: `hooks/useShift.tsx`
- Create: `components/admin/shift-closing.tsx`
- Create: `app/[locale]/admin/shift/page.tsx`
- Modify: `components/admin/admin-sidebar.tsx` (NAV_ITEMS)
- Modify: `components/admin/dashboard-view.tsx` (Revenue card → Link)

**Interfaces:**
- Consumes: `getShiftReport`/`openShift`/`closeShift` + `ShiftReport` from Task 2; `AdminShift`/`Nav.shift` keys from Task 3.

- [ ] **Step 1: Create `hooks/useShift.tsx`** (plain hook, `useOrderHistory` precedent)

```tsx
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getShiftReport, type ShiftReport } from "@/lib/supabase/shift-data"

export function useShift() {
  const [supabase] = useState(() => createClient())
  const [report, setReport] = useState<ShiftReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    function refetch() {
      getShiftReport(supabase)
        .then((result) => {
          if (!cancelled) setReport(result)
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }

    refetch()

    const channel = supabase
      .channel("shift-report-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        if (!cancelled) refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Shift report realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  return { supabase, report, isLoading, refetch: () => setRefreshKey((k) => k + 1) }
}
```

- [ ] **Step 2: Create `components/admin/shift-closing.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, Clock, Wallet, CreditCard, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatVND, formatOrderId } from "@/lib/format"
import { useShift } from "@/hooks/useShift"
import { openShift, closeShift, type ShiftReport } from "@/lib/supabase/shift-data"

const METHOD_META = {
  cash: { icon: Banknote, labelKey: "methodCash" },
  stripe: { icon: CreditCard, labelKey: "methodStripe" },
  vnpay: { icon: QrCode, labelKey: "methodVnpay" },
} as const

function formatDateTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function ShiftClosing() {
  const t = useTranslations("AdminShift")
  const locale = useLocale()
  const { supabase, report, isLoading, refetch } = useShift()
  const [startingCashInput, setStartingCashInput] = useState("")
  const [countedCashInput, setCountedCashInput] = useState("")
  const [notesInput, setNotesInput] = useState("")
  const [closedSummary, setClosedSummary] = useState<ShiftReport | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOpen() {
    const amount = Number(startingCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      await openShift(supabase, Math.round(amount))
      setStartingCashInput("")
      setClosedSummary(null)
      refetch()
    } catch {
      setError(t("openError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleClose() {
    const amount = Number(countedCashInput)
    if (!Number.isFinite(amount) || amount < 0) return
    setError(null)
    setIsSubmitting(true)
    try {
      const summary = await closeShift(supabase, Math.round(amount), notesInput.trim() || undefined)
      setClosedSummary(summary)
      setCountedCashInput("")
      setNotesInput("")
      refetch()
    } catch {
      setError(t("closeError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
  }

  const active = report

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {closedSummary && !active && (
        <section className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
          <h3 className="mb-3 text-lg font-bold text-card-foreground">{t("closedSummaryTitle")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{t("startingCashStat")}</p>
              <p className="font-bold text-card-foreground">{formatVND(closedSummary.startingCash)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("expectedCashStat")}</p>
              <p className="font-bold text-card-foreground">{formatVND(closedSummary.expectedCash)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("countedCashStat")}</p>
              <p className="font-bold text-card-foreground">{formatVND(closedSummary.countedCash ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("differenceStat")}</p>
              <p
                className={
                  (closedSummary.difference ?? 0) === 0
                    ? "font-bold text-green-600"
                    : (closedSummary.difference ?? 0) > 0
                      ? "font-bold text-amber-600"
                      : "font-bold text-destructive"
                }
              >
                {(closedSummary.difference ?? 0) === 0
                  ? t("differenceExact")
                  : `${(closedSummary.difference ?? 0) > 0 ? t("differenceOver") : t("differenceShort")} ${formatVND(Math.abs(closedSummary.difference ?? 0))}`}
              </p>
            </div>
          </div>
        </section>
      )}

      {!active ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-card-foreground">
            <Wallet className="h-5 w-5 text-primary" />
            {t("noShiftTitle")}
          </h3>
          <label className="mb-1 mt-3 block text-xs font-medium text-muted-foreground">
            {t("startingCashLabel")}
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              value={startingCashInput}
              onChange={(e) => setStartingCashInput(e.target.value)}
              className="h-11 w-full max-w-xs rounded-xl border bg-card px-4 text-card-foreground"
            />
            <Button className="h-11" disabled={isSubmitting || startingCashInput === ""} onClick={handleOpen}>
              {t("openShiftButton")}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {t("openedAtLabel")}: {formatDateTime(active.openedAt, locale)}
              </p>
              <p className="text-xs text-muted-foreground">{t("startingCashStat")}</p>
              <h3 className="text-xl font-bold text-card-foreground">{formatVND(active.startingCash)}</h3>
            </div>
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="mb-1 text-sm text-muted-foreground">{t("cashSalesStat")}</p>
              <h3 className="text-xl font-bold text-card-foreground">
                {formatVND(active.byMethod.find((m) => m.method === "cash")?.total ?? 0)}
              </h3>
            </div>
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-5 shadow-sm">
              <p className="mb-1 text-sm text-muted-foreground">{t("expectedCashStat")}</p>
              <h3 className="text-xl font-bold text-primary">{formatVND(active.expectedCash)}</h3>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="mb-3 font-bold text-card-foreground">{t("byMethodTitle")}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["cash", "stripe", "vnpay"] as const).map((method) => {
                const row = active.byMethod.find((m) => m.method === method)
                const Icon = METHOD_META[method].icon
                return (
                  <div key={method} className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t(METHOD_META[method].labelKey)} · {t("ordersCount", { count: row?.count ?? 0 })}
                      </p>
                      <p className="font-bold text-card-foreground">{formatVND(row?.total ?? 0)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="mb-3 font-bold text-card-foreground">{t("transactionsTitle")}</h3>
            {active.transactions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyTransactions")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {active.transactions.map((txn) => (
                      <tr key={txn.id} className="border-b last:border-0">
                        <td className="px-2 py-2 font-bold text-primary">#{formatOrderId(txn.id)}</td>
                        <td className="px-2 py-2 text-muted-foreground">{formatDateTime(txn.paidAt, locale)}</td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {t(METHOD_META[txn.paymentMethod as keyof typeof METHOD_META]?.labelKey ?? "methodCash")}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-card-foreground">{formatVND(txn.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="mb-3 font-bold text-card-foreground">{t("closeShiftTitle")}</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("countedCashLabel")}</label>
                <input
                  type="number"
                  min="0"
                  value={countedCashInput}
                  onChange={(e) => setCountedCashInput(e.target.value)}
                  className="h-11 w-full rounded-xl border bg-card px-4 text-card-foreground"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("notesLabel")}</label>
                <input
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="h-11 w-full rounded-xl border bg-card px-4 text-card-foreground"
                />
              </div>
              <Button className="h-11" disabled={isSubmitting || countedCashInput === ""} onClick={handleClose}>
                {t("closeShiftButton")}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `app/[locale]/admin/shift/page.tsx`**

```tsx
import { ShiftClosing } from "@/components/admin/shift-closing"

export default function AdminShiftPage() {
  return <ShiftClosing />
}
```

- [ ] **Step 4: Sidebar entry**

In `components/admin/admin-sidebar.tsx`, add to `NAV_ITEMS` after the `foodCost` entry (import `Wallet` from lucide-react alongside the existing icon imports):

```ts
  { href: "/admin/shift", labelKey: "shift", icon: Wallet },
```

- [ ] **Step 5: Make the Revenue KPI card a link**

In `components/admin/dashboard-view.tsx`, replace the Revenue card `div` (the first card in the KPI grid):

```tsx
        <Link
          href="/admin/shift"
          className="rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:shadow-md"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Banknote className="h-5 w-5" />
          </div>
          <p className="mb-1 text-sm text-muted-foreground">{t("todaysRevenue")}</p>
          <h3 className="text-xl font-bold text-card-foreground">
            {isStatsLoading ? t("loadingStats") : formatVND(stats.todayRevenue)}
          </h3>
        </Link>
```

(`Link` is already imported from `@/i18n/navigation` in this file.)

- [ ] **Step 6: Typecheck, full tests, build**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → all pass.
Run: `npx next build` → clean (pre-existing middleware warning only), `/[locale]/admin/shift` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add hooks/useShift.tsx components/admin/shift-closing.tsx "app/[locale]/admin/shift/page.tsx" components/admin/admin-sidebar.tsx components/admin/dashboard-view.tsx
git commit -m "Add /admin/shift shift-closing page, sidebar entry, clickable Revenue card"
```

---

### Task 5: Deploy, live verification, daily.md

**Files:**
- Modify: `daily.md`

- [ ] **Step 1: Push, wait for Vercel deploy (~60-90s)**

```bash
git push
```

- [ ] **Step 2: Live-verify on `https://phadincafe.vercel.app`** (admin test account; credentials via `.env.local`, never hardcoded)

1. Dashboard Revenue card navigates to `/admin/shift`; sidebar shows the new Shift entry.
2. Open a shift with a starting cash amount → live report appears (starting cash, zero breakdown).
3. Place + pay a real cash order (POS is fastest) → report reflects it (cash count/total up, expected cash = starting + total) via Realtime or reload.
4. Close the shift with a counted amount deliberately off by a small amount → final summary shows expected vs counted and the correct over/short.
5. Confirm double-open impossible: with a shift open (repeat open if needed), `open_shift` errors cleanly (UI shows the error message, no crash).
6. Staff test account cannot load `/admin/shift` (middleware redirect).

- [ ] **Step 3: `daily.md` entry + push**

Add a newest-first entry describing the feature (shifts table, `paid_at` + trigger, three RPCs, page states, over/short) and the live verification performed.

```bash
git add daily.md
git commit -m "Docs: log shift closing feature"
git push
```
