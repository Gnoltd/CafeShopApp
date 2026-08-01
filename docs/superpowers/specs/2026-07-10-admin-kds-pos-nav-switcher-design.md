# Admin ⇄ KDS ⇄ POS nav switcher (close the missing links)

## Problem

User asked for a button to switch between Admin, KDS, and POS pages
for users who have permission for more than one. Investigation found
this is mostly already built:

- **Admin → POS/KDS**: already works — `components/admin/admin-sidebar.tsx`
  has a "Fulfillment" nav section linking both.
- **POS → KDS**: already works — `components/staff/staff-nav.tsx`
  already links both.
- **KDS → POS**: **missing** — `kitchen-sidebar.tsx`/`kitchen-top-bar.tsx`
  have no POS link, desktop or mobile.
- **POS/KDS → Admin**: **missing** on both, and must be role-gated —
  a plain `staff` account can reach POS/KDS but not `/admin/*`
  (`lib/middleware-rules.ts`'s `ROUTE_GROUP_ROLES`:
  `/staff` → `staff|manager|admin`, `/admin` → `manager|admin`).

This spec closes only the two missing links; `AdminSidebar` is untouched.

## Role resolution for KDS

`app/[locale]/staff/orders/layout.tsx` (where `KitchenTopBar`/
`KitchenSidebar` render) is currently a `"use client"` component with
no role data. CLAUDE.md's stated convention: role is always
re-resolved server-side per request, never cached client-side.

Fix: rename the current default export to `StaffOrdersLayoutClient`
(same file, unchanged internals — it keeps `usePathname`,
`useKitchenOrders`, etc.). Add a new, thin async server `layout.tsx`
in the same location that calls `getCurrentRole(supabase)` (the
existing helper already used for Profile's staff/admin "Go to [X]"
shortcut) and renders `<StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>`.

`app/[locale]/staff/pos/page.tsx` is already an async server
component — add `getCurrentRole(supabase)` to its existing
`Promise.all([getCategories(supabase), getMenuItems(supabase)])` and
pass the result to `<StaffNav role={role} />`.

## Nav changes

No new translation keys — the existing `Nav.dashboard` key ("Dashboard"
/ "Bảng Điều Khiển") is reused for the Admin cross-link, matching what
`AdminSidebar` already calls its own first item.

- **`StaffNav`** (`components/staff/staff-nav.tsx`): accepts a `role:
  string | null` prop. Appends one more entry to its existing
  `NAV_ITEMS`-driven `.map()` — `{ href: "/admin/dashboard", labelKey:
  "dashboard" }` — only when `role === "manager" || role === "admin"`.
  Same pill styling as the existing two items, no new component.
- **`KitchenSidebar`** (`components/staff/kitchen-sidebar.tsx`):
  accepts a `role: string | null` prop. Adds a new nav section below
  the existing Live Orders/History/Inventory list, separated by a
  `border-t` (mirroring `AdminSidebar`'s own Fulfillment section
  styling exactly) containing a POS link (unconditional — anyone who
  reached KDS already has staff/manager/admin, all POS-permitted) and
  an Admin link (conditional on manager/admin, same check as `StaffNav`).
- **Mobile KDS nav strip** (the `md:hidden` block inside
  `StaffOrdersLayoutClient`, currently just Live Orders/History pills):
  gets the same two links appended as additional pills, same
  conditional-Admin rule, so phone users get parity with desktop.

## Out of scope

`AdminSidebar` itself (already correct). Any new shared "switcher"
component — each surface keeps using its own existing nav idiom
(`StaffNav`'s pill row, `KitchenSidebar`'s icon list, the mobile pill
strip) rather than introducing a new abstraction for three call sites
that already have three different established patterns.

## Testing

No new query-layer functions are added (this is pure routing/UI), so
no new unit tests. Live-verified manually against
`https://phadincafe.vercel.app` post-deploy, using the three test
accounts in `test-accounts.md`:
- **Staff account**: confirm POS and KDS both show only POS/KDS links
  (no Admin link, desktop and mobile).
- **Admin account**: confirm POS shows POS/KDS/Admin; KDS shows the
  same on both desktop sidebar and mobile strip; confirm every new
  link actually navigates to the right page; confirm Admin's own
  sidebar is visually unchanged.
