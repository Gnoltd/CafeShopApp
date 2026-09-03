"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  createTable as createTableQuery,
  getTableByToken,
  getTables,
  getTablesWithQrTokens,
  incrementScanCount,
  mapTableRow,
  notifyTableCleaning,
  regenerateQrToken as regenerateQrTokenQuery,
  renameTable as renameTableQuery,
  setTableStatus,
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
  setStatus: (id: string, status: TableOccupancyStatus) => Promise<void>
  notifyCleaning: (id: string) => Promise<void>
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

export function TablesProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [tables, setTables] = useState<TableRecord[]>([])
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

  async function setStatus(id: string, status: TableOccupancyStatus) {
    await setTableStatus(supabase, id, status)
  }

  async function notifyCleaning(id: string) {
    await notifyTableCleaning(supabase, id)
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
        setStatus,
        notifyCleaning,
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
