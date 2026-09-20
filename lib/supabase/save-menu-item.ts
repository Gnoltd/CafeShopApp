import type { SupabaseClient } from "@supabase/supabase-js"
import { createMenuItem, updateMenuItem, setItemModifierGroups, setItemCategories, setItemSizes, getMenuItemById } from "./menu-data"
import type { MenuItem, MenuItemInput, MenuItemSizeInput } from "./menu-data"

export type SaveMenuItemInput = {
  editingId: string | null
  item: MenuItemInput
  extraGroupIds: string[]
  sizes: MenuItemSizeInput[]
}

export async function saveMenuItem(supabase: SupabaseClient, input: SaveMenuItemInput): Promise<MenuItem> {
  const saved = input.editingId
    ? await updateMenuItem(supabase, input.editingId, input.item)
    : await createMenuItem(supabase, input.item)
  await setItemModifierGroups(supabase, saved.id, input.extraGroupIds)
  await setItemCategories(supabase, saved.id, input.item.categoryIds)
  await setItemSizes(supabase, saved.id, input.sizes)
  return (await getMenuItemById(supabase, saved.id)) ?? saved
}
