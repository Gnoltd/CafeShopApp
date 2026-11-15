import { describe, it, expect, vi } from "vitest"
import {
  GUEST_ACTIVE_TABLE_EVENT,
  GUEST_ACTIVE_TABLE_STORAGE_KEY,
  createGuestActiveTableStore,
  resolveGuestTable,
  type GuestActiveTableStorage,
  type GuestTableLookupPort,
} from "./guest-active-table"

function createMemoryStorage(initial: Record<string, string> = {}): GuestActiveTableStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

describe("createGuestActiveTableStore", () => {
  it("persists JSON { number, qrToken } and keeps getSnapshot referentially stable", () => {
    const storage = createMemoryStorage()
    const events = new EventTarget()
    const store = createGuestActiveTableStore(storage, events)

    expect(store.getSnapshot()).toBeNull()

    store.save({ number: "5", qrToken: "qr-5" })
    expect(storage.data.get(GUEST_ACTIVE_TABLE_STORAGE_KEY)).toBe('{"number":"5","qrToken":"qr-5"}')

    const first = store.getSnapshot()
    const second = store.getSnapshot()
    expect(first).toEqual({ number: "5", qrToken: "qr-5" })
    expect(second).toBe(first)

    // Re-saving the exact same values preserves snapshot identity.
    store.save({ number: "5", qrToken: "qr-5" })
    expect(store.getSnapshot()).toBe(first)

    // Updating to a different table produces a fresh snapshot object.
    store.save({ number: "6", qrToken: "qr-6" })
    const third = store.getSnapshot()
    expect(third).toEqual({ number: "6", qrToken: "qr-6" })
    expect(third).not.toBe(first)
  })

  it("extracts { number, qrToken } from legacy TableRecord JSON payloads", () => {
    const storage = createMemoryStorage({
      [GUEST_ACTIVE_TABLE_STORAGE_KEY]: JSON.stringify({
        id: "tbl-1",
        number: "1",
        qrToken: "qr-1",
        locationVi: "Sân",
        status: "available",
      }),
    })
    const store = createGuestActiveTableStore(storage, new EventTarget())

    expect(store.getSnapshot()).toEqual({ number: "1", qrToken: "qr-1" })
  })

  it("safely returns null for legacy unquoted strings and malformed JSON", () => {
    const cases = [
      "legacy-unquoted-qr-token",
      "{not-valid-json",
      '"just-a-json-string"',
      "123",
      "null",
      "[]",
      "{}",
      '{"number":"1"}',
      '{"qrToken":"qr-1"}',
      '{"number":1,"qrToken":"qr-1"}',
      '{"number":"","qrToken":"qr-1"}',
      '{"number":"1","qrToken":""}',
    ]

    for (const raw of cases) {
      const storage = createMemoryStorage({ [GUEST_ACTIVE_TABLE_STORAGE_KEY]: raw })
      const store = createGuestActiveTableStore(storage, new EventTarget())
      expect(store.getSnapshot()).toBeNull()
    }
  })

  it("wraps storage access failures without throwing", () => {
    const throwingStorage: GuestActiveTableStorage = {
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
      removeItem: () => {
        throw new Error("SecurityError")
      },
    }
    const store = createGuestActiveTableStore(throwingStorage, new EventTarget())

    expect(store.getSnapshot()).toBeNull()
    expect(() => store.save({ number: "1", qrToken: "qr-1" })).not.toThrow()
    expect(() => store.clear()).not.toThrow()
    expect(() => store.clear("qr-1")).not.toThrow()
  })

  it("handles null storage and null event target safely (SSR / disabled storage)", () => {
    const store = createGuestActiveTableStore(null, null)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    expect(store.getSnapshot()).toBeNull()
    expect(() => store.save({ number: "1", qrToken: "qr-1" })).not.toThrow()
    expect(() => store.clear()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("notifies subscribers on custom same-tab event and cross-tab storage event", () => {
    const storage = createMemoryStorage()
    const events = new EventTarget()
    const store = createGuestActiveTableStore(storage, events)
    const listener = vi.fn()
    const customSpy = vi.fn()
    events.addEventListener(GUEST_ACTIVE_TABLE_EVENT, customSpy)

    const unsubscribe = store.subscribe(listener)
    store.save({ number: "2", qrToken: "qr-2" })
    expect(customSpy).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)

    storage.setItem(GUEST_ACTIVE_TABLE_STORAGE_KEY, JSON.stringify({ number: "3", qrToken: "qr-3" }))
    events.dispatchEvent(new Event("storage"))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual({ number: "3", qrToken: "qr-3" })

    unsubscribe()
    store.clear()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("notifies in-process subscribers when no EventTarget is provided in Node", () => {
    const storage = createMemoryStorage()
    const store = createGuestActiveTableStore(storage)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.save({ number: "4", qrToken: "qr-4" })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ number: "4", qrToken: "qr-4" })

    unsubscribe()
    store.clear()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("clears unconditionally or conditionally based on onlyIfQrToken", () => {
    const storage = createMemoryStorage()
    const events = new EventTarget()
    const store = createGuestActiveTableStore(storage, events)
    const listener = vi.fn()
    store.subscribe(listener)

    store.save({ number: "5", qrToken: "qr-5" })
    listener.mockClear()

    // Non-matching token does not remove or notify.
    store.clear("qr-other")
    expect(store.getSnapshot()).toEqual({ number: "5", qrToken: "qr-5" })
    expect(listener).not.toHaveBeenCalled()

    // Matching token clears and notifies.
    store.clear("qr-5")
    expect(store.getSnapshot()).toBeNull()
    expect(storage.data.has(GUEST_ACTIVE_TABLE_STORAGE_KEY)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    // Unconditional clear removes any stored value.
    store.save({ number: "8", qrToken: "qr-8" })
    store.clear()
    expect(store.getSnapshot()).toBeNull()
  })
})

describe("resolveGuestTable", () => {
  it("looks up the table, fires best-effort recordScan, and persists GuestActiveTable", async () => {
    const store = createGuestActiveTableStore(createMemoryStorage())
    const resolvedTable = { id: "tbl-5", number: "5", locationEn: "Window" }
    const port: GuestTableLookupPort<typeof resolvedTable> = {
      findByQrToken: vi.fn().mockResolvedValue(resolvedTable),
      recordScan: vi.fn().mockResolvedValue(resolvedTable),
    }

    const result = await resolveGuestTable(port, "qr-5", store)

    expect(port.findByQrToken).toHaveBeenCalledWith("qr-5")
    expect(port.recordScan).toHaveBeenCalledWith("tbl-5")
    expect(result).toEqual({
      table: resolvedTable,
      activeTable: { number: "5", qrToken: "qr-5" },
    })
    expect(store.getSnapshot()).toEqual({ number: "5", qrToken: "qr-5" })
  })

  it("ignores asynchronous and synchronous recordScan failures", async () => {
    const store = createGuestActiveTableStore(createMemoryStorage())
    const table = { id: "tbl-2", number: "2" }

    const asyncFailPort: GuestTableLookupPort<typeof table> = {
      findByQrToken: vi.fn().mockResolvedValue(table),
      recordScan: vi.fn().mockRejectedValue(new Error("scan rpc failed")),
    }
    await expect(resolveGuestTable(asyncFailPort, "qr-2", store)).resolves.toEqual({
      table,
      activeTable: { number: "2", qrToken: "qr-2" },
    })
    expect(store.getSnapshot()).toEqual({ number: "2", qrToken: "qr-2" })

    const syncThrowPort: GuestTableLookupPort<typeof table> = {
      findByQrToken: vi.fn().mockResolvedValue(table),
      recordScan: vi.fn(() => {
        throw new Error("sync failure")
      }),
    }
    await expect(resolveGuestTable(syncThrowPort, "qr-2b", store)).resolves.toEqual({
      table,
      activeTable: { number: "2", qrToken: "qr-2b" },
    })
    expect(store.getSnapshot()).toEqual({ number: "2", qrToken: "qr-2b" })
  })

  it("clears stored active table only when null lookup matches the stored qrToken", async () => {
    const store = createGuestActiveTableStore(createMemoryStorage())
    store.save({ number: "1", qrToken: "qr-valid" })

    const port: GuestTableLookupPort = {
      findByQrToken: vi.fn().mockResolvedValue(null),
      recordScan: vi.fn(),
    }

    // Invalid scan for a different token keeps the remembered valid table.
    await expect(resolveGuestTable(port, "qr-invalid", store)).resolves.toBeNull()
    expect(port.recordScan).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ number: "1", qrToken: "qr-valid" })

    // Invalid/regenerated scan for the remembered token clears it.
    await expect(resolveGuestTable(port, "qr-valid", store)).resolves.toBeNull()
    expect(store.getSnapshot()).toBeNull()
  })

  it("propagates lookup errors without clearing an existing active table", async () => {
    const store = createGuestActiveTableStore(createMemoryStorage())
    store.save({ number: "1", qrToken: "qr-1" })

    const port: GuestTableLookupPort = {
      findByQrToken: vi.fn().mockRejectedValue(new Error("network offline")),
      recordScan: vi.fn(),
    }

    await expect(resolveGuestTable(port, "qr-1", store)).rejects.toThrow("network offline")
    expect(port.recordScan).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ number: "1", qrToken: "qr-1" })
  })
})
