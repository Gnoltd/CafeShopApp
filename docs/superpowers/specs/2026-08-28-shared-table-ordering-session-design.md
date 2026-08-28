# Shared Table Ordering Session — Design

## Problem

Today, a table's cart is just `useCart`'s per-browser `localStorage` state
(`hooks/useCart.tsx`) — nothing server-side, nothing shared. Two people at
the same table who both scan the table's QR get two completely independent
carts; there's no way for them to build one order together. Every order is
also its own self-contained checkout: pay-method is chosen (or deferred,
per `docs/superpowers/specs/2026-07-08-deferred-payment-service-lifecycle-design.md`)
on that one order, with no concept of "this table has ordered three rounds
so far and hasn't paid for any of them yet."

This doc adds a **live, multi-device shared cart per table**, a **running
tab** across however many rounds a table orders, and **one aggregate
payment** that settles every unpaid round at once — the "open a tab, pay
when you're done" model of a real sit-down restaurant.

## Goals

1. Anyone who scans an `available` or already-`occupied` table's QR joins
   the same **live-synced cart** for that table — items, quantities, and
   removals sync to every device at that table in real time, symmetrically
   (no per-item ownership; anyone can edit anything, matching a shared
   paper order pad).
2. The first item added to an empty table's cart starts a **table
   session** and flips the table to `occupied` — before any order exists.
   An idle draft (no cart activity for 5 minutes, checked across *all*
   devices at the table, not per-device) prompts "Still there?"; anyone
   *not* confirming — an explicit "No", or nobody responding — clears the
   draft and, if zero rounds were ever placed, drops the table straight
   back to `available` (skipping `cleaning` — nothing was ever served).
3. **"Place Order"** submits the current draft as a round (an `orders`
   row, same as today), visible to everyone at the table in a persistent
   **running tab** (round 1, round 2, ... this session), and resets the
   shared draft to empty for the next round. Once a session has at least
   one round, the idle-timeout logic in Goal 2 stops entirely — the table
   just sits `occupied` normally, same as today, no auto-clearing of order
   history ever.
4. No round is paid individually and checkout's Pay Now/Pay Later/payment-
   method picker never appears for a table order at all — not even for
   round 1. Payment happens exactly once, whenever anyone at the table
   taps **Check Bill**, against the sum of every currently-unpaid round —
   available any time, even mid-round (kitchen keeps preparing/serving
   outstanding rounds regardless; the table only reaches `completed` +
   `cleaning` once every round is both `served` and `paid`, via the
   existing per-order trigger chain, unmodified).
5. Check Bill reuses the existing three-way payment picker
   (Cash/Stripe/VNPay), scoped to the aggregate unpaid total, for **all
   three methods** — including Card and VNPay, which today only ever
   charge one order. Cash still needs one staff tap to confirm (now a
   single aggregate confirmation covering every unpaid round, not one tap
   per round).
6. Scope is dine-in/table orders only. Pickup (`/menu` → `/cart` →
   `/checkout`) is completely untouched — same single cart, same
   Pay Now/Pay Later choice, same per-order payment it has today.

## Non-goals

- **Per-item KDS ticking** ("mark this drink done" instead of the whole
  round) and a round-by-round bill breakdown ("Round 1: ... / Round 2:
  ... / Total") in the bill UI — explicitly parked as a future follow-up.
  It needs its own `order_items`-level status column and touches KDS,
  receipts, and the bill view; not built here. This design keeps KDS
  acting at the round/order level, unchanged from today.
- **Split billing / per-person attribution** — the shared cart has no
  concept of who added what; symmetric editing, one combined bill.
- **A server-side cron/scheduled job for stuck abandoned sessions.** The
  5-minute idle-clear (Goal 2) is client-driven; if every device at a
  table goes offline before anyone's client fires the clear, the table
  stays `occupied` with an empty draft indefinitely. Existing Admin
  Tables' manual 3-state override is the fallback, same safety net staff
  already have for any other stuck table today — no new infra for this.
- **Promo-code stacking across rounds.** One promo code, entered once at
  Check Bill, applies to the aggregate total — not per-round.
- Refunds, partial payments, or split checks — same standing non-goal as
  the deferred-payment design this builds on.
- Any change to pickup ordering, or to Stripe/VNPay signature
  verification — reused as-is.

## Design

### 1. New table: `table_sessions`

A table session is the backbone that answers "which rounds belong to
*this* visit" — without it, a busy table reused across many customers
has no clean way to distinguish today's running tab from last week's.

```sql
create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id),
  status text not null default 'active'
    check (status in ('active', 'abandoned', 'closed')),
  payment_pending boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
```

- **`active`**: normal state — draft cart open, rounds may be placed.
- **`abandoned`**: idle-timeout fired with zero rounds ever placed
  (Goal 2) — table returns to `available` directly.
- **`closed`**: the table's last active order reached `completed` (same
  event that already flips the table to `cleaning`) — the session that
  produced it is done.
