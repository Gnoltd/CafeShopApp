import { getTranslations } from "next-intl/server"
import { KitchenDisplay } from "@/components/staff/kitchen-display"
import { TablesProvider } from "@/hooks/useTables"

// TablesProvider is only needed here (not history/shift-history, its
// siblings under staff/orders/layout.tsx) -- KitchenTablesColumn, the KDS
// board's 4th "Tables" column, is the only useTables() consumer reachable
// from this page.
export default async function KitchenDisplayPage() {
  const t = await getTranslations("Staff")
  return (
    <div className="h-full">
      <h1 className="sr-only">{t("kitchenDisplayTitle")}</h1>
      <TablesProvider>
        <KitchenDisplay />
      </TablesProvider>
    </div>
  )
}
