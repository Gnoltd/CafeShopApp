import { describe, it, expect } from "vitest"
import { formatKitchenClock } from "./kitchen-clock"

describe("formatKitchenClock", () => {
  it("formats a fixed UTC instant as Asia/Ho_Chi_Minh wall-clock time (en, 12h)", () => {
    const utc = Date.UTC(2026, 6, 12, 10, 30, 45) // 2026-07-12T10:30:45Z -> 17:30:45 ICT (UTC+7)
    expect(formatKitchenClock(utc, "en")).toBe("05:30:45 PM")
  })

  it("formats the same instant for vi as 24-hour time", () => {
    const utc = Date.UTC(2026, 6, 12, 10, 30, 45)
    expect(formatKitchenClock(utc, "vi")).toBe("17:30:45")
  })

  it("stays pinned to Asia/Ho_Chi_Minh regardless of the host machine's local timezone", () => {
    // Regression guard for the real bug: SSR (Vercel, UTC) and hydration
    // (the browser's local timezone) must render identical text for the
    // same instant, or React throws a hydration mismatch (error #418).
    const utc = Date.UTC(2026, 0, 1, 23, 15, 0) // crosses a UTC day boundary
    // Independently verified: 2026-01-01T23:15:00Z + 7h = 2026-01-02T06:15:00 ICT
    expect(formatKitchenClock(utc, "vi")).toBe("06:15:00")
  })
})
