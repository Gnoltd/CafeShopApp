import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getTables,
  getTablesWithQrTokens,
  createTable,
  regenerateQrToken,
  incrementScanCount,
  getTableByToken,
  setTableStatus,
  notifyTableCleaning,
  getActiveSessionTableIds,
} from "./tables-data"

describe("getTables", () => {
  it("maps snake_case DB rows to camelCase TableRecord, with no qr_code_token requested", async () => {
    // The general table list deliberately excludes qr_code_token (see
    // TABLE_SELECT_SAFE in tables-data.ts) -- anon/authenticated have no
    // column-level SELECT on it at all as of migration 0046/0047.
    const row = {
      id: "tbl-1",
      table_number: "1",
      location_vi: "Khu vực cửa sổ",
      location_en: "Window Area",
      status: "available",
      cleaning_notified_at: null,
      scan_count: 3,
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getTables(supabase)

    expect(result).toEqual([
      {
        id: "tbl-1",
        number: "1",
        qrToken: undefined,
        locationVi: "Khu vực cửa sổ",
        locationEn: "Window Area",
        status: "available",
        cleaningNotifiedAt: null,
        scanCount: 3,
      },
    ])
  })
})

describe("getTablesWithQrTokens", () => {
  it("calls the get_tables_admin RPC and maps rows including qr_code_token", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc123",
      location_vi: "",
      location_en: "",
      status: "available",
      cleaning_notified_at: null,
      scan_count: 3,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: [row], error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getTablesWithQrTokens(supabase)

    expect(rpcSpy).toHaveBeenCalledWith("get_tables_admin")
    expect(result[0].qrToken).toBe("abc123")
  })
})

describe("createTable", () => {
  it("inserts snake_case columns and returns the mapped row", async () => {
    const insertedRow = {
      id: "tbl-new",
      table_number: "7",
      location_vi: "Sân vườn",
      location_en: "Garden",
      status: "available",
      cleaning_notified_at: null,
      scan_count: 0,
    }
    const insertSpy = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    const result = await createTable(supabase, { number: "7", locationVi: "Sân vườn", locationEn: "Garden" })

    expect(insertSpy).toHaveBeenCalledWith({
      table_number: "7",
      location_vi: "Sân vườn",
      location_en: "Garden",
    })
    expect(result.number).toBe("7")
  })

  it("propagates a unique-constraint error instead of swallowing it", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint" } }),
      }),
    }))
    const supabase = { from: () => ({ insert: insertSpy }) } as unknown as SupabaseClient

    await expect(createTable(supabase, { number: "1", locationVi: "", locationEn: "" })).rejects.toBeTruthy()
  })
})

describe("regenerateQrToken", () => {
  it("calls the regenerate_table_qr_token RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "newtoken",
      location_vi: "",
      location_en: "",
      status: "available",
      cleaning_notified_at: null,
      scan_count: 0,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await regenerateQrToken(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("regenerate_table_qr_token", { p_table_id: "tbl-1" })
    expect(result.qrToken).toBe("newtoken")
  })
})

describe("incrementScanCount", () => {
  it("calls the increment_table_scan_count RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      status: "available",
      cleaning_notified_at: null,
      scan_count: 4,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await incrementScanCount(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("increment_table_scan_count", { p_table_id: "tbl-1" })
    expect(result.scanCount).toBe(4)
  })
})

describe("getTableByToken", () => {
  it("calls the get_table_by_qr_token RPC with the token", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getTableByToken(supabase, "nonexistent-token")

    expect(rpcSpy).toHaveBeenCalledWith("get_table_by_qr_token", { p_token: "nonexistent-token" })
    expect(result).toBeNull()
  })
})

describe("setTableStatus", () => {
  it("updates status and returns the mapped row", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      status: "cleaning",
      cleaning_notified_at: null,
      scan_count: 0,
    }
    const eqSpy = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    const result = await setTableStatus(supabase, "tbl-1", "cleaning")

    expect(updateSpy).toHaveBeenCalledWith({ status: "cleaning" })
    expect(result.status).toBe("cleaning")
  })
})

describe("getActiveSessionTableIds", () => {
  it("queries table_sessions filtered to status = active and returns just the table ids", async () => {
    const eqSpy = vi.fn(() =>
      Promise.resolve({ data: [{ table_id: "tbl-1" }, { table_id: "tbl-2" }], error: null })
    )
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getActiveSessionTableIds(supabase)

    expect(selectSpy).toHaveBeenCalledWith("table_id")
    expect(eqSpy).toHaveBeenCalledWith("status", "active")
    expect(result).toEqual(["tbl-1", "tbl-2"])
  })
})

describe("notifyTableCleaning", () => {
  it("calls the notify_table_cleaning RPC with the right argument name", async () => {
    const row = {
      id: "tbl-1",
      table_number: "1",
      qr_code_token: "abc",
      location_vi: "",
      location_en: "",
      status: "cleaning",
      cleaning_notified_at: "2026-07-08T10:00:00Z",
      scan_count: 0,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await notifyTableCleaning(supabase, "tbl-1")

    expect(rpcSpy).toHaveBeenCalledWith("notify_table_cleaning", { p_table_id: "tbl-1" })
    expect(result.cleaningNotifiedAt).toBe("2026-07-08T10:00:00Z")
  })
})
