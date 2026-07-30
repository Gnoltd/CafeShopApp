export type CameraOrbitInput = {
  mouseX: number
  mouseY: number
  scrollProgress: number
  rotationDeg?: number
}

const BASE_PHI = 75
const THETA_RANGE = 25
const PHI_MOUSE_RANGE = 10
const PHI_SCROLL_RANGE = 15
const BASE_RADIUS = 105
const RADIUS_SCROLL_RANGE = 20

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * model-viewer `camera-orbit` attribute string, driven by smoothed mouse
 * position and hero scroll progress (see coffee-cup-hero.tsx).
 * `rotationDeg` is an unbounded, continuously-growing auto-rotate offset
 * added straight to theta (unclamped — model-viewer wraps azimuthal angle
 * on its own), so it keeps spinning slowly on top of the mouse-driven tilt.
 */
export function computeCameraOrbit({ mouseX, mouseY, scrollProgress, rotationDeg = 0 }: CameraOrbitInput): string {
  const x = clamp(mouseX, -1, 1)
  const y = clamp(mouseY, -1, 1)
  const scroll = clamp(scrollProgress, 0, 1)

  const theta = x * THETA_RANGE + rotationDeg
  const phi = BASE_PHI + y * PHI_MOUSE_RANGE - scroll * PHI_SCROLL_RANGE
  const radius = BASE_RADIUS - scroll * RADIUS_SCROLL_RANGE

  return `${theta.toFixed(1)}deg ${phi.toFixed(1)}deg ${radius.toFixed(0)}%`
}
