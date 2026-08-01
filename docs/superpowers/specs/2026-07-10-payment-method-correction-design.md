# Payment method correction — change a chosen method while payment is still pending

## Problem

Users need to change a selected payment method before the payment is
finalized, and to recover from picking the wrong one. Investigation
showed POS and customer checkout already allow free switching (method
is only selection state until Charge / Place Order fires). The real
gaps are all in the **Pay Later** flow, after a method is recorded but
before payment completes:

- A served customer who taps **Cash** on the tracking page has
  `payment_method = 'cash'` recorded instantly, with no way to switch
  to Card/VNPay.
- A customer who taps **Card/VNPay** and abandons the gateway page
  comes back locked to that method — the retry button reuses it with
  no way to pick differently.
- Staff who tap **"Mark Cash"** on the wrong KDS table card have no
  undo.

Scope confirmed with user: fix the customer tracking page + staff KDS
undo. A POS pre-charge confirmation step was offered and declined.

## The RPC (one migration)

`change_order_payment_method(p_order_id uuid, p_method payment_method
default null) returns boolean` — `security definer`, following the
guest-safe single-row RPC pattern (`get_order_for_tracking`,
`cancel_pending_order`): takes the order id as a required parameter,
never a broad RLS policy.

Guard: acts only when the order's `status = 'served'` **and**
`payment_status = 'pending'` — the only state where a recorded
Pay Later method is still safely changeable. Returns `false` (no-op)
otherwise. Sets `payment_method = p_method`; `null` means "reset to
no method chosen" (the tracking page's 3-way picker reappears, and
the KDS card returns to its choose-method state). Granted to `anon`
and `authenticated` like the other guest-safe RPCs.

The UPDATE names only `payment_method`, so it cannot re-fire payment
or completion triggers (`handle_order_paid` and
`complete_order_when_served_and_paid` gate on `payment_status`, which
this never touches).

## Customer tracking page (`components/customer/order-tracking.tsx`)

Two additions to the existing served-and-unpaid section:

1. **Cash chosen, awaiting staff** (currently just a note): add a
   "Change payment method" button. It calls the RPC with `null`,
   resets the local `cashConfirmed` flag, and the existing 3-way
   picker renders again.
2. **Gateway method recorded** (the current retry state): alongside
   the existing "Pay Now" retry button, add a secondary "Choose a
   different method" button doing the same reset.

Both go through a new `changeOrderPaymentMethod(supabase, orderId,
method)` function in `lib/supabase/orders-data.ts` (DI'd, wrapping the
RPC). Errors surface via the section's existing `paymentNotice`
mechanism — never silent. Works for guests (the RPC is guest-safe;
the tracking page already supports guest polling).

## Staff KDS table card (`components/staff/kitchen-tables-column.tsx`)

Where a served order currently shows its cash state after "Mark Cash",
add an **"Undo Cash"** action for orders with `payment_method =
'cash'` and `payment_status = 'pending'`. It calls the same
query-layer function with `null`. Failure surfaces an error state per
the project's RLS-denial-visibility convention (`.catch()` with a
shown message, never a silent no-op). Staff still cannot *choose*
Stripe/VNPay for a customer — undo only returns the order to
"customer picks again".

## Known edge (documented, accepted)

If a customer opens a Stripe/VNPay checkout session, abandons it,
switches to cash, pays cash, and *then* the abandoned gateway session
is completed anyway, the existing webhook guards
(`UPDATE ... WHERE payment_status = 'pending'`) prevent any order
state corruption — but the money would be collected twice. Resolved by
a manual gateway-dashboard refund, consistent with this project's
existing "refunds handled manually" stance. No session-cancellation
API call is added (the `pay-order` function does not persist session
ids, and the window is small).

## Out of scope

Changing method on Pay Now orders in `pending_payment` (they already
have cancel/expiry flows: self-cancel, Stripe session expiry, VNPay
failure return), POS charge confirmation, refunds/voiding after
`payment_status = 'paid'`.

## Testing

Unit tests for `changeOrderPaymentMethod` in
`lib/supabase/orders-data.test.ts` (RPC called with right args, boolean
passthrough). RPC guard verified live via SQL: no-op on a `paid` or
non-`served` order, works on served+pending. UI live-verified on
`https://phadincafe.vercel.app`: place a real Pay Later order, serve
it, pick Cash → "Change payment method" returns to the picker; pick
VNPay, abandon, "Choose a different method" → picker; staff "Undo
Cash" on the KDS card returns the customer's picker.
