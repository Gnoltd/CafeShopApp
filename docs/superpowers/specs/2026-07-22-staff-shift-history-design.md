# Design: Staff-facing Shift History

Date: 2026-07-22

## Context

Shift closing (cash reconciliation) already exists end-to-end for
manager/admin at `/admin/shift` (`components/admin/shift-closing.tsx`):
open a shift with a starting cash amount, track a live report against
it, close with a counted amount, and browse past shifts via a
Current/History tab switch. `get_shift_history()`/`get_shift_report()`
(migration `0053`) already compute the exact reconciliation the KDS
should show — `difference = countedCash - (startingCash + cash-only
revenue)` — and `shift-report-detail.tsx` already color-codes it
(green = exact, amber = over, red = short).

Staff (not just manager/admin) can already **open/close/join/leave** a
shift from KDS's top bar (`kitchen-top-bar.tsx` +
`shift-controls-dialog.tsx` + `hooks/useShift.tsx`), and migration
`0053` already broadened `get_shift_report`/`get_shift_history` to
`security invoker` with a staff-inclusive RLS policy
(`shifts_staff_all`). What's missing is purely a front-end view: staff
has no way to browse *past* shifts from KDS — that's only reachable
via `/admin/shift`, which staff's role is blocked from
(`middleware-rules.ts`: `/admin` prefix requires `manager`/`admin`).

This spec adds a staff-reachable Shift History view, reusing the
existing data layer and detail-rendering component as-is — no new
RPCs, no new migration, no new admin-only logic duplicated.

## New route

`app/[locale]/staff/orders/shift-history/page.tsx` — a server
component following the same pattern as
`app/[locale]/staff/orders/history/page.tsx`: fetches the current role
server-side, renders inside the existing `StaffOrdersLayoutClient`
(via the shared `app/[locale]/staff/orders/layout.tsx`), so it
automatically gets `KitchenTopBar` + the tab row (mobile) / sidebar
(desktop) for free.

## New component — `components/staff/staff-shift-history.tsx`

A **history-only** view — deliberately not a port of the full
`ShiftClosing` component, since staff already opens/closes shifts via
the top bar's dialog and shouldn't get a second, redundant open/close
form:

- On mount, calls `getShiftHistory(supabase)` and renders the same
  list layout `shift-closing.tsx`'s history tab already uses (date
  range, total revenue, opened/closed-by names, color-coded
  difference summary, chevron to drill in).
- Selecting an entry calls `getShiftReport(supabase, shiftId)` and
  renders it with the existing `ShiftReportDetail` component, imported
  directly from `components/admin/shift-report-detail.tsx` — it's
  already a pure presentational component with no admin-only
  behavior, so this is a straight reuse rather than a duplicate copy.
- A "back to history" control returns to the list, mirroring
  `shift-closing.tsx`'s existing `backToHistory` pattern.
- Loading/empty/error states reuse the same `AdminShift` message
  namespace keys already in both `messages/en.json` and
  `messages/vi.json` (`historyTab`, `historyEmpty`, `historyLoadError`,
  `totalRevenueStat`, `openedByLabel`, `closedByLabel`,
  `differenceExact`/`differenceOver`/`differenceShort`,
  `backToHistory`, `loading`) — no new translation keys needed for the
  body content since it's the same data/labels, just a new surface.

## Nav entry

- `components/staff/staff-orders-layout-client.tsx`'s mobile tab row
  gains a "Shift History" link (`/staff/orders/shift-history`) next to
  Live Orders/Order History/POS, using a new `active` check
  (`pathname === "/staff/orders/shift-history"`) alongside the
  existing `isHistoryActive`.
- `components/staff/kitchen-sidebar.tsx`'s desktop nav list gains the
  matching entry (a `Wallet` or `History`-family icon from
  `lucide-react`, consistent with the icon already used for the "Close
  Shift"/"History" affordances elsewhere in this codebase).
- New message key `KitchenDisplay.shiftHistoryNav` (both message
  files), value `"Shift History"` / Vietnamese equivalent — matches
  the existing naming convention (`liveOrders`, `orderHistoryNav`) in
  the same namespace.

## Access control

No middleware change needed — `/staff/orders/shift-history` already
falls under the existing `/staff` prefix rule
(`staff|manager|admin`) in `lib/middleware-rules.ts`. No RLS/RPC
change needed — migration `0053` already grants staff read access to
`get_shift_history`/`get_shift_report`.

## Out of scope

- No open/close-shift form on this page — that flow stays exclusively
  in `kitchen-top-bar.tsx`'s existing dialog.
- No new reconciliation logic — the mismatch calculation and its
  color-coding are unchanged, reused exactly as `/admin/shift` already
  computes and displays them.
- No change to `/admin/shift` itself.
- No staff-specific filtering (e.g. "only shifts I worked") — shows
  the same full shift history an admin sees, since any staff member
  may have worked any given shift.

## Testing

- No new RPC/query-layer code, so no new unit tests beyond what
  `shift-data.ts` already has coverage for.
- Verified live on `https://phadincafe.vercel.app` logged in as the
  throwaway staff test account: `/staff/orders/shift-history` is
  reachable from both the mobile tab row and desktop sidebar, lists
  past shifts, drill-in renders the same reconciliation detail
  (including a deliberately induced mismatch to confirm the red/amber
  warning renders, not just the green/exact case), and the route is
  still blocked for a logged-out guest (redirects to `/login` per the
  existing `/staff` middleware rule).
