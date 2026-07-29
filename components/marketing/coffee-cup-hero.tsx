"use client"

import { useEffect, useRef, useState } from "react"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { computeCameraOrbit } from "@/lib/coffee-cup-orbit"
import { cn } from "@/lib/utils"

type RenderMode = "checking" | "model" | "fallback"

const MODEL_PATH = "/models/coffee-cup.glb"
const MODEL_SCALE = 0.55

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
  revealImage: string | null
}) {
  const t = useTranslations("Landing")
  const [renderMode, setRenderMode] = useState<RenderMode>("checking")
  const modelRef = useRef<HTMLElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const smooth = useRef({ x: 0, y: 0 })
  const scrollProgress = useRef(0)
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
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("scroll", onScroll, { passive: true })

    const tick = () => {
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
        })
      )
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(rafRef.current)
    }
  }, [renderMode])

  return (
    <section
      id="coffee-cup-hero"
      className="relative h-screen w-full overflow-hidden bg-black"
      style={{ height: "100dvh" }}
    >
      {/* The photo crossfade and the 3D cup don't read well layered together
          (flat photography behind a synthetically-lit 3D render looks like a
          sticker, not one scene) — the photos only show when there's no 3D
          model on top: while WebGL support is still being checked, or as the
          permanent fallback. The 3D layer gets its own brand-colored glow
          below instead of competing photography. */}
      {renderMode !== "model" &&
        baseImages.map((image, index) => (
          <div
            key={image}
            className={cn(
              "hero-crossfade absolute inset-0 z-10 bg-cover bg-center bg-no-repeat",
              index === 0 && "hero-crossfade-first"
            )}
            style={{ backgroundImage: `url(${image})`, animationDelay: `${index * 6}s` }}
          />
        ))}

      {renderMode === "model" && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            background:
              "radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--primary) 20%, transparent), transparent 60%)",
          }}
          aria-hidden
        />
      )}

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
          poster={revealImage ?? undefined}
          alt=""
          scale={`${MODEL_SCALE} ${MODEL_SCALE} ${MODEL_SCALE}`}
          camera-orbit={computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 })}
          exposure="1"
          shadow-intensity="1"
          loading="eager"
          className="absolute inset-0 z-30 h-full w-full"
        />
      )}

      {renderMode !== "model" && revealImage && (
        <div
          className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${revealImage})` }}
        />
      )}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-28 bg-gradient-to-t from-background to-transparent"
        aria-hidden
      />

      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6 text-center sm:gap-8">
        <h1 className="leading-[0.95] text-white">
          <span
            className="hero-anim hero-reveal font-playfair block text-5xl font-normal italic sm:text-7xl md:text-8xl"
            style={{ letterSpacing: "-0.05em", animationDelay: "0.25s" }}
          >
            {t("heroLine1")}
          </span>
          <span
            className="hero-anim hero-reveal -mt-1 block text-5xl font-normal sm:text-7xl md:text-8xl"
            style={{ letterSpacing: "-0.08em", animationDelay: "0.42s" }}
          >
            {t("heroLine2")}
          </span>
        </h1>
        <div
          className="hero-anim hero-fade flex max-w-sm flex-col gap-2 sm:max-w-md"
          style={{ animationDelay: "0.6s" }}
        >
          <p className="hidden text-sm leading-relaxed text-white/80 sm:block sm:text-base">
            {t("heroLeftText")}
          </p>
          <p className="text-sm leading-relaxed text-white/80 sm:text-base">{t("heroRightText")}</p>
        </div>
        <div
          className="hero-anim hero-fade flex w-full max-w-xs flex-col items-center gap-4"
          style={{ animationDelay: "0.85s" }}
        >
          <Link
            href="/menu"
            className="w-full rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition-all hover:scale-[1.03] hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-95"
          >
            {t("orderNow")}
          </Link>
          <button
            type="button"
            onClick={onScanQr}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/70 px-7 py-3 text-sm font-medium text-white transition-all hover:scale-[1.03] hover:bg-white/10 active:scale-95"
          >
            <QrCode className="h-4 w-4" aria-hidden />
            {t("scanQr")}
          </button>
        </div>
      </div>
    </section>
  )
}
