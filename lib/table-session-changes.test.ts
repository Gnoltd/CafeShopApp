import { describe, it, expect } from "vitest"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { isRelevantTableSessionChange, type KnownTableSession } from "./table-session-changes"

type Row = Record<string, unknown>

function payload(
  table: string,
  eventType: "INSERT" | "UPDATE" | "DELETE",
  rows: { new?: Row; old?: Row }
): RealtimePostgresChangesPayload<Row> {
  return {
    schema: "public",
    table,
    commit_timestamp: "2026-09-02T00:00:00Z",
    eventType,
    new: rows.new ?? {},
    old: rows.old ?? {},
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Row>
}

const known: KnownTableSession = {
  sessionId: "session-mine",
  cartItemIds: new Set(["cart-mine"]),
  roundIds: new Set(["order-mine"]),
}

const noSession: KnownTableSession = {
  sessionId: null,
  cartItemIds: new Set(),
  roundIds: new Set(),
}

describe("isRelevantTableSessionChange", () => {
  describe("table_cart_items", () => {
    it("accepts an insert into our own session", () => {
      const event = payload("table_cart_items", "INSERT", {
        new: { id: "cart-new", table_session_id: "session-mine" },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(true)
    })

    it("ignores another table's cart insert", () => {
      const event = payload("table_cart_items", "INSERT", {
        new: { id: "cart-other", table_session_id: "session-other" },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })

    it("ignores another table's cart update", () => {
      const event = payload("table_cart_items", "UPDATE", {
        new: { id: "cart-other", table_session_id: "session-other" },
        old: { id: "cart-other", table_session_id: "session-other" },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })

    it("accepts a delete of a cart row we are currently showing (replica identity is the PK only)", () => {
      const event = payload("table_cart_items", "DELETE", { old: { id: "cart-mine" } })
      expect(isRelevantTableSessionChange(event, known)).toBe(true)
    })

    it("ignores a delete of a cart row we have never seen", () => {
      const event = payload("table_cart_items", "DELETE", { old: { id: "cart-other" } })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })
  })

  describe("table_sessions", () => {
    it("accepts a change to our own session row", () => {
      const event = payload("table_sessions", "UPDATE", {
        new: { id: "session-mine", payment_pending: true },
        old: { id: "session-mine", payment_pending: false },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(true)
    })

    it("ignores another table's session row", () => {
      const event = payload("table_sessions", "UPDATE", {
        new: { id: "session-other", payment_pending: true },
        old: { id: "session-other", payment_pending: false },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })
  })

  describe("orders", () => {
    it("accepts an order attached to our session", () => {
      const event = payload("orders", "UPDATE", {
        new: { id: "order-new", table_session_id: "session-mine", status: "ready" },
        old: { id: "order-new", table_session_id: "session-mine", status: "preparing" },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(true)
    })

    it("ignores an order attached to another session", () => {
      const event = payload("orders", "UPDATE", {
        new: { id: "order-other", table_session_id: "session-other" },
        old: { id: "order-other", table_session_id: "session-other" },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })

    it("ignores a pickup order with no table session", () => {
      const event = payload("orders", "INSERT", {
        new: { id: "order-pickup", table_session_id: null },
      })
      expect(isRelevantTableSessionChange(event, known)).toBe(false)
    })

    it("accepts a delete-shaped payload for one of our own rounds", () => {
      const event = payload("orders", "DELETE", { old: { id: "order-mine" } })
      expect(isRelevantTableSessionChange(event, known)).toBe(true)
    })
  })

  describe("before this table has a session", () => {
    it("accepts an insert that could be another device creating our session", () => {
      expect(
        isRelevantTableSessionChange(
          payload("table_sessions", "INSERT", { new: { id: "session-unknown" } }),
          noSession
        )
      ).toBe(true)
      expect(
        isRelevantTableSessionChange(
          payload("table_cart_items", "INSERT", { new: { id: "cart-unknown", table_session_id: "session-unknown" } }),
          noSession
        )
      ).toBe(true)
    })

    it("ignores updates/deletes and every orders event while we have no session", () => {
      expect(
        isRelevantTableSessionChange(
          payload("table_cart_items", "UPDATE", { new: { id: "x", table_session_id: "session-other" } }),
          noSession
        )
      ).toBe(false)
      expect(
        isRelevantTableSessionChange(payload("table_sessions", "DELETE", { old: { id: "x" } }), noSession)
      ).toBe(false)
      expect(
        isRelevantTableSessionChange(
          payload("orders", "INSERT", { new: { id: "x", table_session_id: "session-other" } }),
          noSession
        )
      ).toBe(false)
    })
  })

  it("falls back to refetching when the payload carries no usable row", () => {
    expect(isRelevantTableSessionChange(payload("orders", "UPDATE", {}), known)).toBe(true)
  })

  it("falls back to refetching for an unrecognised table", () => {
    expect(
      isRelevantTableSessionChange(payload("something_else", "INSERT", { new: { id: "z" } }), known)
    ).toBe(true)
  })
})
