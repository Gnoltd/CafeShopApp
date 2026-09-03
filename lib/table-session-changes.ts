import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

/**
 * What a table-session client already knows about its own table, used to
 * decide whether an incoming Realtime change event is worth refetching for.
 */
export type KnownTableSession = {
  /** The active session's id, or null when this table has no session yet. */
  sessionId: string | null
  /** Ids of the cart rows currently on this table's draft cart. */
  cartItemIds: ReadonlySet<string>
  /** Ids of the orders (rounds) already placed under this session. */
  roundIds: ReadonlySet<string>
}

export const EMPTY_KNOWN_TABLE_SESSION: KnownTableSession = {
  sessionId: null,
  cartItemIds: new Set(),
  roundIds: new Set(),
}

type Row = Record<string, unknown>

function asRow(value: unknown): Row | null {
  if (value === null || typeof value !== "object") return null
  const row = value as Row
  return Object.keys(row).length === 0 ? null : row
}

function stringField(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === "string" ? value : null
}

/**
 * True when the row could belong to this table's session. Anything we can't
 * decide from the payload alone falls back to `true` -- being wrong in that
 * direction only costs the extra refetch we already did before this filter
 * existed, whereas being wrong the other way would silently desync a live
 * shared cart.
 */
function rowBelongsToSession(table: string, row: Row, known: KnownTableSession): boolean {
  if (table === "table_sessions") {
    const id = stringField(row, "id")
    return id === null || id === known.sessionId
  }

  if (table === "table_cart_items") {
    // INSERT/UPDATE carry the whole row. A DELETE only carries the replica
    // identity (the primary key), so fall back to "is this one of the cart
    // rows we are currently showing?"
    if ("table_session_id" in row) return stringField(row, "table_session_id") === known.sessionId
    const id = stringField(row, "id")
    return id === null || known.cartItemIds.has(id)
  }

  if (table === "orders") {
    if ("table_session_id" in row) {
      const sessionId = stringField(row, "table_session_id")
      if (sessionId !== null) return sessionId === known.sessionId
      // Explicitly not attached to any table session (a pickup or a
      // pre-session dine-in order) -- only relevant if it is somehow already
      // one of our rounds.
      const id = stringField(row, "id")
      return id !== null && known.roundIds.has(id)
    }
    const id = stringField(row, "id")
    return id === null || known.roundIds.has(id)
  }

  return true
}

/**
 * Client-side relevance filter for the table-session Realtime streams.
 *
 * The subscriptions themselves stay unfiltered on purpose -- this project's
 * convention is "subscribe unfiltered and refetch", because a server-side
 * `filter` doesn't reliably combine with RLS-gated Realtime. That means one
 * guest's phone receives every cart/session/order change in the whole cafe.
 * This narrows the events that actually cause a refetch down to the ones
 * that can change what this device is looking at.
 */
export function isRelevantTableSessionChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  known: KnownTableSession
): boolean {
  const table = typeof payload.table === "string" ? payload.table : null
  if (table === null) return true

  // No session yet (freshly scanned QR, or the previous session just
  // closed). We have no id to compare against, so the only thing we can
  // narrow on is the event shape: our session can only come into existence
  // through an INSERT on table_sessions/table_cart_items. An UPDATE or
  // DELETE always concerns a row whose INSERT we would already have seen
  // (and refetched for), and no `orders` row can be ours while we have no
  // session at all.
  if (known.sessionId === null) {
    return payload.eventType === "INSERT" && (table === "table_sessions" || table === "table_cart_items")
  }

  const rows = [asRow(payload.new), asRow(payload.old)].filter((row): row is Row => row !== null)
  if (rows.length === 0) return true

  return rows.some((row) => rowBelongsToSession(table, row, known))
}
