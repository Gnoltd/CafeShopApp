import type { SupabaseClient } from "@supabase/supabase-js"

export type IngredientIcon = "coffee" | "droplet" | "wheat" | "candy"

export type Ingredient = {
  id: string
  nameVi: string
  nameEn: string
  subtitleVi: string
  subtitleEn: string
  unit: string
  stock: number
  threshold: number
  icon: IngredientIcon
}

export type IngredientInput = {
  nameVi: string
  nameEn: string
  subtitleVi: string
  subtitleEn: string
  unit: string
  threshold: number
  icon: IngredientIcon
}

export type InventoryLogReason = "restock" | "adjustment" | "waste" | "order_deduction"

export type InventoryLog = {
  id: string
  ingredientId: string
  ingredientNameVi: string
  ingredientNameEn: string
  change: number
  reason: InventoryLogReason
  timestamp: number
}

export type RecipeEntry = { ingredientId: string; quantityUsed: number }

const INGREDIENT_SELECT = "id, name_vi, name_en, subtitle_vi, subtitle_en, unit, stock_quantity, low_stock_threshold, icon"

export type IngredientRow = {
  id: string
  name_vi: string
  name_en: string
  subtitle_vi: string
  subtitle_en: string
  unit: string
  stock_quantity: number
  low_stock_threshold: number
  icon: IngredientIcon
}

export function mapIngredientRow(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    subtitleVi: row.subtitle_vi,
    subtitleEn: row.subtitle_en,
    unit: row.unit,
    stock: row.stock_quantity,
    threshold: row.low_stock_threshold,
    icon: row.icon,
  }
}

export async function getIngredients(supabase: SupabaseClient): Promise<Ingredient[]> {
  const { data, error } = await supabase.from("ingredients").select(INGREDIENT_SELECT).order("name_en")
  if (error) throw error
  return ((data ?? []) as IngredientRow[]).map(mapIngredientRow)
}

function toIngredientRow(input: IngredientInput) {
  return {
    name_vi: input.nameVi,
    name_en: input.nameEn,
    subtitle_vi: input.subtitleVi,
    subtitle_en: input.subtitleEn,
    unit: input.unit,
    low_stock_threshold: input.threshold,
    icon: input.icon,
  }
}

