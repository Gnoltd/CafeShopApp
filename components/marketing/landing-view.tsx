"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Sparkles } from "lucide-react"
import { LandingNav } from "@/components/marketing/landing-nav"
import { CoffeeCupHero } from "@/components/marketing/coffee-cup-hero"
import { BestSellersGallery } from "@/components/marketing/best-sellers-gallery"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import type { MenuItem } from "@/lib/supabase/menu-data"
import type { LandingHeroSettings } from "@/lib/supabase/settings-data"

export function LandingView({
  bestSellers,
  landingHero,
  userName = null,
}: {
  bestSellers: MenuItem[]
  landingHero: LandingHeroSettings
  userName?: string | null
}) {
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

      {/* 2. Promotion Banner (Middle section between Hero & Best Sellers) */}
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:max-w-6xl md:px-8 md:py-12">
        <section>
          <div className="nb-border nb-shadow relative overflow-hidden rounded-xl bg-card p-5 md:p-8">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-extrabold uppercase tracking-wider">{t("promoLabel")}</span>
            </div>
            <h3 className="mb-1 font-extrabold text-card-foreground md:text-xl">{t("promoTitle")}</h3>
            <p className="mb-3 text-sm text-muted-foreground md:base md:max-w-2xl">{t("promoDescription")}</p>
            <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-primary px-4 py-1.5 text-sm font-extrabold text-primary-foreground">
              {t("promoBadge")}
            </span>
          </div>
        </section>
      </div>

      {/* 3. Best Sellers Motion Horizontal Scrollable Gallery Section */}
      <BestSellersGallery items={bestSellers} />

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
