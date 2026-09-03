import { TablesProvider } from "@/hooks/useTables"
import { InventoryProvider } from "@/hooks/useInventory"

// DashboardView reads both useTables() (table status counts) and
// useInventory() (low-stock alerts) -- scoped here rather than the shared
// AdminLayoutClient shell so the other admin pages don't mount either
// provider's fetch/Realtime subscription. See daily.md Task 4.
export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TablesProvider>
      <InventoryProvider>{children}</InventoryProvider>
    </TablesProvider>
  )
}
