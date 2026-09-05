import { describe, it, expect } from "vitest"
import { urgencyLevelFor, paymentActionForOrder, regressTargetFor, itemOptionsText } from "./kitchen-board"
import type { KdsOrder } from "@/hooks/useKitchenOrders"

function makeItem(overrides: Partial<KdsOrder["items"][number]> = {}): KdsOrder["items"][number] {
  return {
    id: "item-1", nameVi: "x", nameEn: "x", quantity: 1, note: null, status: "preparing",
    sizeName: null, modifierNames: [],
    ...overrides,
  }
}

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
  it("requires confirmation before a pending pickup cash order enters the kitchen", () => {
    expect(paymentActionForOrder({ ...base, orderType: "pickup", status: "pending_payment", paymentMethod: "cash", tableId: undefined })).toBe("confirm-pickup-cash")
  })
})

describe("regressTargetFor", () => {
  const base = { id: "o", orderType: "dine-in" as const, status: "preparing" as const, paymentStatus: "pending", paymentMethod: null, createdAt: 0, total: 0, tableId: "t" }

  it("returns null when every item is still at its baseline status", () => {
    const order: KdsOrder = { ...base, items: [makeItem({ status: "preparing" }), makeItem({ id: "item-2", status: "preparing" })] }
    expect(regressTargetFor(order)).toBeNull()
  })

  it("picks the last (most recently advanced) item that has moved past preparing", () => {
    const order: KdsOrder = {
      ...base,
      items: [makeItem({ id: "item-1", status: "ready" }), makeItem({ id: "item-2", status: "preparing" }), makeItem({ id: "item-3", status: "served" })],
    }
    expect(regressTargetFor(order)?.id).toBe("item-3")
  })
})

describe("itemOptionsText", () => {
  it("returns an empty string when the item has no size or modifiers", () => {
    expect(itemOptionsText(makeItem(), "en")).toBe("")
  })

  it("joins size and modifier names with the same separator, localized", () => {
    const item = makeItem({
      sizeName: "M",
      modifierNames: [{ nameVi: "Trân châu", nameEn: "Pearls" }, { nameVi: "Thêm shot", nameEn: "Extra shot" }],
    })
    expect(itemOptionsText(item, "en")).toBe("M · Pearls · Extra shot")
    expect(itemOptionsText(item, "vi")).toBe("M · Trân châu · Thêm shot")
  })
})
