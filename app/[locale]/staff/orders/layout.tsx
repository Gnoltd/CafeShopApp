import { headers } from "next/headers"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"
import { ShiftProvider } from "@/hooks/useShift"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"

// StaffOrdersLayoutClient's own top bar (KitchenTopBar) reads both
// useKitchenOrders() (isRealtimeConnected) and useShift() (isShiftOpen,
// join/leave) -- shared across live orders, history, and shift-history, so
// both providers mount here rather than only around the live board.
export default async function StaffOrdersLayout({ children }: { children: React.ReactNode }) {
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null

  return (
    <ShiftProvider>
      <KitchenOrdersProvider>
        <StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>
      </KitchenOrdersProvider>
    </ShiftProvider>
  )
}
