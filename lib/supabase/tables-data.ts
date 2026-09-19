import type { SupabaseClient } from "@supabase/supabase-js"

export type TableOccupancyStatus = "available" | "occupied" | "cleaning"

export type TableRecord = {
  id: string
  number: string
  // Absent from the general/Realtime table list (lib/supabase/tables-data.ts's
  // TABLE_SELECT_SAFE excludes it) -- only get_table_by_qr_token (guest scan
  // lookup) and get_tables_admin (Admin Tables Management's QR display) ever
  // populate it; anon/authenticated have no direct column-level SELECT on
  // tables.qr_code_token at all as of migration 0046/0047.
  qrToken?: string
  locationVi: string
  locationEn: string
  status: TableOccupancyStatus
  cleaningNotifiedAt: string | null
  scanCount: number
}

export type TableInput = {
  number: string
  locationVi: string
  locationEn: string
}

// Excludes qr_code_token deliberately -- see TableRecord.qrToken's comment.
const TABLE_SELECT_SAFE = "id, table_number, location_vi, location_en, status, cleaning_notified_at, scan_count"

export type TableRow = {
  id: string
  table_number: string
  qr_code_token?: string
  location_vi: string
  location_en: string
  status: TableOccupancyStatus
  cleaning_notified_at: string | null
  scan_count: number
}

export function mapTableRow(row: TableRow): TableRecord {
  return {
    id: row.id,
    number: row.table_number,
    qrToken: row.qr_code_token,
    locationVi: row.location_vi,
    locationEn: row.location_en,
    status: row.status,
    cleaningNotifiedAt: row.cleaning_notified_at,
    scanCount: row.scan_count,
  }
}

export async function getTables(supabase: SupabaseClient): Promise<TableRecord[]> {
  const { data, error } = await supabase.from("tables").select(TABLE_SELECT_SAFE).order("table_number")
  if (error) throw error
  return ((data ?? []) as TableRow[]).map(mapTableRow)
}

// Admin/staff-only: the one legitimate need for tables.qr_code_token beyond
// the guest scan lookup (Admin Tables Management's QR display/print/regenerate
// panel). get_tables_admin() checks the caller's role internally and returns
// the full row (including qr_code_token) regardless of the column-level
// SELECT restriction, since it's SECURITY DEFINER.
export async function getTablesWithQrTokens(supabase: SupabaseClient): Promise<TableRecord[]> {
  const { data, error } = await supabase.rpc("get_tables_admin")
  if (error) throw error
  return ((data ?? []) as TableRow[]).map(mapTableRow)
}

export async function createTable(supabase: SupabaseClient, input: TableInput): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .insert({ table_number: input.number, location_vi: input.locationVi, location_en: input.locationEn })
    .select(TABLE_SELECT_SAFE)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function renameTable(supabase: SupabaseClient, id: string, number: string): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ table_number: number })
    .eq("id", id)
    .select(TABLE_SELECT_SAFE)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function updateTableLocation(
  supabase: SupabaseClient,
  id: string,
  locationVi: string,
  locationEn: string
): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ location_vi: locationVi, location_en: locationEn })
    .eq("id", id)
    .select(TABLE_SELECT_SAFE)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function setTableStatus(
  supabase: SupabaseClient,
  id: string,
  status: TableOccupancyStatus
): Promise<TableRecord> {
  const { data, error } = await supabase
    .from("tables")
    .update({ status })
    .eq("id", id)
    .select(TABLE_SELECT_SAFE)
    .single()
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function notifyTableCleaning(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("notify_table_cleaning", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function regenerateQrToken(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("regenerate_table_qr_token", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function incrementScanCount(supabase: SupabaseClient, id: string): Promise<TableRecord> {
  const { data, error } = await supabase.rpc("increment_table_scan_count", { p_table_id: id })
  if (error) throw error
  return mapTableRow(data as TableRow)
}

export async function getTableByToken(supabase: SupabaseClient, token: string): Promise<TableRecord | null> {
  const { data, error } = await supabase.rpc("get_table_by_qr_token", { p_token: token })
  if (error) throw error
  return data ? mapTableRow(data as TableRow) : null
}

// Staff-facing binary "has an open session" signal (rebuild Decision 12) --
// `table_sessions` carries a partial unique index on (table_id) WHERE status
// = 'active' (migration 0070), so at most one row per table can ever be
// 'active' at once; this just reads which table ids currently have one.
// `table_sessions_select_all` is a public/no-auth SELECT policy (same as the
// customer-facing get_table_session RPC's underlying table), so this plain
// client-side query needs no new RPC.
export async function getActiveSessionTableIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("table_sessions").select("table_id").eq("status", "active")
  if (error) throw error
  return ((data ?? []) as { table_id: string }[]).map((row) => row.table_id)
}
