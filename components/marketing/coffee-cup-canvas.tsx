"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { computeCameraOrbit } from "@/lib/coffee-cup-orbit"

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

// Split out of coffee-cup-hero.tsx so `three` + GLTFLoader (500-600KB+) only
// load once this mounts, via next/dynamic(..., { ssr: false }) in the parent
// -- the parent's headline/CTA text stays server-rendered. Only mounted once
// the parent has confirmed WebGL is available.
export function CoffeeCupCanvas({ onError }: { onError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const smooth = useRef({ x: 0, y: 0 })
  const scrollProgress = useRef(0)
  const lastFrameTime = useRef<number | null>(null)
  const rafRef = useRef(0)
  // Kept current every render but read only inside the effect below, so the
  // scene-setup effect can stay mount-only ([]) instead of tearing down and
  // rebuilding the whole THREE scene whenever the parent passes a new
  // (inline) onError reference on an unrelated re-render.
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
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
      () => onErrorRef.current()
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
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
}
