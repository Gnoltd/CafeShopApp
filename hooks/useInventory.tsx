"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel"
import {
  adjustStock as adjustStockQuery,
  createIngredient,
  getIngredients,
  getInventoryLogsPage,
  getLatestInventoryLogTimestamp,
  mapIngredientRow,
  mapInventoryLogRow,
  updateIngredient as updateIngredientQuery,
  type Ingredient,
  type IngredientIcon,
  type IngredientInput,
  type IngredientRow,
  type InventoryLog,
  type InventoryLogReason,
} from "@/lib/supabase/inventory-data"

export type { Ingredient, IngredientIcon, IngredientInput, InventoryLog, InventoryLogReason }

type InventoryContextValue = {
  ingredients: Ingredient[]
  isLoading: boolean
  error: string | null
  restock: (id: string) => Promise<void>
  adjustStock: (id: string, change: number, reason: InventoryLogReason) => Promise<void>
  setOutOfStock: (id: string) => Promise<void>
  addIngredient: (input: IngredientInput) => Promise<void>
  updateIngredientDetails: (id: string, input: IngredientInput) => Promise<void>
  // Cheap, always-fetched -- backs the "Last Updated" stat card without
  // requiring the full paginated log list below.
  lastLogTimestamp: number | null
  // The full log list is deferred: nothing is fetched until loadLogs() is
  // called (the Logs tab opening), then cursor-paginated from there.
  logs: InventoryLog[]
  logsHasMore: boolean
  isLogsLoading: boolean
  logsError: string | null
  loadLogs: () => void
  loadMoreLogs: () => Promise<void>
}

const InventoryContext = createContext<InventoryContextValue | null>(null)

type InventoryLogRow = {
  id: string
  ingredient_id: string
  change_quantity: number
  reason: InventoryLogReason
  created_at: string
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ingredientsRef = useRef<Ingredient[]>([])

  const [lastLogTimestamp, setLastLogTimestamp] = useState<number | null>(null)
  const [logs, setLogs] = useState<InventoryLog[]>([])
  const [logsCursor, setLogsCursor] = useState<string | null>(null)
  const [logsHasMore, setLogsHasMore] = useState(true)
  const [isLogsLoading, setIsLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const logsRequestedRef = useRef(false)
  const logsCursorRef = useRef<string | null>(null)

  useEffect(() => {
    ingredientsRef.current = ingredients
  }, [ingredients])

  useEffect(() => {
    logsCursorRef.current = logsCursor
  }, [logsCursor])

  useEffect(() => {
    let cancelled = false

    getIngredients(supabase)
      .then((rows) => {
        if (!cancelled) setIngredients(rows)
      })
      .catch(() => {
        if (!cancelled) setError("load-failed")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [supabase])

  // Cheap eager fetch just for the "Last Updated" stat card -- the full
  // log list below stays deferred until the Logs tab actually opens.
  useEffect(() => {
    let cancelled = false
    getLatestInventoryLogTimestamp(supabase)
      .then((timestamp) => {
        if (!cancelled) setLastLogTimestamp(timestamp)
      })
      .catch(() => {
        // Non-critical stat; leave it at its current value on failure.
      })
    return () => {
      cancelled = true
    }
  }, [supabase])

  const loadLogs = useCallback(() => {
    if (logsRequestedRef.current) return
    logsRequestedRef.current = true
    setIsLogsLoading(true)
    setLogsError(null)
    getInventoryLogsPage(supabase)
      .then(({ logs: page, nextCursor }) => {
        setLogs(page)
        setLogsCursor(nextCursor)
        setLogsHasMore(nextCursor !== null)
      })
      .catch(() => {
        logsRequestedRef.current = false
        setLogsError("load-failed")
      })
      .finally(() => setIsLogsLoading(false))
  }, [supabase])

  const loadMoreLogs = useCallback(async () => {
    const cursor = logsCursorRef.current
    if (!cursor) return
    setIsLogsLoading(true)
    setLogsError(null)
    try {
      const { logs: page, nextCursor } = await getInventoryLogsPage(supabase, cursor)
      setLogs((prev) => [...prev, ...page])
      setLogsCursor(nextCursor)
      setLogsHasMore(nextCursor !== null)
    } catch {
      setLogsError("load-failed")
    } finally {
      setIsLogsLoading(false)
    }
  }, [supabase])

  useRealtimeChannel(supabase, "inventory-changes", [
    {
      table: "ingredients",
      event: "*",
      onChange: (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id
          if (!oldId) return
          setIngredients((prev) => prev.filter((i) => i.id !== oldId))
          return
        }
        const mapped = mapIngredientRow(payload.new as IngredientRow)
        setIngredients((prev) =>
          prev.some((i) => i.id === mapped.id) ? prev.map((i) => (i.id === mapped.id ? mapped : i)) : [...prev, mapped]
        )
      },
    },
    {
      table: "inventory_logs",
      event: "INSERT",
      onChange: (payload) => {
        const row = payload.new as InventoryLogRow
        setLastLogTimestamp(new Date(row.created_at).getTime())
        // Only splice into the paginated list once the Logs tab has
        // actually requested it -- otherwise this would silently start
        // populating a list nobody asked for yet.
        if (!logsRequestedRef.current) return
        const ingredient = ingredientsRef.current.find((i) => i.id === row.ingredient_id)
        setLogs((prev) => [mapInventoryLogRow(row, ingredient?.nameVi ?? "", ingredient?.nameEn ?? ""), ...prev])
      },
    },
  ])

  async function restock(id: string) {
    const ingredient = ingredientsRef.current.find((i) => i.id === id)
    if (!ingredient) return
    await adjustStockQuery(supabase, id, ingredient.threshold, "restock")
  }

  async function adjustStock(id: string, change: number, reason: InventoryLogReason) {
    if (change === 0) return
    await adjustStockQuery(supabase, id, change, reason)
  }

  async function setOutOfStock(id: string) {
    const ingredient = ingredientsRef.current.find((i) => i.id === id)
    if (!ingredient) return
    await adjustStockQuery(supabase, id, -ingredient.stock, "adjustment")
  }

  async function addIngredient(input: IngredientInput) {
    await createIngredient(supabase, input)
  }

  async function updateIngredientDetails(id: string, input: IngredientInput) {
    await updateIngredientQuery(supabase, id, input)
  }

  return (
    <InventoryContext.Provider
      value={{
        ingredients,
        isLoading,
        error,
        restock,
        adjustStock,
        setOutOfStock,
        addIngredient,
        updateIngredientDetails,
        lastLogTimestamp,
        logs,
        logsHasMore,
        isLogsLoading,
        logsError,
        loadLogs,
        loadMoreLogs,
      }}
    >
      {children}
    </InventoryContext.Provider>
  )
}

export function useInventory(): InventoryContextValue {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error("useInventory must be used within an InventoryProvider")
  return ctx
}
