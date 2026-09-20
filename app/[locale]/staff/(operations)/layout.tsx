import { headers } from "next/headers"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"
import { TablesProvider } from "@/hooks/useTables"

// Shared "Operations" shell (Task 16) for every sibling page under this
// `(operations)` route group -- the live KDS board (/staff/orders), its
// history/shift-history sub-pages, and the new /staff/tables page. A route
// group (not a real URL segment) is required here specifically because
// /staff/orders and /staff/tables are sibling directories under /staff/,
// not parent/child -- a layout.tsx placed at either one wouldn't wrap the
// other; hoisting it to their common `(operations)` parent is the only way
// for both to share one KitchenOrdersProvider/TablesProvider instance.
//
// StaffOrdersLayoutClient's own top bar (KitchenTopBar) reads
// useKitchenOrders() (isRealtimeConnected) -- shared across live orders and
// history, so the provider mounts here rather than only around the live
// board. TablesProvider moved up here from orders/page.tsx (Task 16) since
// /staff/tables now needs it too, not just the live board's old embedded
// Tables column.
export default async function StaffOperationsLayout({ children }: { children: React.ReactNode }) {
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null

  return (
    <KitchenOrdersProvider>
      <TablesProvider>
        <StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>
      </TablesProvider>
    </KitchenOrdersProvider>
  )
}
