import { getTranslations } from "next-intl/server"
import { TablesOperationsView } from "@/components/staff/tables-operations-view"

// TablesProvider/KitchenOrdersProvider both come from the shared
// (operations) layout.tsx (Task 16) -- this page needs both (table CRUD +
// the moved-in "Served"/"Confirm Cash" actions).
export default async function StaffTablesPage() {
  const t = await getTranslations("Staff")
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="sr-only">{t("tablesTitle")}</h1>
      <TablesOperationsView />
    </div>
  )
}
