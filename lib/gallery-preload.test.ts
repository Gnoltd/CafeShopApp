import { describe, it, expect } from "vitest"
import { isInPreloadBuffer } from "./gallery-preload"

describe("isInPreloadBuffer", () => {
  it("excludes indices already inside the animated window", () => {
    expect(isInPreloadBuffer(5, 5, 2, 4)).toBe(false)
    expect(isInPreloadBuffer(6, 5, 2, 4)).toBe(false)
    expect(isInPreloadBuffer(7, 5, 2, 4)).toBe(false)
  })

  it("includes indices in the buffer zone just past the window", () => {
    expect(isInPreloadBuffer(8, 5, 2, 4)).toBe(true)
    expect(isInPreloadBuffer(9, 5, 2, 4)).toBe(true)
  })

  it("excludes indices beyond the preload radius", () => {
    expect(isInPreloadBuffer(10, 5, 2, 4)).toBe(false)
  })

  it("is symmetric for indices behind the active index", () => {
    expect(isInPreloadBuffer(3, 5, 2, 4)).toBe(false)
    expect(isInPreloadBuffer(2, 5, 2, 4)).toBe(true)
    expect(isInPreloadBuffer(1, 5, 2, 4)).toBe(true)
    expect(isInPreloadBuffer(0, 5, 2, 4)).toBe(false)
  })
})
