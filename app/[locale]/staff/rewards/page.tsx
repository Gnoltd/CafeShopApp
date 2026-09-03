import { getTranslations } from "next-intl/server"
import { headers } from "next/headers"
import { StaffNav } from "@/components/staff/staff-nav"
import { RewardLookup } from "@/components/staff/reward-lookup"

export default async function StaffRewardsPage() {
  const t = await getTranslations("StaffRewards")
  // Resolved once in middleware.ts and reused here via a trusted, private
  // request header -- see app/[locale]/layout.tsx's matching comment for
  // why this can't be spoofed by a client.
  const role = (await headers()).get("x-resolved-role") || null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{t("title")}</h1>
      <StaffNav role={role} />
      <div className="flex-1 overflow-y-auto p-4">
        <RewardLookup />
      </div>
    </div>
  )
}
