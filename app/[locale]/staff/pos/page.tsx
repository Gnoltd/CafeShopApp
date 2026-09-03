import { getTranslations } from "next-intl/server"
import { StaffNav } from "@/components/staff/staff-nav"
import { PosTerminal } from "@/components/staff/pos-terminal"
import { createClient } from "@/lib/supabase/server"
import { getCategories, getMenuItems } from "@/lib/supabase/menu-data"
import { getCurrentRole } from "@/lib/get-current-role"
import { TablesProvider } from "@/hooks/useTables"
import { ShiftProvider } from "@/hooks/useShift"
import { KitchenOrdersProvider } from "@/hooks/useKitchenOrders"

// PosTerminal genuinely consumes all three: useTables (table picker for
// dine-in), useShift (isShiftOpen gate on the Charge button), and
// useKitchenOrders (pendingPaymentOrders/confirmCashPayment for the
// cash-confirm banner) -- so unlike the live KDS board, POS can't drop
// KitchenOrders/Shift. Scoping them here still keeps them off
// /staff/rewards, the one staff route that needs none of this.
export default async function PosPage() {
  const t = await getTranslations("Staff")
  const supabase = await createClient()
  const [categories, items, role] = await Promise.all([
    getCategories(supabase),
    getMenuItems(supabase),
    getCurrentRole(supabase),
  ])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{t("posTitle")}</h1>
      <StaffNav role={role} />
      <div className="flex-1 overflow-hidden">
        <TablesProvider>
          <ShiftProvider>
            <KitchenOrdersProvider>
              <PosTerminal categories={categories} items={items} />
            </KitchenOrdersProvider>
          </ShiftProvider>
        </TablesProvider>
      </div>
    </div>
  )
}
