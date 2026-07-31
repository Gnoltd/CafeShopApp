export type CameraOrbitInput = {
  mouseX: number
  mouseY: number
  scrollProgress: number
}

export type CameraOrbit = {
  theta: number
  phi: number
  radius: number
}

// Degrees (converted to radians below) — ported from the Claude Design
// reference this hero was built from (project 5cac76df, "3D Coffee Shop
// Hero Model", file "Landing Page.dc.html"), not re-derived.
const BASE_PHI_DEG = 78
const THETA_RANGE_DEG = 25
const PHI_MOUSE_RANGE_DEG = 8
const PHI_SCROLL_RANGE_DEG = 12

// World-space camera distance for a model normalized to MODEL_TARGET_HEIGHT
// (see coffee-cup-hero.tsx). BASE_RADIUS/RADIUS_SCROLL_RANGE mirror the
// reference's 0-120-ish scale; IDEAL_DIST converts that into an actual
// three.js unit distance — also ported as-is.
const BASE_RADIUS = 105
const RADIUS_SCROLL_RANGE = 15
const IDEAL_DIST = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Spherical camera position (theta/phi in radians, radius in three.js world
 * units) driven by smoothed mouse position and hero scroll progress — the
 * camera orbits a stationary, centered cup. Auto-rotate is applied
 * separately, directly to the cup mesh's own rotation.y in
 * coffee-cup-hero.tsx, matching the reference (which spins the object, not
 * the camera).
 */
export function computeCameraOrbit({ mouseX, mouseY, scrollProgress }: CameraOrbitInput): CameraOrbit {
  const x = clamp(mouseX, -1, 1)
  const y = clamp(mouseY, -1, 1)
  const scroll = clamp(scrollProgress, 0, 1)

  const theta = deg2rad(x * THETA_RANGE_DEG)
  const phi = deg2rad(BASE_PHI_DEG + y * PHI_MOUSE_RANGE_DEG - scroll * PHI_SCROLL_RANGE_DEG)
  const radius = (IDEAL_DIST * (BASE_RADIUS - scroll * RADIUS_SCROLL_RANGE)) / 100

  return { theta, phi, radius }
}
