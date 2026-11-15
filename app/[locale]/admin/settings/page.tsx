import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { SettingsView } from "@/components/admin/settings-view"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"
import { resolveRedirect } from "@/lib/roles"

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // Defense-in-depth matching AdminLayout: AdminLayout allows manager|admin
  // (for /admin/menu), whereas /admin/settings is admin-only. Resolve role
  // server-side independently of middleware headers.
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)

  const redirectPath = resolveRedirect("/admin/settings", role)
  if (redirectPath) {
    redirect(`/${locale}${redirectPath}`)
  }

  const t = await getTranslations("Admin")
  return (
    <>
      <h1 className="sr-only">{t("settingsTitle")}</h1>
      <SettingsView />
    </>
  )
}