- **`payment_pending`**: true while a Card/VNPay Check Bill gateway
  session is in flight (Section 6) — blocks new rounds until it resolves
  (Section 4, Goal 4's race-avoidance).

### 2. New table: `table_cart_items` (the live shared draft)

```sql
create table public.table_cart_items (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  size_id uuid references public.menu_item_sizes(id),
  modifiers jsonb not null default '[]'::jsonb,
  note text,
  unit_price numeric not null,
  quantity int not null check (quantity > 0),
  updated_at timestamptz not null default now()
);
```

Added to the Realtime publication like every other live table
(`Inventory`/`Tables`/`Orders`/`Staff accounts`). Per this project's
established Realtime convention, clients subscribe **unfiltered** and
refetch (a `filter` doesn't reliably combine with RLS-gated Realtime) —
each device filters client-side to its own `table_session_id`.

`orders` gains a nullable `table_session_id` column (dine-in table
orders only; null for pickup, which never has a session) so a round can
be traced back to the running tab it belongs to.

### 3. RLS / access: guest-safe RPCs, not broad table grants

Per this project's guest-safe RPC convention — a narrow
`security definer` function taking the relevant id as a required
parameter, never a broad policy keyed on an absent identity — every
read/write to the shared cart goes through an RPC, not direct
PostgREST table access:

- `get_table_session(p_table_id)` — returns the active session (creating
  none if there isn't one — a session only exists once something's been
  added), its draft cart items, every round (`orders`) placed under it
  with status/total, the aggregate unpaid total, and `payment_pending`.
  This is what powers the shared screen and what re-scanning the QR
  hydrates.
- `add_cart_item(p_table_id, p_menu_item_id, p_size_id, p_modifiers,
  p_note, p_quantity)` — if no active session exists and the table is
  `available`, creates one (`table_sessions` insert) and flips the table
  to `occupied` in the same transaction; if an active session already
  exists, just inserts/increments the row (matching `useCart`'s existing
  same-item-merges-quantity behavior via a matching identity key).
  Rejects if the table is `cleaning` (guests already get blocked with the
  existing "Notify Staff" message at that status) or if
  `payment_pending` is true (Goal 4/Section 6).
- `update_cart_item_quantity(p_cart_item_id, p_quantity)` /
  `remove_cart_item(p_cart_item_id)` — quantity `<= 0` deletes, symmetric
  for any device (Goal 1 — no ownership check).
- `place_table_round(p_table_id)` — the existing `place_order` RPC,
  invoked with the session's current `table_cart_items` as the order's
  items, `payAt` forced to `'later'`, `payment_method` left `null`
  (Goal 4 — no method is ever chosen at placement time for a table
  order), `table_session_id` stamped onto the new row. On success,
  clears `table_cart_items` for that session (draft resets for the next
  round) and leaves the order itself untouched for KDS. Same
  `payment_pending`/`cleaning` guards as `add_cart_item`.
- `abandon_table_session(p_table_id)` — called by whichever client's
  idle-timeout prompt resolves to "No" (or times out unanswered).
  Guest-safe because it's a no-op unless the session actually has zero
  placed orders (`table_sessions.status = 'active'` and no `orders`
  reference it) — matching the "row id as the only credential" guest-safe
  pattern already used by `cancel_pending_order`. Deletes the draft cart,
  sets `table_sessions.status = 'abandoned'`, flips the table straight to
  `available`.

### 4. Occupancy trigger: unchanged, session creation does the work

The existing `sync_table_occupancy` trigger still fires on `orders`
`INSERT`/`UPDATE` exactly as it does today (see
`docs/superpowers/specs/2026-07-08-table-status-design.md`) and needs
**no changes** — it already only cares about order rows, and rounds are
still ordinary `orders` rows. The *new* available→occupied transition
that happens **before** any order exists (Goal 2) is handled entirely
inside `add_cart_item` (Section 3), a separate, additive code path. The
existing "last active order reaches `completed`/`cancelled` →
`cleaning`" logic is also untouched — because `table_sessions.status`
is flipped to `closed` from the *same* trigger evaluation (a small
addition to `sync_table_occupancy`'s existing completed-order branch:
also `update table_sessions set status = 'closed', ended_at = now()
where id = <the completed order's table_session_id> and status =
'active'`), the two states stay in lockstep without inventing a second,
independent trigger to keep synchronized.

### 5. Client-side idle-timeout (Goal 2)

Purely client-driven, matching this project's existing polling
convention for guest surfaces (guest order tracking already polls
rather than using Realtime, labeled as such in the UI). Any device
subscribed to the session's Realtime channel resets a local 5-minute
timer on any `table_cart_items` change; on expiry, that device shows
"Still there?" with a short response window. "No" or no response calls
`abandon_table_session`; "Yes" just lets the timer restart on the next
change. Once the session has at least one placed round
(`get_table_session`'s round list is non-empty), the client stops
running this timer entirely — per Goal 3, order history is never
auto-cleared.

### 6. Check Bill: aggregate payment, all three methods

A single action on the shared table screen (Goal 4), calling
`checkout_table_session(p_table_id, p_method, p_promo_code?)`:

- Validates the optional promo code once, against the aggregate unpaid
  subtotal (Non-goals — not per round), producing one discount amount
  for the whole payment.
- Sets every currently-unpaid order under the active session's
  `payment_method` to `p_method` (this is the **first** time a table
  order's payment method is ever set — Goal 4 means it was never asked
  at any round's placement).
- **Cash**: no gateway involved — this just records the method choice.
  The table's KDS card picks up an aggregate **"Confirm Cash Received —
  Table N, ₫total"** action (a new RPC, `confirm_table_cash_payment`,
  mirroring today's single-order "Confirm Cash Received" but updating
  `payment_status = 'paid'` on every order in the session at once) — one
  staff tap settles the whole tab, rather than one tap per round. This
  doubles as the "notify staff" signal from the original ask: the
  aggregate badge appearing on the table's KDS card *is* the
  notification.
- **Stripe/VNPay**: sets `table_sessions.payment_pending = true` (blocks
  new rounds, Section 3/Goal 4) and creates **one** gateway session for
  the summed total, carrying `table_session_id` in its metadata (Stripe:
  `metadata.table_session_id`; VNPay: encoded the same way
  `place-order` already encodes identifiers into `vnp_TxnRef`, using the
  same `vnpayEncode()` helper — no new encoding convention). Redirects
  the customer through the existing, unmodified checkout/redirect flow.
- `stripe-webhook`/`vnpay-ipn` gain one new branch: when the completed
  session's metadata carries a `table_session_id` (rather than a single
  `order_id`), loop-update every order with that `table_session_id` and
  `payment_status = 'pending'` to `'paid'` in one transaction, then clear
  `payment_pending`. Signature verification, IPN response contract, and
  the existing single-order branch are all unchanged — this is an
  additive branch, not a rewrite. Each order's own `payment_status`
  update still fires the existing, unmodified
  `complete_order_when_served_and_paid` trigger per row — a round
  already `served` completes immediately; a round still `preparing`
  completes later, on its own, once it's served. `payment_pending`
  clears on success *and* on expiry/failure (same 30-minute Stripe
  `expires_at` / VNPay pattern already in place), so a failed aggregate
  payment doesn't leave the table permanently locked from ordering.

### 7. Customer UI: `/table/[qrToken]` becomes the whole ordering surface

`components/customer/table-landing.tsx` is rebuilt into the single,
persistent screen for a dine-in visit: menu browsing, the live shared
cart (subscribed to `table_cart_items` via Realtime, edits going through
the RPCs in Section 3), the running tab (every round from
`get_table_session`, with statuses), Place Order, and Check Bill.
`/cart` and `/checkout` (`components/customer/checkout-view.tsx`) are
**not touched** — they keep serving pickup exactly as today; a dine-in
table visit never routes through them at all (Goal 6).

### 8. Staff UI: KDS table card gains aggregate payment state

`components/staff/kitchen-tables-column.tsx`'s existing per-table card
(already reading `table_id`-joined orders, per the deferred-payment
design) adds:

- A running-tab summary (round count + unpaid total) sourced from the
  same `get_table_session` data KDS already needs for its existing
  served/awaiting-payment badges.
- The aggregate "Confirm Cash Received" action (Section 6), replacing
  what would otherwise be N separate per-round confirmations.

No changes to `kitchen-board.tsx`'s three status columns — each round
still progresses `paid → preparing → ready → served` individually and
independently, same as any order today (Non-goals — no per-item
granularity).

## Testing

No Deno/pg test harness in this project — verified live, per this
project's established convention:

- Two devices scan the same table's QR: confirm both see the same empty
  draft, adding an item on one appears on the other within the Realtime
  channel's normal latency, and either device can edit/remove the
  other's line.
- Idle-clear: add an item, leave both devices untouched 5+ minutes,
  confirm the prompt appears and "No"/timeout empties the draft and
  drops the table back to `available` (not `cleaning`).
- Place two rounds: confirm both show in the running tab with correct
  per-round status, the draft resets to empty after each, and the table
  stays `occupied` with no idle-prompt reappearing.
- Check Bill mid-round (one round `served`, one still `preparing`):
  confirm Cash/Stripe/VNPay each correctly charge only the sum of
  currently-unpaid rounds, the `preparing` round is unaffected and
  completes on its own once served, and the table only reaches
  `completed`/`cleaning` after that last round finishes.
- Card/VNPay Check Bill: confirm the gateway session amount matches the
  aggregate total, the webhook flips every covered order's
  `payment_status` in one event, and `payment_pending` correctly blocks
  "Place Order" until the session resolves, then unblocks after
  success/expiry/failure.
- Cash Check Bill: confirm the KDS table card's aggregate confirm button
  covers every unpaid round in one tap.
- Abandoned zero-order session: confirm `table_sessions.status` ends at
  `abandoned`, not `closed`, and no `cleaning` state is ever entered.
- Pickup regression: confirm `/menu` → `/cart` → `/checkout` behaves
  identically to before this feature — no session, no shared cart, no
  Check Bill.

## Open questions resolved during brainstorming

- **Scope of "live-synced"**: full real-time sync across devices (not
  independent carts merged only at checkout) — explicit trade-off
  accepted: this is the larger, riskier build, chosen deliberately over
  the simpler "merge at checkout" alternative.
- **Cart edit rights**: fully symmetric, no per-item ownership or
  locking — matches a shared paper order pad; avoids inventing guest
  identity/attribution.
- **Session start trigger**: first cart item added (not first order
  placed) — occupies the table before any `orders` row exists,
  requiring the new `add_cart_item`-driven occupancy path in Section 4
  rather than relying solely on the existing order-insert trigger.
- **Idle-timeout scope**: only ever applies to an *unsubmitted draft* —
  never to already-placed round history. Stops entirely once the
  session has at least one round.
- **Abandoned-session table routing**: skips `cleaning`, goes straight
  to `available` — nothing was ever served, so a "needs cleaning" signal
  to staff would be false.
- **Payment model across rounds**: aggregate, one settlement point
  ("Check Bill"), not per-round Pay Now — a deliberate, large departure
  from this project's existing per-order deferred-payment model
  (2026-07-08), chosen because the user wants zero payment-method
  friction at every round.
- **Pay Now per round**: removed entirely for table orders, including
  round 1 — no order ever shows a payment-method picker; `/checkout`'s
  Pay Now/Pay Later toggle becomes pickup-only.
- **Check Bill timing**: allowed any time, even with rounds still
  `preparing`/unserved — not gated on "everything served first."
- **Card/VNPay aggregate charging**: explicitly in scope for all three
  methods, not cash-only — accepted as the riskiest part of the feature
  (touches signature-verified webhook handlers with a documented history
  of subtle bugs in this project) after flagging the alternative
  (Cash-only aggregate, Card/VNPay stays single-round) and having it
  declined.
- **Concurrent round-vs-payment race**: new rounds are blocked
  (`payment_pending`) while a Card/VNPay aggregate session is in flight,
  rather than allowed through and left for a second, later charge.
- **KDS granularity**: stays round-level for this feature; per-item
  ticking and a round-by-round bill breakdown are named, explicitly
  parked, future work.
- **Promo codes**: once, at Check Bill, against the aggregate total —
  not per round.
- **Pickup**: entirely out of scope, unmodified.
