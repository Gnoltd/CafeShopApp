"use client"

import { useEffect, useRef, useState } from "react"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { computeCameraOrbit } from "@/lib/coffee-cup-orbit"
import { cn } from "@/lib/utils"

type RenderMode = "checking" | "model" | "fallback"

const MODEL_PATH = "/models/coffee-cup.glb"
const AUTO_ROTATE_DEG_PER_SEC = 6

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
  revealImage,
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
  const modelRef = useRef<HTMLElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const smooth = useRef({ x: 0, y: 0 })
  const scrollProgress = useRef(0)
  const rotation = useRef(0)
  const lastFrameTime = useRef<number | null>(null)
  const rafRef = useRef(0)

  // Feature-detect WebGL, then lazily register the <model-viewer> custom
  // element client-side only — importing it at module scope would call
  // customElements.define() during Next.js SSR, where it doesn't exist.
  useEffect(() => {
    if (!isWebGLAvailable()) {
      setRenderMode("fallback")
      return
    }
    import("@google/model-viewer").then(() => setRenderMode("model"))
  }, [])

  useEffect(() => {
    if (renderMode !== "model") return
    const el = modelRef.current
    if (!el) return
    const handleError = () => setRenderMode("fallback")
    el.addEventListener("error", handleError)
    return () => el.removeEventListener("error", handleError)
  }, [renderMode])

  useEffect(() => {
    if (renderMode !== "model") return
    const el = modelRef.current

    // Respect the OS-level reduced-motion preference: freeze on a static
    // orbit instead of the continuous auto-rotate/parallax loop. This runs
    // outside Framer Motion (imperative model-viewer attribute updates), so
    // the (marketing) layout's MotionConfig reducedMotion="user" doesn't
    // cover it — needs its own check.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el?.setAttribute("camera-orbit", computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 }))
      return
    }

    const onMouseMove = (e: MouseEvent) => {
      mouse.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      }
    }
    const onScroll = () => {
      const hero = document.getElementById("coffee-cup-hero")
      if (!hero) return
      const rect = hero.getBoundingClientRect()
      scrollProgress.current = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)))
    }

    const tick = (timestamp: number) => {
      const last = lastFrameTime.current ?? timestamp
      const deltaSeconds = (timestamp - last) / 1000
      lastFrameTime.current = timestamp
      rotation.current += AUTO_ROTATE_DEG_PER_SEC * deltaSeconds

      smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1
      smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1
      // Updated imperatively (not via React state) because this runs every
      // animation frame — routing it through React re-renders would be
      // wasteful and isn't needed since nothing else in the tree depends on it.
      modelRef.current?.setAttribute(
        "camera-orbit",
        computeCameraOrbit({
          mouseX: smooth.current.x,
          mouseY: smooth.current.y,
          scrollProgress: scrollProgress.current,
          rotationDeg: rotation.current,
        })
      )
      rafRef.current = requestAnimationFrame(tick)
    }
    const startLoop = () => {
      if (rafRef.current) return
      lastFrameTime.current = null
      rafRef.current = requestAnimationFrame(tick)
    }
    const stopLoop = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("scroll", onScroll, { passive: true })

    // Stop burning GPU/battery once the hero scrolls out of view (the loop
    // previously ran indefinitely, including hundreds of vh past the hero
    // into the gallery below), and resume if the user scrolls back up.
    const heroEl = document.getElementById("coffee-cup-hero")
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) startLoop()
        else stopLoop()
      },
      { threshold: 0 }
    )
    if (heroEl) {
      observer.observe(heroEl)
    } else {
      startLoop()
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("scroll", onScroll)
      stopLoop()
      observer.disconnect()
    }
  }, [renderMode])

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

      {/* Giant brand-red circle, bleeding off the top-right corner — sized as
          a % of the section so it scales down gracefully on narrow screens
          instead of overflowing the viewport horizontally. */}
      <div
        className="absolute -right-[14%] -top-[18%] z-[2] aspect-square w-[85%] rounded-full bg-primary sm:w-[70%] md:w-[62%]"
        aria-hidden
      />
      <div className="absolute -right-[14%] -top-[18%] z-[5] flex aspect-square w-[85%] items-center justify-center sm:w-[70%] md:w-[62%]">
        {renderMode === "model" && (
          <model-viewer
            ref={modelRef}
            // A root-relative path here gets mis-resolved by model-viewer's
            // internal loader against the current locale route (producing
            // "/en/models/..." instead of "/models/..."), so it's resolved
            // to a fully-qualified URL up front instead. Safe to read
            // window.location here — this branch only renders client-side,
            // after the WebGL-availability effect above has already run.
            src={new URL(MODEL_PATH, window.location.origin).toString()}
            alt=""
            // No `scale` attribute: model-viewer's default camera auto-fits to
            // the model's bounding box regardless of `scale`, so it has no
            // effect on apparent on-screen size (see BASE_RADIUS in
            // lib/coffee-cup-orbit.ts for the constant that actually controls
            // this — this dead lever misled two prior "shrink the cup" commits).
            camera-orbit={computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 })}
            exposure="1"
            shadow-intensity="1"
            loading="eager"
            className="h-full w-full"
          />
        )}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start justify-center gap-7 px-6 py-28 sm:gap-8 md:max-w-[1180px] md:px-12">
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
            className="hero-anim hero-fade flex w-full max-w-xs flex-wrap items-start gap-4 sm:max-w-none sm:flex-row sm:items-center"
            style={{ animationDelay: "0.85s" }}
          >
            <Link
              href="/menu"
              className="w-full rounded-full bg-primary px-7 py-3.5 text-center text-sm font-semibold text-primary-foreground transition-all hover:scale-[1.03] hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-95 sm:w-auto"
            >
              {t("orderNow")}
            </Link>
            <button
              type="button"
              onClick={onScanQr}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-[#fff8f2]/40 bg-transparent px-7 py-3.5 text-sm font-semibold text-[#fff8f2] transition-all hover:scale-[1.03] hover:bg-white/10 active:scale-95 sm:w-auto"
            >
              <QrCode className="h-4 w-4" aria-hidden />
              {t("scanQr")}
            </button>
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
