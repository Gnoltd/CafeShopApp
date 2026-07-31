import { describe, expect, it } from "vitest"

import { computeCameraOrbit } from "./coffee-cup-orbit"

const rad = (deg: number): number => (deg * Math.PI) / 180
const BASE_RADIUS_AT_SCROLL = (scroll: number): number => (0.6 * (105 - scroll * 15)) / 100

describe("computeCameraOrbit", () => {
  it("centers the orbit with no mouse movement or scroll", () => {
    expect(computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 })).toEqual({
      theta: rad(0),
      phi: rad(78),
      radius: BASE_RADIUS_AT_SCROLL(0),
    })
  })

  it("rotates theta with horizontal mouse position", () => {
    expect(computeCameraOrbit({ mouseX: 1, mouseY: 0, scrollProgress: 0 }).theta).toBeCloseTo(rad(25), 10)
    expect(computeCameraOrbit({ mouseX: -1, mouseY: 0, scrollProgress: 0 }).theta).toBeCloseTo(rad(-25), 10)
  })

  it("tilts phi with vertical mouse position", () => {
    expect(computeCameraOrbit({ mouseX: 0, mouseY: 1, scrollProgress: 0 }).phi).toBeCloseTo(rad(86), 10)
  })

  it("tilts phi down and zooms in as scroll progresses", () => {
    const result = computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 1 })
    expect(result.phi).toBeCloseTo(rad(66), 10)
    expect(result.radius).toBeCloseTo(BASE_RADIUS_AT_SCROLL(1), 10)
  })

  it("clamps out-of-range inputs instead of extrapolating", () => {
    const result = computeCameraOrbit({ mouseX: 5, mouseY: -5, scrollProgress: 2 })
    expect(result.theta).toBeCloseTo(rad(25), 10)
    expect(result.phi).toBeCloseTo(rad(58), 10)
    expect(result.radius).toBeCloseTo(BASE_RADIUS_AT_SCROLL(1), 10)
  })
})
