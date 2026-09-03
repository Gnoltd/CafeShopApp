import { InventoryProvider } from "@/hooks/useInventory"

export default function AdminInventoryLayout({ children }: { children: React.ReactNode }) {
  return <InventoryProvider>{children}</InventoryProvider>
}
