import { headers } from "next/headers"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"
import { TableSettlementProvider } from "@/hooks/useTableSettlement"
import { TablesProvider } from "@/hooks/useTables"

// Shared "Operations" shell for the sibling pages under this `(operations)`
// route group: `/staff/orders` (KDS) and `/staff/tables` (table occupancy,
// CRUD/QR, and cash settlement). A route group is required because those two
// routes are siblings under `/staff/`, not parent/child, so hoisting the layout
// here shares one KitchenOrdersProvider, TableSettlementProvider, and
// TablesProvider instance across both tabs without resetting live subscriptions
// or session counters when staff switches views.
export default async function StaffOperationsLayout({ children }: { children: React.ReactNode }) {
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null

  return (
    <KitchenOrdersProvider>
      <TableSettlementProvider>
        <TablesProvider>
          <StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>
        </TablesProvider>
      </TableSettlementProvider>
    </KitchenOrdersProvider>
  )
}
