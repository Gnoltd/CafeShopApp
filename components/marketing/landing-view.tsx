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

      {/* 3. Merged Promotion Card & Category Buttons Section at End of Gallery */}
      <div className="mx-auto w-full max-w-xl px-4 py-12 sm:max-w-2xl md:max-w-4xl md:px-8 md:py-20 lg:max-w-5xl">
        <section className="nb-border nb-shadow relative overflow-hidden rounded-3xl bg-card p-6 sm:p-8 md:p-10">
          {/* Top Promotion Content */}
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex items-center gap-2 text-[#b3341f]">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span className="text-xs font-black uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xl font-extrabold text-card-foreground sm:text-2xl md:text-3xl">
                {t("promoTitle")}
              </h3>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {t("promoDescription")}
              </p>
            </div>

            <div>
              <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-[#b3341f] px-5 py-2 text-xs font-black text-white sm:text-sm">
                {t("promoBadge")}
              </span>
            </div>
          </div>

          {/* Seamless Inner Separator */}
          <div className="my-6 h-px w-full bg-border/60 sm:my-8" />

          {/* Integrated Responsive Category Pill Buttons */}
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
              {t("categories")}
            </span>
            <div className="flex w-full flex-wrap items-center justify-center gap-2.5 sm:gap-3.5">
              {CATEGORY_CHIPS.map((category) => {
                const label = locale === "vi" ? category.labelVi : category.labelEn
                return (
                  <Link
                    key={category.id}
                    href="/menu"
                    className="nb-border-sm nb-shadow-sm nb-press-sm flex items-center gap-1.5 rounded-full bg-card px-5 py-2 text-xs font-extrabold text-foreground transition-all hover:bg-muted/80 sm:px-6 sm:py-2.5 sm:text-sm"
                  >
                    <span>{label}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
