import { getTranslations } from "next-intl/server"
import { MenuManagement } from "@/components/admin/menu-management"
import { resolvePhadinCatalog, syncPhadinMenuIfNeeded } from "@/lib/phadin-menu-catalog"
import { createClient } from "@/lib/supabase/server"
import { getCategories, getMenuItems } from "@/lib/supabase/menu-data"

export default async function AdminMenuPage() {
  const t = await getTranslations("Admin")
  const supabase = await createClient()
  let [categories, items] = await Promise.all([getCategories(supabase), getMenuItems(supabase)])
  const synced = await syncPhadinMenuIfNeeded(supabase, items)
  if (synced) {
    ;[categories, items] = await Promise.all([getCategories(supabase), getMenuItems(supabase)])
  }
  const resolved = resolvePhadinCatalog(categories, items)

  return (
    <>
      <h1 className="sr-only">{t("menuTitle")}</h1>
      <MenuManagement categories={resolved.categories} initialItems={resolved.items} />
    </>
  )
}
