import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { ProductDetail } from "@/components/customer/product-detail"
import { resolvePhadinMenuItemById } from "@/lib/phadin-menu-catalog"
import { createClient } from "@/lib/supabase/server"
import { getMenuItemById } from "@/lib/supabase/menu-data"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  const { itemId } = await params
  const supabase = await createClient()
  const dbItem = await getMenuItemById(supabase, itemId).catch(() => null)
  const item = resolvePhadinMenuItemById(itemId, dbItem)
  if (!item) notFound()

  const t = await getTranslations("Customer")
  return (
    <>
      <h1 className="sr-only">{t("menuTitle")}</h1>
      <ProductDetail item={item} />
    </>
  )
}
