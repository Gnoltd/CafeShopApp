"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { LandingNav } from "@/components/marketing/landing-nav"
import { CoffeeCupHero } from "@/components/marketing/coffee-cup-hero"
import { BestSellersGallery } from "@/components/marketing/best-sellers-gallery"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
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
    <div className="w-full bg-background">
      {/* 1. Hero Section */}
      <div className="relative">
        <LandingNav userName={userName} />
        <CoffeeCupHero
          onScanQr={() => setIsScannerOpen(true)}
          baseImages={landingHero.baseImages}
          revealImage={landingHero.revealImage}
        />
      </div>

      {/* 2. Custom Scroll-Linked Curved Arc Motion Gallery Section */}
      <BestSellersGallery items={bestSellers} />

      {/* 3. End of Gallery: Promotion Banner Card & Category Chips (Matching exact reference layout) */}
      <div className="mx-auto w-full max-w-2xl py-12 md:max-w-6xl md:px-8 md:py-20">
        <section className="px-4 md:px-0">
          <div className="nb-border nb-shadow relative overflow-hidden rounded-3xl bg-card p-6 md:p-10">
            <div className="mb-2 flex items-center gap-2 text-[#b3341f]">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            <h3 className="mb-1 text-xl font-extrabold text-card-foreground md:text-3xl">{t("promoTitle")}</h3>
            <p className="mb-5 text-sm text-muted-foreground md:text-base md:max-w-2xl">{t("promoDescription")}</p>
            <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-[#b3341f] px-5 py-2 text-sm font-black text-white">
              {t("promoBadge")}
            </span>
          </div>
        </section>

        {/* 4 Category Pill Buttons */}
        <section className="mt-8 flex gap-3 overflow-x-auto px-4 pb-4 md:flex-wrap md:justify-center md:gap-5 md:px-0">
          <span className="sr-only">{t("categories")}</span>
          {CATEGORY_CHIPS.map((category) => {
            const label = locale === "vi" ? category.labelVi : category.labelEn
            return (
              <Link
                key={category.id}
                href="/menu"
                className="nb-border-sm nb-shadow-sm nb-press-sm flex shrink-0 items-center gap-1.5 rounded-full bg-card px-6 py-2.5 text-sm font-extrabold text-foreground transition-all hover:bg-card/80"
              >
                <span>{label}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )
          })}
        </section>
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
