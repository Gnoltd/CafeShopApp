"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  createTable as createTableQuery,
  getActiveSessionTableIds,
  getTableByToken,
  getTables,
  getTablesWithQrTokens,
  incrementScanCount,
  mapTableRow,
  regenerateQrToken as regenerateQrTokenQuery,
  renameTable as renameTableQuery,
  updateTableLocation,
  type TableInput,
  type TableOccupancyStatus,
  type TableRecord,
  type TableRow,
} from "@/lib/supabase/tables-data"

export type { TableRecord, TableInput, TableOccupancyStatus }

type TablesContextValue = {
  tables: TableRecord[]
  addTable: (input: TableInput) => Promise<void>
  renameTable: (id: string, number: string) => Promise<void>
  updateLocation: (id: string, locationVi: string, locationEn: string) => Promise<void>
  // Binary "has an open session" signal (rebuild Decision 12) -- the set of
  // table ids that currently have an active `table_sessions` row. Kept
  // alongside `tables`/`status` (still the 3-state DB enum, untouched)
  // rather than folded into TableRecord itself: `table_sessions` is a
  // separate table with its own Realtime stream, and TableRecord is also
  // consumed by admin surfaces that still read the 3-state `status` field.
  openSessionTableIds: Set<string>
  regenerateToken: (id: string) => Promise<TableRecord>
  // Admin/staff-only: fetches every table's qrToken via the role-gated
  // get_tables_admin RPC (see tables-data.ts) -- the general `tables` list
  // above deliberately never carries qr_code_token.
  getQrTokens: () => Promise<Record<string, string>>
  activeTable: TableRecord | null
  setActiveTableByToken: (token: string) => Promise<TableRecord | null>
  clearActiveTable: () => void
}

const TablesContext = createContext<TablesContextValue | null>(null)

const ACTIVE_TABLE_STORAGE_KEY = "phadincafe-active-table"
// Fired whenever TablesProvider writes ACTIVE_TABLE_STORAGE_KEY, so
// useActiveTableOptional (below) can react in the same tab -- the native
// `storage` event only fires for *other* tabs/documents, never the one that
// made the write.
const ACTIVE_TABLE_EVENT = "phadincafe-active-table-changed"

