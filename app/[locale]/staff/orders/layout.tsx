import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { StaffOrdersLayoutClient } from "@/components/staff/staff-orders-layout-client"
import { ShiftProvider } from "@/hooks/useShift"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"

// StaffOrdersLayoutClient's own top bar (KitchenTopBar) reads both
// useKitchenOrders() (isRealtimeConnected) and useShift() (isShiftOpen,
// join/leave) -- shared across live orders, history, and shift-history, so
// both providers mount here rather than only around the live board.
export default async function StaffOrdersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  return (
    <ShiftProvider>
      <KitchenOrdersProvider>
        <StaffOrdersLayoutClient role={role}>{children}</StaffOrdersLayoutClient>
      </KitchenOrdersProvider>
    </ShiftProvider>
  )
}
