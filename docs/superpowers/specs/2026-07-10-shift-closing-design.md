# Shift Closing — starting/ending cash + per-method transaction breakdown

## Problem

The shop has no shift concept: no record of the cash drawer's starting
amount, no expected-cash calculation at close, and no per-shift
breakdown of which payment methods the day's transactions used. User
asked for a Shift Closing feature reachable by clicking the Revenue
KPI card on the Admin Dashboard, with: starting cash recorded at shift
open, expected ending cash calculated at close, and all transactions
during the shift listed and categorized by payment method. Confirmed
additions during design review: a counted-cash input at close with an
over/short difference (the standard point of a shift close), and a
dedicated page rather than a modal.

## Data model (one migration)

New `public.shifts` table:

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `opened_at` | timestamptz not null default `now()` | |
| `closed_at` | timestamptz null | null = the open shift |
| `opened_by` | uuid not null references `profiles(id)` | |
| `closed_by` | uuid null references `profiles(id)` | |
| `starting_cash` | integer not null | VND, whole đồng (matches `orders.total`) |
| `counted_cash` | integer null | entered at close |
| `notes` | text null | optional close note |

A partial unique index (`create unique index shifts_one_open on
public.shifts ((true)) where closed_at is null`) enforces **one open
shift at a time** — one shop, one drawer; multi-register support is
explicitly out of scope. RLS: enabled; select/insert/update only for
`current_user_role() in ('manager', 'admin')`. No delete policy.

**`orders.paid_at timestamptz null`** is also added. Neither
`created_at` nor `updated_at` can attribute a payment to a shift
window — a Pay Later order can be paid long after creation, and
`updated_at` changes on every touch. A small `BEFORE INSERT OR UPDATE`
trigger (`set_order_paid_at`) stamps `paid_at := now()` whenever
`payment_status` becomes `'paid'` and `paid_at` is still null —
following the unscoped-trigger pattern (migration `0024`'s lesson: no
`OF column` scope; the function body gates itself). Existing paid
orders are backfilled with `paid_at = updated_at` (best available
approximation, one-time).

A shift's transactions = orders with `payment_status = 'paid'` and
`paid_at` between `opened_at` and `coalesce(closed_at, now())`. Orders
paid while **no** shift is open belong to no shift — they still count
in the dashboard's daily revenue, just not in any shift report.

## RPCs (one-round-trip JSON, matching `get_dashboard_stats` / `get_order_history`)

All three are `security invoker` + `set search_path = public` — the
`shifts` RLS above is the access gate (staff get an RLS error /
zero rows, which the UI never reaches since `/admin/*` is already
middleware-gated to manager/admin). Orders are already staff-readable
via `orders_select_staff`.

- **`open_shift(p_starting_cash int) returns json`** — inserts a row
  with `opened_by = auth.uid()`, returns it. The unique index makes a
  double-open fail loudly; the function converts that into a clear
  exception message.
- **`get_shift_report(p_shift_id uuid default null) returns json`** —
  for the given shift, or the currently open one when null; returns
  `null` when no shift matches. Payload: the shift row's fields, plus
  `byMethod` (for each of cash/stripe/vnpay: order count + total),
  `expectedCash` (= `starting_cash` + cash-method total),
  `difference` (= `counted_cash - expectedCash`, null while
  `counted_cash` is null), and `transactions` (id, `paid_at`,
  `payment_method`, `total`, ordered by `paid_at` desc).
- **`close_shift(p_counted_cash int, p_notes text default null)
  returns json`** — stamps `closed_at = now()`, `closed_by =
  auth.uid()`, `counted_cash`, `notes` on the open shift (exception if
  none), then returns that shift's final `get_shift_report` payload.

## UI

- **Dashboard Revenue card** (`components/admin/dashboard-view.tsx`)
  becomes a `Link` to `/admin/shift` with a hover affordance —
  content/format unchanged.
- **New route `app/[locale]/admin/shift/page.tsx`** +
  `components/admin/shift-closing.tsx`. Manager/admin only via the
  existing `/admin/*` middleware gate (not added to
  `ADMIN_ONLY_PREFIXES` — managers close shifts too).
- **New sidebar entry** in `admin-sidebar.tsx`'s `NAV_ITEMS`
  (`href: "/admin/shift"`, new `Nav.shift` key in both message files).
- Page states:
  1. **No open shift** → "Open Shift" form: starting-cash input
     (VND integer), submit calls `open_shift`.
  2. **Shift open** → live report: opened-at/opened-by header,
     per-method breakdown (3 tiles or rows: count + total each),
     running expected-cash figure, transaction list, and a
     "Close Shift" form (counted-cash input + optional note). Submits
     `close_shift`.
  3. **Just closed** → the final summary returned by `close_shift`
     (expected vs counted, over/short difference highlighted, full
     breakdown), with an "Open New Shift" button returning to state 1.
- Realtime: subscribe unfiltered to `orders` changes and refetch the
  report while a shift is open (this project's established
  Realtime-refetch convention).
- Query layer: new `lib/supabase/shift-data.ts` (DI'd,
  `SupabaseClient` first arg) wrapping the three RPCs; a plain
  `useShift` hook (not Context — nothing else shares this data,
  matching `useOrderHistory`'s precedent).
- All new strings in both `messages/vi.json` and `messages/en.json`
  under a new `AdminShift` namespace (plus `Nav.shift`).

## Out of scope

Past-shift history browsing (only the just-closed summary is shown),
multi-drawer/multi-register, cash-drawer adjustments mid-shift
(paid-ins/paid-outs), refunds affecting expected cash (refunds are
handled manually per this project's existing payments stance), and any
staff-role access to shift data.

## Testing

Unit tests for `lib/supabase/shift-data.ts` (mocked client, matching
the existing query-layer test pattern). RPC behavior verified live via
SQL (`mcp__supabase__execute_sql`): open → place/pay orders with
different methods → report shows correct per-method totals and
expected cash → close with a counted amount → difference correct;
double-open rejected. UI live-verified on
`https://phadincafe.vercel.app` as the admin test account: Revenue
card navigates, open/report/close flow works end-to-end, sidebar entry
present, staff account cannot reach `/admin/shift`.
