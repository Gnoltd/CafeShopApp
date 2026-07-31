"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Store, Gift, Check, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { LandingHeroSettingsCard } from "@/components/admin/landing-hero-settings-card"
import {
  getShopSettings,
  updateShopSettings,
  getLoyaltySettings,
  updateLoyaltySettings,
  type ShopSettings,
  type LoyaltySettings,
} from "@/lib/supabase/settings-data"

type ShopDraft = { shopName: string; address: string; phone: string; openingHours: string; taxRate: string }
type LoyaltyDraft = { enabled: boolean; earnRate: string; redeemRate: string }

const EMPTY_SHOP: ShopDraft = { shopName: "", address: "", phone: "", openingHours: "", taxRate: "0" }
const EMPTY_LOYALTY: LoyaltyDraft = { enabled: true, earnRate: "0", redeemRate: "0" }

function toShopDraft(s: ShopSettings): ShopDraft {
  return {
    shopName: s.shopName,
    address: s.address,
    phone: s.phone,
    openingHours: s.openingHours,
    taxRate: String(s.taxRatePercent),
  }
}

function toLoyaltyDraft(s: LoyaltySettings): LoyaltyDraft {
  return { enabled: s.enabled, earnRate: String(s.earnRateVndPerPoint), redeemRate: String(s.redeemValueVndPerPoint) }
}

export function SettingsView() {
  const t = useTranslations("AdminSettings")
  const [supabase] = useState(() => createClient())

  const [savedShop, setSavedShop] = useState<ShopDraft>(EMPTY_SHOP)
  const [shopDraft, setShopDraft] = useState<ShopDraft>(EMPTY_SHOP)
  const [savedLoyalty, setSavedLoyalty] = useState<LoyaltyDraft>(EMPTY_LOYALTY)
  const [loyaltyDraft, setLoyaltyDraft] = useState<LoyaltyDraft>(EMPTY_LOYALTY)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    Promise.all([getShopSettings(supabase), getLoyaltySettings(supabase)])
      .then(([shop, loyalty]) => {
        setSavedShop(toShopDraft(shop))
        setShopDraft(toShopDraft(shop))
        setSavedLoyalty(toLoyaltyDraft(loyalty))
        setLoyaltyDraft(toLoyaltyDraft(loyalty))
      })
      .catch(() => setError(t("loadError")))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateShop<K extends keyof ShopDraft>(key: K, value: ShopDraft[K]) {
    setShopDraft((prev) => ({ ...prev, [key]: value }))
  }

  function updateLoyalty<K extends keyof LoyaltyDraft>(key: K, value: LoyaltyDraft[K]) {
    setLoyaltyDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      await Promise.all([
        updateShopSettings(supabase, {
          shopName: shopDraft.shopName,
          address: shopDraft.address,
          phone: shopDraft.phone,
          openingHours: shopDraft.openingHours,
          taxRatePercent: Number(shopDraft.taxRate) || 0,
        }),
        updateLoyaltySettings(supabase, {
          enabled: loyaltyDraft.enabled,
          earnRateVndPerPoint: Number(loyaltyDraft.earnRate) || 0,
          redeemValueVndPerPoint: Number(loyaltyDraft.redeemRate) || 0,
        }),
      ])
      setSavedShop(shopDraft)
      setSavedLoyalty(loyaltyDraft)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch {
      setError(t("saveError"))
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setShopDraft(savedShop)
    setLoyaltyDraft(savedLoyalty)
    setError(null)
  }

  if (isLoading) {
    return <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h2 className="text-2xl font-bold text-card-foreground">{t("shopInfo")}</h2>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="h-5 w-5 text-primary" />
            {t("shopInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shop-name">{t("shopName")}</Label>
            <Input
              id="shop-name"
              value={shopDraft.shopName}
              onChange={(e) => updateShop("shopName", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">{t("address")}</Label>
            <Input
              id="address"
              value={shopDraft.address}
              onChange={(e) => updateShop("address", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input
                id="phone"
                value={shopDraft.phone}
                onChange={(e) => updateShop("phone", e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hours">{t("openingHours")}</Label>
              <Input
                id="hours"
                value={shopDraft.openingHours}
                onChange={(e) => updateShop("openingHours", e.target.value)}
                className="h-10"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-rate">{t("taxRate")}</Label>
            <Input
              id="tax-rate"
              type="number"
              min="0"
              step="0.01"
              value={shopDraft.taxRate}
              onChange={(e) => updateShop("taxRate", e.target.value)}
              className="h-10 max-w-[140px]"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="nb-border nb-shadow">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg font-extrabold">
            <span className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              {t("loyaltySettings")}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={loyaltyDraft.enabled}
              aria-label={t("loyaltyEnabled")}
              onClick={() => updateLoyalty("enabled", !loyaltyDraft.enabled)}
              className={cn(
                "nb-border-sm relative h-6 w-11 shrink-0 rounded-full transition-colors",
                loyaltyDraft.enabled ? "bg-primary" : "bg-chip"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-0 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  loyaltyDraft.enabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("space-y-4 transition-opacity", !loyaltyDraft.enabled && "opacity-50")}>
          <div className="space-y-2">
            <Label htmlFor="earn-rate">{t("earnRate")}</Label>
            <Input
              id="earn-rate"
              type="number"
              min="0"
              disabled={!loyaltyDraft.enabled}
              value={loyaltyDraft.earnRate}
              onChange={(e) => updateLoyalty("earnRate", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redeem-rate">{t("redeemRate")}</Label>
            <Input
              id="redeem-rate"
              type="number"
              min="0"
              disabled={!loyaltyDraft.enabled}
              value={loyaltyDraft.redeemRate}
              onChange={(e) => updateLoyalty("redeemRate", e.target.value)}
              className="h-10"
            />
          </div>
        </CardContent>
      </Card>

      <LandingHeroSettingsCard />

      <div className="flex items-center gap-3">
        <Button variant="neubrutal" className="h-11 bg-card px-6 text-foreground" onClick={handleCancel} disabled={isSaving}>
          {t("cancel")}
        </Button>
        <Button variant="neubrutal" onClick={handleSave} disabled={isSaving} className="h-11 px-6">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("saveChanges")}
        </Button>
        {justSaved && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
            <Check className="h-4 w-4" />
            {t("savedMessage")}
          </span>
        )}
      </div>
    </div>
  )
}
