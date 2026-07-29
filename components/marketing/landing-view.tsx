"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { LandingNav } from "@/components/marketing/landing-nav"
import { CoffeeCupHero } from "@/components/marketing/coffee-cup-hero"
import { formatVND } from "@/lib/format"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import { ItemImage } from "@/components/customer/item-image"
import type { MenuItem } from "@/lib/supabase/menu-data"
import type { LandingHeroSettings } from "@/lib/supabase/settings-data"

const CATEGORY_CHIPS = [
  { id: "coffee", labelVi: "Cà Phê", labelEn: "Coffee" },
  { id: "tea", labelVi: "Trà", labelEn: "Tea" },
  { id: "pastries", labelVi: "Bánh Ngọt", labelEn: "Pastries" },
  { id: "blended", labelVi: "Đá Xay", labelEn: "Blended" },
]

export function LandingView({
  bestSellers,
  landingHero,
  userName = null,
}: {
  bestSellers: MenuItem[]
  landingHero: LandingHeroSettings
  userName?: string | null
}) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  return (
    <div className="w-full">
      <div className="relative">
        <LandingNav userName={userName} />
        <CoffeeCupHero
          onScanQr={() => setIsScannerOpen(true)}
          baseImages={landingHero.baseImages}
          revealImage={landingHero.revealImage}
        />
      </div>

      <div className="mx-auto w-full max-w-2xl md:max-w-6xl md:px-8">
        <section className="px-4 pt-6 md:px-0">
          <div className="nb-border nb-shadow relative overflow-hidden rounded-xl bg-card p-5 md:p-8">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-extrabold uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            <h3 className="mb-1 font-extrabold text-card-foreground md:text-xl">{t("promoTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground md:text-base md:max-w-2xl">{t("promoDescription")}</p>
            <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-primary px-4 py-1.5 text-sm font-extrabold text-primary-foreground">
              {t("promoBadge")}
            </span>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between px-4 md:px-0">
            <div>
              <h3 className="font-bold text-card-foreground md:text-xl">{t("bestSellers")}</h3>
              <div className="mt-1 h-1 w-10 rounded-full bg-primary" />
            </div>
            <Link href="/menu" className="text-sm font-medium text-secondary hover:underline">
              {t("viewAll")}
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2 md:grid md:grid-cols-4 md:gap-6 md:overflow-x-visible md:px-0">
            {bestSellers.map((item) => {
              const name = locale === "vi" ? item.nameVi : item.nameEn
              return (
                <Link
                  key={item.id}
                  href="/menu"
                  className="nb-border nb-shadow nb-press flex w-36 shrink-0 flex-col gap-2 rounded-xl bg-card p-2 md:w-auto md:shrink"
                >
                  <ItemImage item={item} className="h-32 w-full rounded-lg md:h-40" />
                  <h4 className="text-sm font-bold leading-tight text-card-foreground">{name}</h4>
                  <span className="font-extrabold text-price">{formatVND(item.basePrice)}</span>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="mt-8 flex gap-2 overflow-x-auto px-4 pb-8 md:flex-wrap md:justify-center md:gap-4 md:px-0">
          <span className="mb-1 sr-only">{t("categories")}</span>
          {CATEGORY_CHIPS.map((category) => {
            const label = locale === "vi" ? category.labelVi : category.labelEn
            return (
              <Link
                key={category.id}
                href="/menu"
                className="nb-border-sm nb-shadow-sm nb-press-sm flex shrink-0 items-center gap-1 rounded-full bg-card px-4 py-2 text-sm font-extrabold text-foreground"
              >
                {label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )
          })}
        </section>
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
