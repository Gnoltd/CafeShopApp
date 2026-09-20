import { getTranslations } from "next-intl/server"
import { OrderHistoryList } from "@/components/staff/order-history-list"

export default async function OrderHistoryPage() {
  const t = await getTranslations("StaffOrderHistory")
  return (
    <div className="h-full overflow-y-auto">
      <h1 className="sr-only">{t("title")}</h1>
      <OrderHistoryList />
    </div>
  )
}
