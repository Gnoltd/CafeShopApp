import { getTranslations } from "next-intl/server"
import { headers } from "next/headers"
import { KitchenDisplay } from "@/components/staff/kitchen-display"
import { TablesProvider } from "@/hooks/useTables"

// TablesProvider is only needed here (not history/shift-history, its
// siblings under staff/orders/layout.tsx) -- KitchenTablesColumn, the KDS
// board's 4th "Tables" column, is the only useTables() consumer reachable
// from this page.
export default async function KitchenDisplayPage() {
  const t = await getTranslations("Staff")
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client. KitchenDisplay renders its own
  // role/theme/language controls inline (header-actions-stack.tsx hides
  // the global fixed stack on this exact route for that reason).
  const role = (await headers()).get("x-resolved-role") || null
  return (
    <div className="h-full">
      <h1 className="sr-only">{t("kitchenDisplayTitle")}</h1>
      <TablesProvider>
        <KitchenDisplay role={role} />
      </TablesProvider>
    </div>
  )
}
