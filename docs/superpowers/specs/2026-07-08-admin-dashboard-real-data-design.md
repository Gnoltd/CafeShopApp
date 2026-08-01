# Admin Dashboard: Real Data + Excel Export — Design

## Problem

`components/admin/dashboard-view.tsx`'s KPI cards (Today's Revenue,
Orders Today, Loyalty Points Issued), the 7-day revenue chart, and the
Best Sellers list are all fixed `MOCK_*` constants — the last piece of
this app with no real backing data (Inventory Status and the Table
Status card on the same page are already real). Separately, there's no
way to get any of this out of the browser as a file for an owner/
accountant to look at.

## Goals

1. Today's Revenue / Orders Today / Loyalty Points Issued become real,
   computed from `orders`/`loyalty_transactions`.
2. The 7-day revenue chart and Best Sellers list become real,
   computed from the same tables plus `order_items`.
3. All of the above stay Realtime, consistent with every other admin
   surface in this app (Inventory, Tables, Orders, Staff, Table Status).
4. An "Export Excel" button produces a genuine `.xlsx` workbook
   covering the whole dashboard (KPIs, 7-day revenue, best sellers,
   inventory status, table status) — with correct number typing and
   Vietnamese text, not a CSV with the usual encoding/number-formatting
   failure modes.

## Non-goals

- Any change to the already-real Inventory Status or Table Status
  cards themselves — the export just reads their existing data.
- Historical date-range selection (e.g. "last month," a date picker)
  for either the dashboard or the export — both are always "today" /
  "rolling 7 days," matching the existing mockup's scope. A richer
  reporting view is a separate future feature, not this one.
- PDF or any other export format — Excel only, per what was asked.
- Server-side export generation — the browser already has everything
  it needs once the dashboard has loaded; no new Edge Function.

## Design

### 1. Timezone: all "today"/"7 day" bucketing is Vietnam-local

Postgres's `now()` defaults to UTC. This app's shop is in Vietnam, and
the existing VNPay integration already established the precedent of
converting to `Asia/Ho_Chi_Minh` explicitly wherever "today" matters
(`toVnpayDateString` in `place-order`). The new RPC (below) buckets
every date the same way — `(created_at at time zone 'Asia/Ho_Chi_Minh')::date`
— so "today" always means the shop's actual calendar day, not a UTC
day that's shifted by up to 7 hours.

### 2. New RPC: `get_dashboard_stats()`

`security invoker`, not `security definer` — `orders_select_staff`,
`order_items_select`, and `loyalty_transactions_select_staff` (all
existing policies) already grant staff/manager/admin full read access
to everything this needs, and the Dashboard page itself is already
manager/admin-only via `middleware.ts`. No RLS bypass required, unlike
the guest-safe RPC pattern used elsewhere in this app.

