"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { X, Gift, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatNumber, formatOrderId } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { getRewardsCatalog, redeemReward, type Reward } from "@/lib/supabase/rewards-data"
import { BottomSheet } from "@/components/motion/bottom-sheet"

/**
 * Rewards catalog + redemption modal, opened from the Loyalty page's
 * "Redeem Rewards" card. Lists the live `rewards` catalog
 * (`getRewardsCatalog`) and lets the customer spend points via the
 * `redeem_reward()` RPC (`redeemReward`). On success it calls
 * `onRedeemed` so the parent re-fetches balance + transaction history.
 * The RPC's raw machine-readable error messages
 * (`insufficient_points` / `reward_inactive` / `reward_not_found` /
 * `not_authenticated`) are mapped to translated user-facing strings —
 * substring-matched, since Postgres may wrap the raised message.
 */
export function RewardsCatalogModal({
  balance,
  onClose,
  onRedeemed,
}: {
  balance: number
  onClose: () => void
  onRedeemed: () => void
}) {
  const t = useTranslations("Loyalty")
  const tMenu = useTranslations("Menu")
  const locale = useLocale()
  const [supabase] = useState(() => createClient())
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successName, setSuccessName] = useState<string | null>(null)
  const [redemptionCode, setRedemptionCode] = useState<string | null>(null)

  useEffect(() => {
    getRewardsCatalog(supabase).then(setRewards).catch(() => setRewards([]))
  }, [supabase])

  function mapError(message: string): string {
    if (message.includes("insufficient_points")) return t("errorInsufficientPoints")
    if (message.includes("reward_inactive")) return t("errorRewardInactive")
    if (message.includes("reward_not_found")) return t("errorRewardNotFound")
    if (message.includes("not_authenticated")) return t("errorNotAuthenticated")
    return t("errorGeneric")
  }

  async function handleRedeem(reward: Reward) {
    setError(null)
    setRedeemingId(reward.id)
    try {
      const redemptionId = await redeemReward(supabase, reward.id)
      setRedemptionCode(formatOrderId(redemptionId))
      setSuccessName(locale === "vi" ? reward.nameVi : reward.nameEn)
      onRedeemed()
    } catch (e) {
      setError(mapError(e instanceof Error ? e.message : String(e)))
    } finally {
      setRedeemingId(null)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="nb-border border-x-0 border-t-0 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <h2 className="font-bold text-card-foreground">{t("rewardsCatalogTitle")}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="nb-border-sm nb-press-sm flex h-10 w-10 items-center justify-center rounded-full bg-card text-muted-foreground"
          aria-label={tMenu("close")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {successName ? (
        <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
          <div className="nb-border-sm flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <p className="font-bold text-card-foreground">{successName}</p>
          <p className="text-sm text-muted-foreground">{t("redeemSuccess")}</p>
          {redemptionCode && (
            <div className="nb-border-sm rounded-xl bg-chip px-6 py-3">
              <p className="text-xs text-muted-foreground">{t("redemptionCodeLabel")}</p>
              <p className="text-2xl font-black tracking-widest text-primary">{redemptionCode}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("redemptionCodeHint")}</p>
          <Button variant="neubrutal" onClick={onClose} className="mt-2 h-11 px-6">
            {tMenu("close")}
          </Button>
        </div>
      ) : (
        <>
          <div className="nb-border border-x-0 border-t-0 px-5 py-3">
            <p className="text-sm text-muted-foreground">{t("rewardsCatalogSubtitle")}</p>
            <p className="mt-1 text-sm font-bold text-primary">
              {formatNumber(balance)} {t("pts")}
            </p>
          </div>

          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto px-5 py-4">
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            {rewards === null ? (
              <div className="flex justify-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : rewards.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyCatalog")}</p>
            ) : (
              rewards.map((reward) => {
                const affordable = balance >= reward.pointsCost
                const isRedeeming = redeemingId === reward.id
                return (
                  <div
                    key={reward.id}
                    className="nb-border-sm nb-shadow-sm flex items-center justify-between gap-3 rounded-xl bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-card-foreground">
                        {locale === "vi" ? reward.nameVi : reward.nameEn}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {locale === "vi" ? reward.descriptionVi : reward.descriptionEn}
                      </p>
                      <p className="mt-1 text-sm font-bold text-primary">
                        {formatNumber(reward.pointsCost)} {t("pts")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Button
                        variant="neubrutal"
                        onClick={() => handleRedeem(reward)}
                        disabled={!affordable || isRedeeming || redeemingId !== null}
                        className="h-10 px-5"
                      >
                        {isRedeeming ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t("redeemButton")
                        )}
                      </Button>
                      {!affordable && (
                        <span className={cn("text-[11px] font-medium text-muted-foreground")}>
                          {t("notEnoughPoints")}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </BottomSheet>
  )
}
