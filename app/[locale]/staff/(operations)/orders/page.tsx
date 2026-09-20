import { getTranslations } from "next-intl/server"
import { KitchenDisplay } from "@/components/staff/kitchen-display"

// TablesProvider now lives in the shared (operations) layout.tsx (Task 16)
// -- both this page's own KDS board (which no longer embeds a Tables
// column itself) and the sibling /staff/tables page need it.
export default async function KitchenDisplayPage() {
  const t = await getTranslations("Staff")
  return (
    <div className="h-full">
      <h1 className="sr-only">{t("kitchenDisplayTitle")}</h1>
      <KitchenDisplay />
    </div>
  )
}
