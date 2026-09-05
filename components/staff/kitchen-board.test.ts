import { describe, it, expect } from "vitest"
import { urgencyLevelFor, paymentActionForOrder } from "./kitchen-board"

describe("urgencyLevelFor", () => {
  it("is normal just after creation", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 1000)).toBe("normal")
  })

  it("is normal right up to the 10-minute warning threshold", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 10 * 60_000 - 1)).toBe("normal")
  })

  it("becomes warning at exactly 10 minutes elapsed", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 10 * 60_000)).toBe("warning")
  })

  it("stays warning right up to the 15-minute critical threshold", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 15 * 60_000 - 1)).toBe("warning")
  })

  it("becomes critical at exactly 15 minutes elapsed", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 15 * 60_000)).toBe("critical")
  })

  it("stays critical well beyond the threshold", () => {
    const createdAt = 0
    expect(urgencyLevelFor(createdAt, createdAt + 45 * 60_000)).toBe("critical")
  })
})

describe("paymentActionForOrder", () => {
  const base = { id: "o", orderType: "dine-in" as const, status: "served" as const, paymentStatus: "pending", paymentMethod: null, createdAt: 0, items: [], total: 0, tableId: "t" }
  it("routes an unselected table tab through Mark Cash then Confirm Cash", () => {
    expect(paymentActionForOrder(base)).toBe("mark-table-cash")
    expect(paymentActionForOrder({ ...base, paymentMethod: "cash" })).toBe("confirm-table-cash")
  })
  it("keeps gateway payments staff-read-only and permits pickup cash confirmation", () => {
    expect(paymentActionForOrder({ ...base, paymentMethod: "stripe" })).toBeNull()
    expect(paymentActionForOrder({ ...base, orderType: "pickup", paymentMethod: "cash", tableId: undefined })).toBe("confirm-pickup-cash")
  })
})
