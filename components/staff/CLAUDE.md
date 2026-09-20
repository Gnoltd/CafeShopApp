# components/staff/CLAUDE.md

Staff/manager/admin "operations" area — `/staff/orders` (KDS) and
`/staff/tables`, gated to `staff|manager|admin` by `middleware.ts`. As
of the 2026-09-19 minimal ordering rebuild this is the *only* place any
of the three roles land after signing in (`ROLE_HOME` sends all three
here — `/admin/dashboard` no longer exists). This file only covers what
actually survives in this directory; check `find components/staff
-type f` if it ever looks stale rather than trusting this list from
memory.

## Route structure

Both pages live under a route group,
`app/[locale]/staff/(operations)/` (`orders/page.tsx`,
`tables/page.tsx`), sharing one layout
(`app/[locale]/staff/(operations)/layout.tsx`) that mounts
`KitchenOrdersProvider` and `TablesProvider` once for both — the route
group is required specifically because `/staff/orders` and
`/staff/tables` are sibling directories, not parent/child, so a
`layout.tsx` at either one alone wouldn't wrap the other.
`staff-orders-layout-client.tsx` renders the actual chrome: a two-tab
"KDS / Tables" switcher (`OperationsTabSwitcher`) is the only
navigation affordance the live board has — a plain `staff` account has
no admin sidebar to fall back on, so this tab switch is what makes
`/staff/tables` reachable at all for that role.

**Known dead code in this file, found while writing this doc (not
fixed — out of scope for a docs-only pass):**
`staff-orders-layout-client.tsx` still has a full `else` branch
(`KitchenTopBar`/`KitchenSidebar`, plus its own separate mobile nav with
links to `/staff/pos` and `/admin/dashboard`) for any path under this
layout that isn't `/staff/orders` or `/staff/tables`. Since Task 17 of
the rebuild deleted every other page that used to live under this
route group (`/staff/orders/history`, `/staff/orders/shift-history`),
that branch is now unreachable — there is no third page left to render
it for. Its two links are stale (`/staff/pos` and `/admin/dashboard`
are both deleted routes), but since the branch never renders, this is
dead-code confusion rather than a live broken link. The route group's
own `layout.tsx` doc comment likewise still says it wraps "the live KDS
board... its history/shift-history sub-pages" — also stale as of Task
17.

## What's here

- **`kitchen-display.tsx`** (`/staff/orders`) — the KDS ticket board
  only: New/Preparing/Ready columns. The old embedded 4th "Tables"
  column is gone (moved to its own page, see below). Has an
  all/pickup/dine-in filter — `pickup` stays as a filter option because
  old `pickup` orders still exist in the DB (no new ones can ever be
  created; every order now places through `place_table_round`, dine-in
  only).
- **`kitchen-board.tsx`** — renders one ticket. Per-item status
  progression (`order_items.status`, migration `0082`) via
  `hooks/useKitchenOrders.tsx`'s `NEXT_ITEM_STATUS`/`PREV_ITEM_STATUS`
  maps — a ticket with several drinks advances drink-by-drink, not as
  one all-or-nothing block. The old per-ticket "confirm-pickup-cash"
  payment-picker branch is gone (every order is dine-in now, settled in
  aggregate on the Tables page, not per-ticket).
- **`kitchen-top-bar.tsx`**, **`kitchen-sidebar.tsx`**,
  **`kitchen-stats-footer.tsx`** — chrome around the board (realtime
  connection indicator, completed-count/avg-time stats, a manual
  "Recall last order" action backed by `recall_last_completed_order()`,
  migrations `0087`–`0089`, unrelated to this rebuild). No shift
  open/join/leave UI anymore — the whole shift concept is deleted (see
  root `CLAUDE.md`'s "Shift closing" entry); `useShift.tsx` itself is
  deleted too.
- **`tables-operations-view.tsx`** (`/staff/tables`) — the new page
  this rebuild added, absorbing two things that used to live
  separately:
  1. **Table status**, simplified from a 3-state cycle
     (available/occupied/cleaning) to a **binary badge**: "trống"
     (empty) or "đang phục vụ" (in service), computed from whether the
     table has an open `table_sessions` row — reusing data the
     component already fetches for showing active carts/rounds, not a
     second query. No "cleaning" state, no urgent-alert badge, no
     "Notify Staff" affordance in the UI anymore (the DB-level 3-state
     enum/trigger is untouched — see root `CLAUDE.md`).
  2. **Table CRUD** absorbed from the old `/admin/tables` page: add
     table, rename, edit location, view/regenerate QR code
     (`table-form.tsx` is the create/edit dialog).
  Also renders a "Đã Phục Vụ" (mark served) action for a table's ready
  orders and `ConfirmCashPayment` ("Xác Nhận Đã Nhận Tiền") for any
  table with an outstanding balance — see below.
- **`confirm-cash-payment.tsx`** — replaced the old 3-button
  `PaymentMethodPicker` (cash/Stripe/VNPay). Cash is the only method
  left system-wide, so there is nothing to "pick" — a single tap
  immediately confirms; `onSelect` is always called with `"cash"`
  (kept as the same `(method: RealPaymentMethod) => void` shape the old
  picker used so call sites needed no signature change). Wired to
  `confirmTablePayment` (`hooks/useKitchenOrders.tsx`) →
  `confirm_table_payment` (migration `0091`).
- **`staff-nav.tsx`** — top nav for this whole area: just `/staff/orders`
  and `/staff/tables`.

## What's deleted (do not re-introduce without re-reading the design doc)

- **POS** (`/staff/pos`, `pos-terminal.tsx`, `pos-item-picker.tsx`) —
  every order now goes through a customer scanning a table's own QR;
  staff never place an order on a guest's behalf through a separate
  terminal.
- **Staff Order History** (`/staff/orders/history`,
  `order-history-list.tsx`, `order-history-detail.tsx`,
  `lib/supabase/order-history.ts`, `hooks/useOrderHistory.tsx`) and
  **Shift History** (`/staff/orders/shift-history`,
  `staff-shift-history.tsx`, `shift-controls-dialog.tsx`).
- **Rewards lookup** (`/staff/rewards`, `reward-lookup.tsx`) — Rewards
  itself is deleted, so there is nothing left to redeem in person.
- **The old 3-state table cycle button and its "cleaning" badge**
  (`kitchen-tables-column.tsx`, `git mv`'d into
  `tables-operations-view.tsx` and rewritten binary — see above). Worth
  knowing for history: that old cycle button had already been dead,
  unrendered code since a 2026-09-05 commit, predating this whole
  rebuild by two weeks — so a live 3-state table UI hadn't actually been
  reachable by anyone for a while even before the rebuild started;
  `/staff/tables` is what makes a table-status view live again for the
  first time in a while, not a straight port of what was there before.
- **`kitchen-pending-payment.tsx`** — the `pending_payment` banner only
  ever applied to the old non-table Pay-Now checkout flow, which no
  longer exists (every order starts via `place_table_round`, always
  landing at `pending`, never `pending_payment`).
- The shift concept entirely — no open/close/join UI, no
  `useShift.tsx`, no `lib/supabase/shift-data.ts`. Not just the UI: the
  underlying DB gate that used to block *ordering itself* without an
  open shift is also removed (migration `0094`) — see root
  `CLAUDE.md`'s "Shift closing" entry for why that had to happen too,
  not just deleting the shift screen.
