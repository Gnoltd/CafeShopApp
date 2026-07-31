"use client"

import { useEffect, useRef, useState } from "react"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { Link } from "@/i18n/navigation"
import { computeCameraOrbit } from "@/lib/coffee-cup-orbit"
import { cn } from "@/lib/utils"

type RenderMode = "checking" | "model" | "fallback"

const MODEL_PATH = "/models/coffee-cup.glb"
// Ported from the Claude Design reference (project 5cac76df, "3D Coffee Shop
// Hero Model"): the model is rescaled to this height after loading (not
// relying on the source file's native scale) and the camera uses this FOV —
// together these are what actually determine the cup's on-screen size,
// unlike model-viewer's opaque "auto-fit %" this hero used previously.
const MODEL_TARGET_HEIGHT = 0.2
const CAMERA_FOV_DEG = 35
// 0.006 rad/frame at 60fps in the reference, converted to a frame-rate-
// independent rad/sec figure (the reference's raw per-frame increment would
// visibly spin faster on a 144Hz display than a 60Hz one).
const AUTO_ROTATE_RAD_PER_SEC = 0.36

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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const smooth = useRef({ x: 0, y: 0 })
  const scrollProgress = useRef(0)
  const lastFrameTime = useRef<number | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    setRenderMode(isWebGLAvailable() ? "model" : "fallback")
  }, [])

  useEffect(() => {
    if (renderMode !== "model") return
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 10)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    // SRGBColorSpace (the modern default) gamma-corrects the linear-lit
    // scene for display — three@0.128's actual old default (LinearEncoding)
    // skipped this step entirely, a well-known footgun that renders scenes
    // far too dark on screen; it's not something worth reproducing.
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.35
    const isMobileDevice = typeof window !== "undefined" && window.innerWidth < 768
    renderer.setPixelRatio(isMobileDevice ? 1 : Math.min(window.devicePixelRatio, 2))

    const setSize = () => {
      const w = canvas.clientWidth || 1
      const h = canvas.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    setSize()

    scene.add(new THREE.AmbientLight(0xffffff, 1.4))
    scene.add(new THREE.HemisphereLight(0xfff5ea, 0x3d281c, 1.2))

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(0.8, 1.2, 1.0)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xffe8d6, 1.0)
    fillLight.position.set(-1.0, -0.5, -0.8)
    scene.add(fillLight)

    let cup: THREE.Object3D | null = null
    let disposed = false

    new GLTFLoader().load(
      MODEL_PATH,
      (gltf) => {
        if (disposed) return
        const loaded = gltf.scene
        const size = new THREE.Box3().setFromObject(loaded).getSize(new THREE.Vector3())
        loaded.scale.setScalar(MODEL_TARGET_HEIGHT / (size.y || 1))
        const center = new THREE.Box3().setFromObject(loaded).getCenter(new THREE.Vector3())
        loaded.position.sub(center)
        loaded.rotation.y = Math.PI * 0.15
        scene.add(loaded)
        cup = loaded
      },
      undefined,
      () => setRenderMode("fallback")
    )

    const renderStaticOrbit = () => {
      const orbit = computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 })
      camera.position.setFromSpherical(new THREE.Spherical(orbit.radius, orbit.phi, orbit.theta))
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }

    // Respect the OS-level reduced-motion preference: render one static
    // orbit instead of the continuous auto-rotate/parallax loop. The
    // (marketing) layout's MotionConfig reducedMotion="user" doesn't cover
    // this (imperative three.js render loop, not Framer Motion) — needs its
    // own check.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderStaticOrbit()
      const onResize = () => {
        setSize()
        renderStaticOrbit()
      }
      window.addEventListener("resize", onResize)
      return () => {
        disposed = true
        window.removeEventListener("resize", onResize)
        renderer.dispose()
      }
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
    const onResize = () => setSize()

    const tick = (timestamp: number) => {
      const last = lastFrameTime.current ?? timestamp
      const deltaSeconds = (timestamp - last) / 1000
      lastFrameTime.current = timestamp

      smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1
      smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1

      const orbit = computeCameraOrbit({
        mouseX: smooth.current.x,
        mouseY: smooth.current.y,
        scrollProgress: scrollProgress.current,
      })
      camera.position.setFromSpherical(new THREE.Spherical(orbit.radius, orbit.phi, orbit.theta))
      camera.lookAt(0, 0, 0)

      // Auto-rotate spins the cup mesh itself (not the camera around it),
      // matching the reference — camera-orbiting would keep the light's lit
      // side of the cup fixed relative to the viewer instead of turning.
      if (cup) cup.rotation.y += AUTO_ROTATE_RAD_PER_SEC * deltaSeconds

      renderer.render(scene, camera)
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
    window.addEventListener("resize", onResize)

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
      disposed = true
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      stopLoop()
      observer.disconnect()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const material = obj.material
          if (Array.isArray(material)) material.forEach((m) => m.dispose())
          else material.dispose()
        }
      })
      renderer.dispose()
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

      {/* Giant brand-red circle anchored to top-right edge on Laptop & Desktop
          (matching reference) and positioned gracefully on right edge on Mobile. */}
      <div
        className="pointer-events-none absolute -right-[22vw] top-[18%] z-[2] aspect-square w-[80vw] rounded-full bg-primary sm:w-[65vw] md:-right-[14vw] md:-top-[12vh] md:w-auto md:h-[124vh]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-[22vw] top-[18%] z-[5] flex aspect-square w-[80vw] items-center justify-center sm:w-[65vw] md:-right-[14vw] md:-top-[12vh] md:w-auto md:h-[124vh]">
        {renderMode === "model" && <canvas ref={canvasRef} className="h-full w-full" aria-hidden />}
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
