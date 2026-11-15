"use client"

import { useSyncExternalStore } from "react"

export const GUEST_ACTIVE_TABLE_STORAGE_KEY = "phadincafe-active-table"
export const GUEST_ACTIVE_TABLE_EVENT = "phadincafe-active-table-changed"

/** Resolved Table identity remembered in the guest's browser for return navigation. */
export type GuestActiveTable = {
  number: string
  qrToken: string
}

/** Minimal table record fields required when resolving a guest QR scan. */
export type GuestResolvedTable = {
  id: string
  number: string
}

/** Lookup boundary implemented by infrastructure adapters (e.g. Supabase RPCs). */
export type GuestTableLookupPort<TTable extends GuestResolvedTable = GuestResolvedTable> = {
  findByQrToken: (qrToken: string) => Promise<TTable | null>
  recordScan: (tableId: string) => Promise<unknown>
}

export type ResolveGuestTableResult<TTable extends GuestResolvedTable = GuestResolvedTable> = {
  table: TTable
  activeTable: GuestActiveTable
} | null

export type GuestActiveTableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type GuestActiveTableEventTarget = {
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
  dispatchEvent: (event: Event) => boolean
}

export type GuestActiveTableStore = {
  getSnapshot: () => GuestActiveTable | null
  subscribe: (onChange: () => void) => () => void
  save: (table: GuestActiveTable) => void
  clear: (onlyIfQrToken?: string) => void
}

function parseGuestActiveTable(raw: string | null): GuestActiveTable | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.number !== "string" ||
      typeof candidate.qrToken !== "string" ||
      candidate.number.length === 0 ||
      candidate.qrToken.length === 0
    ) {
      return null
    }
    return {
      number: candidate.number,
      qrToken: candidate.qrToken,
    }
  } catch {
    // Ignore malformed JSON or legacy unquoted qrToken strings.
    return null
  }
}

/**
 * Builds an isolated store for the guest's active table. Accepts optional
 * storage and event targets so unit tests run in-process without a DOM while
 * the browser singleton shares `window.localStorage` and custom tab events.
 */
export function createGuestActiveTableStore(
  storage?: GuestActiveTableStorage | null,
  events?: GuestActiveTableEventTarget | null
): GuestActiveTableStore {
  // Cache parsed snapshot by raw string so `useSyncExternalStore` receives a
  // referentially stable value when storage has not changed.
  let cachedRaw: string | null = null
  let cachedTable: GuestActiveTable | null = null
  const localListeners = new Set<() => void>()

  function getStorage(): GuestActiveTableStorage | null {
    if (storage !== undefined) return storage
    if (typeof window === "undefined") return null
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  function getEvents(): GuestActiveTableEventTarget | null {
    if (events !== undefined) return events
    return typeof window !== "undefined" ? window : null
  }

  function readRaw(): string | null {
    try {
      return getStorage()?.getItem(GUEST_ACTIVE_TABLE_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  }

  function emitChange(): void {
    const eventTarget = getEvents()
    if (eventTarget) {
      try {
        eventTarget.dispatchEvent(new Event(GUEST_ACTIVE_TABLE_EVENT))
      } catch {
        // Ignore event dispatch failures in restricted environments.
      }
      return
    }
    if (events === null) return
    for (const listener of localListeners) listener()
  }

  function getSnapshot(): GuestActiveTable | null {
    const raw = readRaw()
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedTable = parseGuestActiveTable(raw)
    }
    return cachedTable
  }

  function subscribe(onChange: () => void): () => void {
    const eventTarget = getEvents()
    if (eventTarget) {
      eventTarget.addEventListener("storage", onChange)
      eventTarget.addEventListener(GUEST_ACTIVE_TABLE_EVENT, onChange)
      return () => {
        eventTarget.removeEventListener("storage", onChange)
        eventTarget.removeEventListener(GUEST_ACTIVE_TABLE_EVENT, onChange)
      }
    }
    if (events === null) return () => {}
    localListeners.add(onChange)
    return () => {
      localListeners.delete(onChange)
    }
  }

  function save(table: GuestActiveTable): void {
    const payload: GuestActiveTable = { number: table.number, qrToken: table.qrToken }
    try {
      getStorage()?.setItem(GUEST_ACTIVE_TABLE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Best-effort — storage may throw in private browsing or when full.
    }
    emitChange()
  }

  function clear(onlyIfQrToken?: string): void {
    if (onlyIfQrToken !== undefined) {
      const current = getSnapshot()
      if ((current?.qrToken ?? readRaw()) !== onlyIfQrToken) return
    }
    try {
      getStorage()?.removeItem(GUEST_ACTIVE_TABLE_STORAGE_KEY)
    } catch {
      // Ignore unavailable storage.
    }
    emitChange()
  }

  return { getSnapshot, subscribe, save, clear }
}

const guestActiveTableStore = createGuestActiveTableStore()
const SERVER_SNAPSHOT: GuestActiveTable | null = null

/** Reads the persisted guest active table if available. */
export function getGuestActiveTable(): GuestActiveTable | null {
  return guestActiveTableStore.getSnapshot()
}

/** Persists the guest's active table and notifies same-tab subscribers. */
export function saveGuestActiveTable(table: GuestActiveTable): void {
  guestActiveTableStore.save(table)
}

/**
 * Clears the remembered guest active table. When `onlyIfQrToken` is provided,
 * only clears if the stored token matches, avoiding wiping a valid table when
 * visiting a separate invalid link.
 */
export function clearGuestActiveTable(onlyIfQrToken?: string): void {
  guestActiveTableStore.clear(onlyIfQrToken)
}

/** Subscribes to the guest's remembered active table across tabs and same-tab writes. */
export function useGuestActiveTable(): GuestActiveTable | null {
  return useSyncExternalStore(
    guestActiveTableStore.subscribe,
    guestActiveTableStore.getSnapshot,
    () => SERVER_SNAPSHOT
  )
}

/**
 * Resolves a scanned table QR token through `port`, records a best-effort scan,
 * and persists `{ number, qrToken }` (or clears a matching stale token when
 * lookup returns `null`). Propagates lookup errors so callers can offer retry.
 */
export async function resolveGuestTable<TTable extends GuestResolvedTable>(
  port: GuestTableLookupPort<TTable>,
  qrToken: string,
  store: GuestActiveTableStore = guestActiveTableStore
): Promise<ResolveGuestTableResult<TTable>> {
  const table = await port.findByQrToken(qrToken)
  if (!table) {
    store.clear(qrToken)
    return null
  }

  try {
    void Promise.resolve(port.recordScan(table.id)).catch(() => {
      // A missed scan-count increment is cosmetic and must not block ordering.
    })
  } catch {
    // Ignore synchronous scan errors too.
  }

  const activeTable: GuestActiveTable = { number: table.number, qrToken }
  store.save(activeTable)
  return { table, activeTable }
}
