import { describe, expect, it } from "vitest"

import { computeCameraOrbit } from "./coffee-cup-orbit"

describe("computeCameraOrbit", () => {
  it("centers the orbit with no mouse movement or scroll", () => {
    expect(computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 0 })).toBe("0.0deg 75.0deg 105%")
  })

  it("rotates theta with horizontal mouse position", () => {
    expect(computeCameraOrbit({ mouseX: 1, mouseY: 0, scrollProgress: 0 })).toBe("25.0deg 75.0deg 105%")
    expect(computeCameraOrbit({ mouseX: -1, mouseY: 0, scrollProgress: 0 })).toBe("-25.0deg 75.0deg 105%")
  })

  it("tilts phi with vertical mouse position", () => {
    expect(computeCameraOrbit({ mouseX: 0, mouseY: 1, scrollProgress: 0 })).toBe("0.0deg 85.0deg 105%")
  })

  it("tilts phi down and zooms in as scroll progresses", () => {
    expect(computeCameraOrbit({ mouseX: 0, mouseY: 0, scrollProgress: 1 })).toBe("0.0deg 60.0deg 85%")
  })

  it("clamps out-of-range inputs instead of extrapolating", () => {
    expect(computeCameraOrbit({ mouseX: 5, mouseY: -5, scrollProgress: 2 })).toBe("25.0deg 50.0deg 85%")
  })
})
