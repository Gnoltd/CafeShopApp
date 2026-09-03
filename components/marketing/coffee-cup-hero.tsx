"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

type RenderMode = "checking" | "model" | "fallback"

// three + GLTFLoader (500-600KB+) only load once this mounts, and only when
// WebGL is actually available -- keeps the heavy 3D bundle out of the
// landing page's initial JS. ssr:false is safe: the canvas is purely
// client-side (WebGL) and this dynamic wrapper only ever renders after
// isWebGLAvailable() has already run client-side below.
const CoffeeCupCanvas = dynamic(
  () => import("@/components/marketing/coffee-cup-canvas").then((mod) => mod.CoffeeCupCanvas),
  { ssr: false }
)

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas")
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")))
  } catch {
    return false
  }
}

export function CoffeeCupHero({
  onScanQr,
  baseImages,
}: {
  onScanQr: () => void
  baseImages: string[]
  // Kept in the props contract (landing-view.tsx still passes it from
  // admin-configurable settings-data.ts) even though this hero no longer
  // uses it for anything — the circle only ever shows the 3D cup (never a
  // photo, not even during model load or as a no-WebGL/error fallback),
  // and the full-bleed background crossfade below uses baseImages instead.
  // Avoids touching the caller or the Admin Settings hero-image plumbing
  // for a purely visual restyle.
  revealImage?: string | null
}) {
  const t = useTranslations("Landing")
  const [renderMode, setRenderMode] = useState<RenderMode>("checking")

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRenderMode(isWebGLAvailable() ? "model" : "fallback")
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <section
      id="coffee-cup-hero"
      className="relative flex min-h-dvh w-full items-center overflow-hidden bg-[#2b2118]"
      style={{ minHeight: "100dvh" }}
    >
      {/* Full-bleed background crossfade through Admin Settings' hero
          photos, sitting behind everything else — the circle/cup never
          shows a photo (not during load, not as a no-WebGL/error
          fallback), only this background does. */}
      {baseImages.map((image, index) => (
        <div
          key={image}
          className={cn(
            "hero-crossfade absolute inset-0 z-0 bg-cover bg-center bg-no-repeat",
            index === 0 && "hero-crossfade-first"
          )}
          style={{ backgroundImage: `url(${image})`, animationDelay: `${index * 6}s` }}
        />
      ))}
      {/* Dark scrim between the crossfade and the foreground so the
          light-on-dark headline/CTAs stay legible regardless of which
          photo is currently showing. */}
      <div className="absolute inset-0 z-[1] bg-[#2b2118]/70" aria-hidden />

      {/* Giant brand-red circle arc anchored to bottom-right corner, bleeding past bottom & right edges across PC, Laptop,
          iPad, and Mobile viewports. */}
      <div
        className="pointer-events-none absolute -right-[14vw] -bottom-[12vh] z-[2] aspect-square w-[90vw] sm:w-[62vw] sm:-right-[15vw] sm:-bottom-[16vh] md:w-[50vw] rounded-full bg-primary"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-[14vw] -bottom-[8vh] z-[5] flex aspect-square w-[90vw] items-center justify-center sm:w-[62vw] sm:-right-[14vw] sm:-bottom-[16vh] md:-right-[9%] md:w-[50vw]">
        {renderMode === "model" && <CoffeeCupCanvas onError={() => setRenderMode("fallback")} />}
      </div>

      {/* Below xl, the circle now sits at the bottom, so the text starts at
          the top instead of vertically centering — centering would put it
          in the same vertical band the circle now occupies. */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start justify-start gap-7 px-6 py-28 sm:gap-8 md:max-w-[1180px] md:px-12 xl:justify-center">
        <div className="flex max-w-[460px] flex-col items-start gap-7 sm:gap-8">
          <h1 className="leading-[0.95] text-[#fff8f2]">
            <span
              className="hero-anim hero-reveal font-playfair block text-4xl font-normal italic sm:text-6xl md:text-6xl"
              style={{ letterSpacing: "-0.03em", animationDelay: "0.2s" }}
            >
              {t("heroLine1")}
            </span>
            <span
              className="hero-anim hero-reveal -mt-1 block text-4xl font-normal sm:text-6xl md:text-6xl"
              style={{ letterSpacing: "-0.03em", animationDelay: "0.4s" }}
            >
              {t("heroLine2")}
            </span>
          </h1>
          <p
            className="hero-anim hero-fade m-0 max-w-sm text-sm leading-relaxed text-[#fff8f2]/70 sm:text-base"
            style={{ animationDelay: "0.6s" }}
          >
            {t("heroLeftText")}
          </p>
          <div
            className="hero-anim hero-fade flex w-full max-w-xs flex-col items-start gap-4"
            style={{ animationDelay: "0.85s" }}
          >
            <button
              type="button"
              onClick={onScanQr}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-[#fff8f2]/40 bg-transparent px-7 py-3.5 text-sm font-semibold text-[#fff8f2] transition-all hover:scale-[1.03] hover:bg-white/10 active:scale-95"
            >
              <QrCode className="h-4 w-4" aria-hidden />
              {t("scanQr")}
            </button>
            <Link
              href="/menu"
              className="w-full rounded-full bg-primary px-7 py-3.5 text-center text-sm font-semibold text-primary-foreground transition-all hover:scale-[1.03] hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-95"
            >
              {t("orderNow")}
            </Link>
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-6 z-10 hidden items-center gap-2 text-xs font-medium text-[#fff8f2]/55 sm:flex md:bottom-8 md:left-8">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span>
          {t("scrollHintLine1")}
          <br />
          {t("scrollHintLine2")}
        </span>
      </div>
    </section>
  )
}
