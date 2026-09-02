import { describe, expect, it } from "vitest"
import {
  buildTableCartTransfer,
  clearStoredTableCartTransfer,
  loadTableCartTransfer,
  prepareTableCartTransfer,
  saveTableCartTransfer,
  subtractTransferredQuantities,
} from "./table-cart-transfer"

describe("buildTableCartTransfer", () => {
  it("preserves each local cart line's configuration and quantity", () => {
    expect(
      buildTableCartTransfer([
        {
          cartItemId: "local-1",
          menuItemId: "mi-1",
          nameVi: "Cà phê",
          nameEn: "Coffee",
          size: { id: "size-large", label: "Large", priceDelta: 10_000 },
          modifiers: [
            { groupId: "g-1", optionId: "mod-milk", labelVi: "Sữa", labelEn: "Milk", priceDelta: 5_000 },
          ],
          note: "Ít đá",
          unitPrice: 45_000,
          quantity: 3,
        },
      ])
    ).toEqual([
      {
        cartItemId: "local-1",
        menuItemId: "mi-1",
        sizeId: "size-large",
        modifierIds: ["mod-milk"],
        note: "Ít đá",
        quantity: 3,
      },
    ])
  })

  it("removes only the quantities captured in the transfer snapshot", () => {
    const current = [
      {
        cartItemId: "line-1",
        menuItemId: "mi-1",
        nameVi: "Cà phê",
        nameEn: "Coffee",
        modifiers: [],
        unitPrice: 30_000,
        quantity: 5,
      },
      {
        cartItemId: "line-2",
        menuItemId: "mi-2",
        nameVi: "Trà",
        nameEn: "Tea",
        modifiers: [],
        unitPrice: 25_000,
        quantity: 1,
      },
    ]

    expect(
      subtractTransferredQuantities(current, [
        { cartItemId: "line-1", menuItemId: "mi-1", modifierIds: [], quantity: 3 },
        { cartItemId: "line-2", menuItemId: "mi-2", modifierIds: [], quantity: 1 },
      ])
    ).toEqual([{ ...current[0], quantity: 2 }])
  })

  it("stores the immutable snapshot by transfer id until success", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    const snapshot = [{ cartItemId: "line-1", menuItemId: "mi-1", modifierIds: [], quantity: 2 }]

    saveTableCartTransfer(storage, "transfer-1", snapshot)
    expect(loadTableCartTransfer(storage, "transfer-1")).toEqual(snapshot)

    clearStoredTableCartTransfer(storage, "transfer-1")
    expect(loadTableCartTransfer(storage, "transfer-1")).toBeNull()
  })

  it("reuses a pending transfer id for the same table and snapshot", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    const snapshot = [{ cartItemId: "line-1", menuItemId: "mi-1", modifierIds: [], quantity: 2 }]

    expect(prepareTableCartTransfer(storage, "new-transfer-1", "table-token", snapshot)).toBe("new-transfer-1")
    expect(prepareTableCartTransfer(storage, "new-transfer-2", "table-token", snapshot)).toBe("new-transfer-1")
    expect(
      prepareTableCartTransfer(storage, "new-transfer-3", "table-token", [
        ...snapshot,
        { cartItemId: "line-2", menuItemId: "mi-2", modifierIds: [], quantity: 1 },
      ])
    ).toBe("new-transfer-1")
    expect(loadTableCartTransfer(storage, "new-transfer-1")).toEqual(snapshot)
  })
})
