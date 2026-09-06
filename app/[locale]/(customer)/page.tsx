import { getTranslations } from "next-intl/server"
import { HomeView } from "@/components/customer/home-view"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"
import { getShopSettings } from "@/lib/supabase/settings-data"
import { createClient } from "@/lib/supabase/server"

export default async function HomePage() {
  const t = await getTranslations("Customer")
  const supabase = await createClient()
  const [{ items }, shopSettings] = await Promise.all([getPublicMenuData(), getShopSettings(supabase)])

  return (
    <>
      <h1 className="sr-only">{t("homeTitle")}</h1>
      <HomeView items={items} shopSettings={shopSettings} />
    </>
  )
}
