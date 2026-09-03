import { getTranslations } from "next-intl/server"
import { headers } from "next/headers"
import { ProfileView } from "@/components/customer/profile-view"

export default async function ProfilePage() {
  const t = await getTranslations("Customer")
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null
  return (
    <>
      <h1 className="sr-only">{t("profileTitle")}</h1>
      <ProfileView role={role} />
    </>
  )
}
