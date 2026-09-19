import { getTranslations } from "next-intl/server"
import { MenuBrowser } from "@/components/customer/menu-browser"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"

export default async function MenuPage() {
  const t = await getTranslations("Customer")
  const { categories, items } = await getPublicMenuData()

  return (
    <>
      <h1 className="sr-only">{t("menuTitle")}</h1>
      <MenuBrowser categories={categories} items={items} canOrder={false} />
    </>
  )
}
