import type { CartItem } from "@/hooks/useCart"
import type { AddCartItemInput } from "@/lib/supabase/table-session-data"

export type TableCartTransferItem = AddCartItemInput & { cartItemId: string }

type TransferStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

const STORAGE_PREFIX = "phadincafe-table-cart-transfer:"
const PENDING_TRANSFER_KEY = "phadincafe-pending-table-cart-transfer"

export function buildTableCartTransfer(items: CartItem[]): TableCartTransferItem[] {
  return items.map((item) => ({
    cartItemId: item.cartItemId,
    menuItemId: item.menuItemId,
    sizeId: item.size?.id ?? null,
    modifierIds: item.modifiers.map((modifier) => modifier.optionId).sort(),
    note: item.note ?? null,
    quantity: item.quantity,
  }))
}

export function subtractTransferredQuantities<T extends { cartItemId: string; quantity: number }>(
  currentItems: T[],
  transferredItems: TableCartTransferItem[]
): T[] {
  const transferredById = new Map(transferredItems.map((item) => [item.cartItemId, item.quantity ?? 1]))
  return currentItems.flatMap((item) => {
    const remaining = item.quantity - (transferredById.get(item.cartItemId) ?? 0)
    return remaining > 0 ? [{ ...item, quantity: remaining }] : []
  })
}

export function saveTableCartTransfer(
  storage: TransferStorage,
  transferId: string,
  items: TableCartTransferItem[]
): void {
  storage.setItem(`${STORAGE_PREFIX}${transferId}`, JSON.stringify(items))
}

export function loadTableCartTransfer(
  storage: TransferStorage,
  transferId: string
): TableCartTransferItem[] | null {
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${transferId}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as TableCartTransferItem).cartItemId === "string" &&
          typeof (item as TableCartTransferItem).menuItemId === "string" &&
          Array.isArray((item as TableCartTransferItem).modifierIds) &&
          typeof (item as TableCartTransferItem).quantity === "number"
      )
    ) {
      return null
    }
    return parsed as TableCartTransferItem[]
  } catch {
    return null
  }
}

export function prepareTableCartTransfer(
  storage: TransferStorage,
  proposedTransferId: string,
  tableToken: string,
  items: TableCartTransferItem[]
): string {
  try {
    const pendingRaw = storage.getItem(PENDING_TRANSFER_KEY)
    if (pendingRaw) {
      const pending = JSON.parse(pendingRaw) as { transferId?: unknown; tableToken?: unknown }
      if (typeof pending.transferId === "string" && pending.tableToken === tableToken) {
        const pendingItems = loadTableCartTransfer(storage, pending.transferId)
        if (pendingItems) return pending.transferId
      }
    }
  } catch {
    // A malformed stale pointer is replaced below.
  }

  saveTableCartTransfer(storage, proposedTransferId, items)
  storage.setItem(PENDING_TRANSFER_KEY, JSON.stringify({ transferId: proposedTransferId, tableToken }))
  return proposedTransferId
}

export function clearStoredTableCartTransfer(storage: TransferStorage, transferId: string): void {
  try {
    storage.removeItem(`${STORAGE_PREFIX}${transferId}`)
    const pendingRaw = storage.getItem(PENDING_TRANSFER_KEY)
    if (pendingRaw && (JSON.parse(pendingRaw) as { transferId?: unknown }).transferId === transferId) {
      storage.removeItem(PENDING_TRANSFER_KEY)
    }
  } catch {
    try {
      storage.removeItem(PENDING_TRANSFER_KEY)
    } catch {
      // The RPC is already committed; local cleanup is best-effort only.
    }
  }
}
