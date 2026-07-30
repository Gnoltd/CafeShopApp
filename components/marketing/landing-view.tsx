"use client"

import { useState } from "react"
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

      {/* 2. Scroll-Linked Curved Arc Gallery + Integrated Merged Promotion Card */}
      <BestSellersGallery items={bestSellers} />

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