export function TablesProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [tables, setTables] = useState<TableRecord[]>([])
  const [openSessionTableIds, setOpenSessionTableIds] = useState<Set<string>>(new Set())
  const [activeTable, setActiveTable] = useState<TableRecord | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // activeTable persistence is unchanged from before this hook was
  // rewritten — it must survive a VI/EN locale switch, which remounts
  // this whole provider (see the design spec's Section 3).
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const storedActive = window.localStorage.getItem(ACTIVE_TABLE_STORAGE_KEY)
        if (storedActive) setActiveTable(JSON.parse(storedActive))
      } catch {
        // ignore malformed/unavailable storage
      } finally {
        setHydrated(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (activeTable) {
      window.localStorage.setItem(ACTIVE_TABLE_STORAGE_KEY, JSON.stringify(activeTable))
    } else {
      window.localStorage.removeItem(ACTIVE_TABLE_STORAGE_KEY)
    }
    window.dispatchEvent(new Event(ACTIVE_TABLE_EVENT))
  }, [activeTable, hydrated])

  useEffect(() => {
    let cancelled = false

    getTables(supabase).then((rows) => {
      if (!cancelled) setTables(rows)
    })

    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    let cancelled = false

    getActiveSessionTableIds(supabase).then((ids) => {
      if (!cancelled) setOpenSessionTableIds(new Set(ids))
    })

    return () => {
      cancelled = true
    }
  }, [supabase])

  useRealtimeChannel(supabase, "tables-changes", [
    {
      table: "tables",
      event: "*",
      onChange: (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id
          if (!oldId) return
          setTables((prev) => prev.filter((t) => t.id !== oldId))
          return
        }
        const mapped = mapTableRow(payload.new as TableRow)
        setTables((prev) =>
          prev.some((t) => t.id === mapped.id) ? prev.map((t) => (t.id === mapped.id ? mapped : t)) : [...prev, mapped]
        )
      },
    },
    {
      // Unfiltered refetch, matching this project's Realtime convention
      // (a server-side `filter` doesn't reliably combine with RLS-gated
      // Realtime) -- table_sessions opening/closing is low-frequency, so a
      // full re-list on any change is cheap and simplest to reason about.
      table: "table_sessions",
      event: "*",
      onChange: () => {
        getActiveSessionTableIds(supabase)
          .then((ids) => setOpenSessionTableIds(new Set(ids)))
          .catch(() => {
            // A missed refresh just leaves the badge briefly stale until
            // the next change event corrects it -- not worth surfacing.
          })
      },
    },
  ])

  async function addTable(input: TableInput) {
    await createTableQuery(supabase, input)
  }

  async function renameTable(id: string, number: string) {
    await renameTableQuery(supabase, id, number)
    setActiveTable((prev) => (prev?.id === id ? { ...prev, number } : prev))
  }

  async function updateLocation(id: string, locationVi: string, locationEn: string) {
    await updateTableLocation(supabase, id, locationVi, locationEn)
    setActiveTable((prev) => (prev?.id === id ? { ...prev, locationVi, locationEn } : prev))
  }

  async function regenerateToken(id: string): Promise<TableRecord> {
    return regenerateQrTokenQuery(supabase, id)
  }

  async function getQrTokens(): Promise<Record<string, string>> {
    const rows = await getTablesWithQrTokens(supabase)
    return Object.fromEntries(rows.map((row) => [row.id, row.qrToken ?? ""]))
  }

  async function setActiveTableByToken(token: string): Promise<TableRecord | null> {
    const found = await getTableByToken(supabase, token)
    if (found) {
      incrementScanCount(supabase, found.id).catch(() => {
        // A missed scan-count increment is a cosmetic admin-stat miss,
        // not something worth failing table resolution over.
      })
    }
    setActiveTable(found)
    return found
  }

  function clearActiveTable() {
    setActiveTable(null)
  }

  return (
    <TablesContext.Provider
      value={{
        tables,
        addTable,
        renameTable,
        updateLocation,
        openSessionTableIds,
        regenerateToken,
        getQrTokens,
        activeTable,
        setActiveTableByToken,
        clearActiveTable,
      }}
    >
      {children}
    </TablesContext.Provider>
  )
}

export function useTables(): TablesContextValue {
  const ctx = useContext(TablesContext)
  if (!ctx) throw new Error("useTables must be used within a TablesProvider")
  return ctx
}

// useSyncExternalStore requires getSnapshot to return a stable (===) value
// when nothing changed -- localStorage.getItem always returns a fresh
// string, but re-parsing it on every call would return a new object
// reference each time and spin React into an infinite re-render loop
// (confirmed live: "Maximum update depth exceeded"). Cache by raw string so
// JSON.parse only reruns when the persisted value actually changed.
let cachedRaw: string | null = null
let cachedTable: TableRecord | null = null

function readActiveTableFromStorage(): TableRecord | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(ACTIVE_TABLE_STORAGE_KEY)
  } catch {
    raw = null
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cachedTable = raw ? (JSON.parse(raw) as TableRecord) : null
    } catch {
      cachedTable = null
    }
  }
  return cachedTable
}

function subscribeToActiveTableStorage(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(ACTIVE_TABLE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(ACTIVE_TABLE_EVENT, onChange)
  }
}

/** Reads the same table TablesProvider persists to
 * ACTIVE_TABLE_STORAGE_KEY, but works with no TablesProvider ancestor at
 * all -- unlike `useTables()`, this reads localStorage directly rather than
 * React context. Needed because shared chrome like HeaderActionsStack
 * renders in the root layout (`app/[locale]/layout.tsx`), a SIBLING of
 * `{children}`, not a descendant -- so even on a customer route where
 * TablesProvider *is* mounted further down the tree, `useContext` here
 * would still see no provider. Re-renders on TablesProvider's own writes
 * (custom event, same tab) and cross-tab localStorage changes (native
 * `storage` event). */
export function useActiveTableOptional(): TableRecord | null {
  return useSyncExternalStore(subscribeToActiveTableStorage, readActiveTableFromStorage, () => null)
}
