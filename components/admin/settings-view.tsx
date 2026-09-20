"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Store, Check, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  getShopSettings,
  updateShopSettings,
  type ShopSettings,
} from "@/lib/supabase/settings-data"

type ShopDraft = { shopName: string; address: string; phone: string; openingHours: string }

const EMPTY_SHOP: ShopDraft = { shopName: "", address: "", phone: "", openingHours: "" }

function toShopDraft(s: ShopSettings): ShopDraft {
  return {
    shopName: s.shopName,
    address: s.address,
    phone: s.phone,
    openingHours: s.openingHours,
  }
}

export function SettingsView() {
  const t = useTranslations("AdminSettings")
  const [supabase] = useState(() => createClient())

  const [savedShop, setSavedShop] = useState<ShopDraft>(EMPTY_SHOP)
  const [shopDraft, setShopDraft] = useState<ShopDraft>(EMPTY_SHOP)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    getShopSettings(supabase)
      .then((shop) => {
        setSavedShop(toShopDraft(shop))
        setShopDraft(toShopDraft(shop))
      })
      .catch(() => setError(t("loadError")))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateShop<K extends keyof ShopDraft>(key: K, value: ShopDraft[K]) {
    setShopDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      await updateShopSettings(supabase, shopDraft)
      setSavedShop(shopDraft)
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
        </CardContent>
      </Card>

      {/* A full-width banner above the buttons (matching the reference)
          rather than inline text next to them -- at mobile widths, two
          fixed-width buttons plus an inline "saved" message overflowed the
          row (measured with the Vietnamese strings, which run longer). */}
      {justSaved && (
        <p role="status" className="flex items-center gap-1.5 rounded-lg bg-success/15 px-3 py-2 text-sm font-semibold text-success">
          <Check className="h-4 w-4 shrink-0" />
          {t("savedMessage")}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="neubrutal" className="h-11 flex-1 bg-card text-foreground" onClick={handleCancel} disabled={isSaving}>
          {t("cancel")}
        </Button>
        <Button variant="neubrutal" onClick={handleSave} disabled={isSaving} className="h-11 flex-1">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("saveChanges")}
        </Button>
      </div>
    </div>
  )
}