export async function createIngredient(supabase: SupabaseClient, input: IngredientInput): Promise<Ingredient> {
  const { data, error } = await supabase
    .from("ingredients")
    .insert(toIngredientRow(input))
    .select(INGREDIENT_SELECT)
    .single()
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

export async function updateIngredient(
  supabase: SupabaseClient,
  id: string,
  input: IngredientInput
): Promise<Ingredient> {
  const { data, error } = await supabase
    .from("ingredients")
    .update(toIngredientRow(input))
    .eq("id", id)
    .select(INGREDIENT_SELECT)
    .single()
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

export async function adjustStock(
  supabase: SupabaseClient,
  id: string,
  change: number,
  reason: InventoryLogReason
): Promise<Ingredient> {
  const { data, error } = await supabase.rpc("adjust_ingredient_stock", {
    p_ingredient_id: id,
    p_change: change,
    p_reason: reason,
  })
  if (error) throw error
  return mapIngredientRow(data as IngredientRow)
}

type InventoryLogRow = {
  id: string
  ingredient_id: string
  change_quantity: number
  reason: InventoryLogReason
  created_at: string
}

export function mapInventoryLogRow(
  row: InventoryLogRow,
  ingredientNameVi: string,
  ingredientNameEn: string
): InventoryLog {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    ingredientNameVi,
    ingredientNameEn,
    change: row.change_quantity,
    reason: row.reason,
    timestamp: new Date(row.created_at).getTime(),
  }
}

type InventoryLogJoinRow = InventoryLogRow & {
  ingredients: { name_vi: string; name_en: string } | null
}

export const INVENTORY_LOGS_PAGE_SIZE = 50

export type InventoryLogsPage = {
  logs: InventoryLog[]
  // Opaque `created_at|id` keyset cursor for the next page, or null once
  // the last page has been reached. Never a plain OFFSET -- an OFFSET
  // page shifts under concurrent inserts, a keyset cursor doesn't.
  nextCursor: string | null
}

const LOGS_SELECT = "id, ingredient_id, change_quantity, reason, created_at, ingredients ( name_vi, name_en )"

// Cursor-paginated replacement for the old `.limit(200)` fetch-everything
// query (silently truncated any shop with more than 200 lifetime log rows,
// and was fetched eagerly on every InventoryProvider mount even when the
// Logs tab was never opened). Ordered `created_at desc, id desc` so a
// cursor stays well-defined even if two rows share a timestamp.
export async function getInventoryLogsPage(
  supabase: SupabaseClient,
  cursor: string | null = null
): Promise<InventoryLogsPage> {
  let query = supabase
    .from("inventory_logs")
    .select(LOGS_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(INVENTORY_LOGS_PAGE_SIZE + 1)

  if (cursor) {
    const separatorIndex = cursor.indexOf("|")
    const cursorCreatedAt = separatorIndex === -1 ? cursor : cursor.slice(0, separatorIndex)
    const cursorId = separatorIndex === -1 ? "" : cursor.slice(separatorIndex + 1)
    query = query.or(`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`)
  }

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as unknown as InventoryLogJoinRow[]
  const hasMore = rows.length > INVENTORY_LOGS_PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, INVENTORY_LOGS_PAGE_SIZE) : rows
  const logs = pageRows.map((row) => mapInventoryLogRow(row, row.ingredients?.name_vi ?? "", row.ingredients?.name_en ?? ""))
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow ? `${lastRow.created_at}|${lastRow.id}` : null
  return { logs, nextCursor }
}

// Cheap single-row fetch backing the Inventory page's "Last Updated" stat
// card, which needs to show *something* before the Logs tab (and its full
// paginated fetch) has ever been opened.
export async function getLatestInventoryLogTimestamp(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("inventory_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? new Date((data as { created_at: string }).created_at).getTime() : null
}

type RecipeRow = { ingredient_id: string; quantity_used: number }

export async function getMenuItemIngredients(supabase: SupabaseClient, menuItemId: string): Promise<RecipeEntry[]> {
  const { data, error } = await supabase
    .from("menu_item_ingredients")
    .select("ingredient_id, quantity_used")
    .eq("menu_item_id", menuItemId)
  if (error) throw error
  return ((data ?? []) as RecipeRow[]).map((row) => ({ ingredientId: row.ingredient_id, quantityUsed: row.quantity_used }))
}

export async function setMenuItemIngredients(
  supabase: SupabaseClient,
  menuItemId: string,
  entries: RecipeEntry[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("menu_item_ingredients").delete().eq("menu_item_id", menuItemId)
  if (deleteError) throw deleteError
  if (entries.length === 0) return
  const { error: insertError } = await supabase
    .from("menu_item_ingredients")
    .insert(entries.map((e) => ({ menu_item_id: menuItemId, ingredient_id: e.ingredientId, quantity_used: e.quantityUsed })))
  if (insertError) throw insertError
}

export async function getModifierIngredients(supabase: SupabaseClient, modifierId: string): Promise<RecipeEntry[]> {
  const { data, error } = await supabase
    .from("modifier_ingredients")
    .select("ingredient_id, quantity_used")
    .eq("modifier_id", modifierId)
  if (error) throw error
  return ((data ?? []) as RecipeRow[]).map((row) => ({ ingredientId: row.ingredient_id, quantityUsed: row.quantity_used }))
}

export async function setModifierIngredients(
  supabase: SupabaseClient,
  modifierId: string,
  entries: RecipeEntry[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("modifier_ingredients").delete().eq("modifier_id", modifierId)
  if (deleteError) throw deleteError
  if (entries.length === 0) return
  const { error: insertError } = await supabase
    .from("modifier_ingredients")
    .insert(entries.map((e) => ({ modifier_id: modifierId, ingredient_id: e.ingredientId, quantity_used: e.quantityUsed })))
  if (insertError) throw insertError
}
