# PhaDinCafe

Domain language for PhaDinCafe's dine-in QR ordering, kitchen preparation, and cash settlement workflows.

## Language

**Table**:
A physical café table identified by a display number, bilingual location, and secret QR token used by guests to access ordering.
_Avoid_: Seat, station

**Guest Active Table**:
The resolved Table number and QR token remembered in a guest's browser so they can return to their active Table page.
_Avoid_: Active session table, seat selection

**Table Session**:
An active dine-in visit at a Table combining its shared Draft Cart and placed Rounds until all unpaid Rounds are settled.
_Avoid_: Dining tab, customer visit

**Draft Cart**:
Unsubmitted line items shared across devices within a Table Session before placing a Round.
_Avoid_: Personal cart, basket

**Round**:
A dine-in order submitted from a Draft Cart during a Table Session.
_Avoid_: Sub-order, ticket batch

**Bill Request**:
A guest confirmation signaling readiness to settle all unpaid Rounds of a Table Session in cash.
_Avoid_: Pay Now, checkout

**KDS Ticket**:
A staff-facing preparation record on the Kitchen Display tracking item-by-item preparation status (`preparing`, `ready`, `served`) until hand-over.
_Avoid_: Kitchen slip, prep card

**Table Settlement**:
Staff-confirmed cash collection closing the outstanding balance across a Table's unpaid orders.
_Avoid_: POS tender, per-item checkout

**Menu Item**:
An orderable beverage or food product with localized names, base pricing, categories, optional Sizes, and optional Modifier Groups.
_Avoid_: Dish, SKU, catalog entry

**Role**:
A staff capability (`staff`, `manager`, or `admin`) governing operations and management access; walk-in guests hold no Role.
_Avoid_: Account tier, permission group
