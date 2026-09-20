import { getTranslations } from "next-intl/server"
import { StaffShiftHistory } from "@/components/staff/staff-shift-history"

export default async function StaffShiftHistoryPage() {
  const t = await getTranslations("KitchenDisplay")
  return (
    <div className="h-full overflow-y-auto">
      <h1 className="sr-only">{t("shiftHistoryNav")}</h1>
      <StaffShiftHistory />
    </div>
  )
}