```sql
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

`generate_series` guarantees all 7 days appear even if a day had zero
paid orders (a plain `group by` would silently omit that day rather
than showing a zero bar).

### 3. Query layer + hook

`lib/supabase/dashboard-data.ts` (new, DI'd like every other query
module) — `getDashboardStats(supabase): Promise<DashboardStats>`
wrapping the RPC, with `DashboardStats` mapping the jsonb shape above
to camelCase (`todayRevenue: number`, `ordersToday: number`,
`loyaltyIssuedToday: number`, `sevenDayRevenue: { date: string; revenue:
number }[]`, `bestSellers: { nameVi: string; nameEn: string;
quantitySold: number }[]`).

`hooks/useDashboardStats.tsx` (new) — same shape as `useInventory`/
`useTables`: fetch on mount, subscribe unfiltered to `postgres_changes`
on `orders`, `order_items`, and `loyalty_transactions` (three
subscriptions on one channel), refetch on any event. Matches this
app's established Realtime convention (unfiltered + refetch, never a
column `filter`, per the documented RLS-interaction gotcha).

### 4. `dashboard-view.tsx` changes

- Replace `MOCK_REVENUE_TODAY`/`MOCK_ORDERS_TODAY`/`MOCK_LOYALTY_ISSUED`
  with `useDashboardStats()`'s `todayRevenue`/`ordersToday`/
  `loyaltyIssuedToday`.
- Replace `MOCK_REVENUE_BARS` (hardcoded percents) with bar heights
  computed relative to the max value in `sevenDayRevenue` (`(day.revenue
  / maxRevenue) * 100`, with a `maxRevenue <= 0` guard to avoid
  division by zero on a totally empty week). Weekday labels come from
  each entry's real `date`, not the fixed `WEEKDAY_LABELS` array —
  locale-aware short weekday name via `Intl.DateTimeFormat` (matching
  `formatDateVN`'s existing pattern in `lib/format.ts`).
- Replace `MOCK_BEST_SELLERS` with `bestSellers` from the hook — same
  card layout, same bilingual name selection by `locale`.
- Add a loading state (skeleton or `isLoading` text, matching
  Inventory Status's existing `t("loadingInventory")` convention) for
  the brief window before the RPC resolves.

### 5. Excel export

New dependency: `xlsx` (SheetJS community edition, MIT). Added to
`package.json` — this app already has precedent for small, well-scoped
frontend dependencies (`jsqr`, `qrcode`), so this isn't a new pattern,
just applied to a new problem.

New `lib/export-dashboard-excel.ts` — a single function,
`exportDashboardExcel(data: { stats: DashboardStats; lowStock:
IngredientRecord[]; tableCounts: { available: number; occupied: number;
cleaning: number }; locale: string })`, called directly from an
"Export Excel" button next to the Dashboard's "Overview" header. Builds
a workbook with 5 sheets using `xlsx`'s `utils.json_to_sheet`/
`utils.book_append_sheet`, then triggers a download via
`XLSX.writeFile(workbook, `phadincafe-dashboard-${todayIsoDate}.xlsx`)`
(SheetJS handles the browser download itself, no manual Blob/anchor
juggling needed):

1. **Summary** — Today's Revenue, Orders Today, Loyalty Issued, Low
   Stock Alerts count, export timestamp (2 columns: label, value).
2. **7-Day Revenue** — Date / Day / Revenue columns, one row per day
   from `sevenDayRevenue`.
3. **Best Sellers** — Name (VI) / Name (EN) / Quantity Sold columns
   (both language columns included so the file isn't locale-locked to
   whichever language the admin happened to be viewing in).
4. **Inventory Status** — Product (bilingual, 2 columns) / Category /
   Stock / Unit, one row per currently-low-stock ingredient.
5. **Table Status** — Available / Occupied / Cleaning counts (3
   columns, 1 data row) — matches the on-screen card; per-table detail
   already lives in Admin → Tables, not duplicated here.

**Number formatting, the actual "format doesn't go wrong" fix**: every
revenue/quantity/count value is written as a genuine numeric cell
(plain JS `number` in the row objects passed to `json_to_sheet`, never
a pre-formatted string like `"5.420.000 đ"`) — then a VND display
format (`#,##0" đ"`) is applied to the revenue columns' cells via
`worksheet[cellRef].z = '#,##0" đ"'` after building the sheet. This
means the cells stay real numbers Excel can sum/sort/chart, while still
*displaying* with VND grouping — solving both halves of "format goes
wrong" (numbers becoming text, and numbers displaying unformatted).
Since the whole file is a genuine `.xlsx` (OOXML), Vietnamese text is
stored as proper UTF-8 with no BOM/encoding step needed at all — that
failure mode (which only affects CSV opened in Excel) doesn't apply
here.

### 6. Testing

- `lib/supabase/dashboard-data.test.ts` — mocked-client tests for
  `getDashboardStats`, following the existing pattern in this codebase
  (mock `supabase.rpc`, assert the call and the camelCase mapping).
- The RPC's date-bucketing logic (Vietnam-local "today," the 7-day
  rolling window, `generate_series` filling zero-revenue days) is
  verified live per this project's established convention for
  Postgres functions (no pg test harness) — place a paid order, confirm
  it appears in `todayRevenue`/`ordersToday`/the correct day's bar in
  `sevenDayRevenue`/`bestSellers`.
- Excel export is verified by actually opening the downloaded file and
  checking: Vietnamese names render correctly, revenue cells are real
  numbers (can be summed/sorted in Excel, not left-aligned text), and
  all 5 sheets are present with the right data.

## Open questions resolved during brainstorming

- **Revenue/Orders definition**: `payment_status = 'paid'`, regardless
  of `orders.status` — a served-but-unpaid Pay Later order doesn't
  count until it's actually paid.
- **Loyalty Issued scope**: today only, matching the other two KPI
  cards' "today" framing, not an all-time total.
- **7-day chart window**: rolling 7 days ending today (dynamic weekday
  labels), not a fixed Mon-Sun calendar week — matches the existing
  mockup's "last bar is always highlighted/today" visual convention.
- **Best Sellers window**: same rolling 7 days as the chart, not
  all-time — keeps the dashboard's two performance widgets telling the
  same "this week" story.
- **Realtime vs refresh-on-load**: Realtime, consistent with every
  other admin surface in this app.
- **Export format**: genuine `.xlsx` via the `xlsx` library, not CSV —
  directly chosen to solve the user's stated "format goes wrong"
  concern (CSV's encoding/number-typing failure modes don't exist for
  a real Excel file).
- **Export scope**: the whole dashboard (5 sheets), not just the KPI
  summary.
