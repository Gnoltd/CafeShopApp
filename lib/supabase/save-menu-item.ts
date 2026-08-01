import type { SupabaseClient } from "@supabase/supabase-js"
import { createMenuItem, updateMenuItem, setItemModifierGroups, setItemSizes, getMenuItemById } from "./menu-data"
import type { MenuItem, MenuItemInput, MenuItemSizeInput } from "./menu-data"
import { setMenuItemIngredients, type RecipeEntry } from "./inventory-data"

export type SaveMenuItemInput = {
  editingId: string | null
  item: MenuItemInput
  extraGroupIds: string[]
  recipeEntries: RecipeEntry[]
  sizes: MenuItemSizeInput[]
}

export async function saveMenuItem(supabase: SupabaseClient, input: SaveMenuItemInput): Promise<MenuItem> {
  const saved = input.editingId
    ? await updateMenuItem(supabase, input.editingId, input.item)
    : await createMenuItem(supabase, input.item)
  await setItemModifierGroups(supabase, saved.id, input.extraGroupIds)
  await setMenuItemIngredients(supabase, saved.id, input.recipeEntries)
  await setItemSizes(supabase, saved.id, input.sizes)
  return (await getMenuItemById(supabase, saved.id)) ?? saved
}
