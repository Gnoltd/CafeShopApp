import { getTranslations } from "next-intl/server"
import { HomeView } from "@/components/customer/home-view"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"

export default async function HomePage() {
  const t = await getTranslations("Customer")
  const { items } = await getPublicMenuData()

  return (
    <>
      <h1 className="sr-only">{t("homeTitle")}</h1>
      <HomeView items={items} />
    </>
  )
}
