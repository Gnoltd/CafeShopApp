import type { SupabaseClient } from "@supabase/supabase-js"
import { type MenuItem, type MenuItemRow, MENU_ITEM_SELECT, mapMenuItemRow } from "./menu-mapping"

export type MenuCategory = {
  id: string
  nameVi: string
  nameEn: string
  sortOrder: number
}

type CategoryRow = {
  id: string
  name_vi: string
  name_en: string
  sort_order: number
}

export async function getCategories(supabase: SupabaseClient): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name_vi, name_en, sort_order")
    .order("sort_order")
  if (error) throw error
  return ((data ?? []) as CategoryRow[]).map((row) => ({
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    sortOrder: row.sort_order,
  }))
}

export async function getMenuItems(supabase: SupabaseClient): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .order("name_en")
    .order("sort_order", { foreignTable: "menu_item_sizes" })
  if (error) throw error
  return ((data ?? []) as unknown as MenuItemRow[]).map(mapMenuItemRow)
}

export async function getMenuItemById(supabase: SupabaseClient, id: string): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .eq("id", id)
    .order("sort_order", { foreignTable: "menu_item_sizes" })
    .maybeSingle()
  if (error) throw error
  return data ? mapMenuItemRow(data as unknown as MenuItemRow) : null
}
