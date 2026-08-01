import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type MenuIcon,
  type MenuItem,
  type MenuItemRow,
  type MenuModifierGroup,
  type ModifierGroupRow,
  MENU_ITEM_SELECT,
  mapMenuItemRow,
} from "./menu-mapping"

export type MenuItemSizeInput = {
  name: string
  priceDelta: number
}

export type MenuItemInput = {
  categoryId: string
  nameVi: string
  nameEn: string
  descriptionVi: string
  descriptionEn: string
  basePrice: number
  icon: MenuIcon
  isAvailable: boolean
  isPopular: boolean
  imageUrl?: string | null
  hasSizeOptions: boolean
}

function toRow(input: MenuItemInput) {
  return {
    category_id: input.categoryId,
    name_vi: input.nameVi,
    name_en: input.nameEn,
    description_vi: input.descriptionVi,
    description_en: input.descriptionEn,
    base_price: input.basePrice,
    icon: input.icon,
    is_available: input.isAvailable,
    is_popular: input.isPopular,
    image_url: input.imageUrl ?? null,
    has_size_options: input.hasSizeOptions,
  }
}

export async function createMenuItem(supabase: SupabaseClient, input: MenuItemInput): Promise<MenuItem> {
  const { data, error } = await supabase
    .from("menu_items")
    .insert(toRow(input))
    .select(MENU_ITEM_SELECT)
    .single()
  if (error) throw error
  return mapMenuItemRow(data as unknown as MenuItemRow)
}

export async function updateMenuItem(
  supabase: SupabaseClient,
  id: string,
  input: MenuItemInput
): Promise<MenuItem> {
  const { data, error } = await supabase
    .from("menu_items")
    .update(toRow(input))
    .eq("id", id)
    .select(MENU_ITEM_SELECT)
    .single()
  if (error) throw error
  return mapMenuItemRow(data as unknown as MenuItemRow)
}

export async function deleteMenuItem(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("menu_items").delete().eq("id", id)
  if (error) throw error
}

export async function getModifierGroups(supabase: SupabaseClient): Promise<MenuModifierGroup[]> {
  const { data, error } = await supabase
    .from("modifier_groups")
    .select("id, name_vi, name_en, is_required, modifiers ( id, name_vi, name_en, price_delta )")
    .order("name_en")
  if (error) throw error
  return ((data ?? []) as unknown as ModifierGroupRow[]).map((row) => ({
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    required: row.is_required,
    options: (row.modifiers ?? []).map((m) => ({
      id: m.id,
      nameVi: m.name_vi,
      nameEn: m.name_en,
      priceDelta: m.price_delta,
    })),
  }))
}

export type ModifierGroupInput = {
  nameVi: string
  nameEn: string
  priceDelta: number
}

export async function createModifierGroup(
  supabase: SupabaseClient,
  input: ModifierGroupInput
): Promise<MenuModifierGroup> {
  const { data: groupRow, error: groupError } = await supabase
    .from("modifier_groups")
    .insert({ name_vi: input.nameVi, name_en: input.nameEn, is_required: false, max_selections: 1 })
    .select("id, name_vi, name_en, is_required")
    .single()
  if (groupError) throw groupError

  const { data: modifierRow, error: modifierError } = await supabase
    .from("modifiers")
    .insert({
      modifier_group_id: groupRow.id,
      name_vi: input.nameVi,
      name_en: input.nameEn,
      price_delta: input.priceDelta,
    })
    .select("id, name_vi, name_en, price_delta")
    .single()
  if (modifierError) throw modifierError

  return {
    id: groupRow.id,
    nameVi: groupRow.name_vi,
    nameEn: groupRow.name_en,
    required: groupRow.is_required,
    options: [
      {
        id: modifierRow.id,
        nameVi: modifierRow.name_vi,
        nameEn: modifierRow.name_en,
        priceDelta: modifierRow.price_delta,
      },
    ],
  }
}

export async function updateModifierGroup(
  supabase: SupabaseClient,
  groupId: string,
  input: ModifierGroupInput
): Promise<MenuModifierGroup> {
  const { error: groupError } = await supabase
    .from("modifier_groups")
    .update({ name_vi: input.nameVi, name_en: input.nameEn })
    .eq("id", groupId)
  if (groupError) throw groupError

  const { data: modifierRow, error: modifierError } = await supabase
    .from("modifiers")
    .update({ name_vi: input.nameVi, name_en: input.nameEn, price_delta: input.priceDelta })
    .eq("modifier_group_id", groupId)
    .select("id, name_vi, name_en, price_delta")
    .single()
  if (modifierError) throw modifierError

  return {
    id: groupId,
    nameVi: input.nameVi,
    nameEn: input.nameEn,
    required: false,
    options: [
      {
        id: modifierRow.id,
        nameVi: modifierRow.name_vi,
        nameEn: modifierRow.name_en,
        priceDelta: modifierRow.price_delta,
      },
    ],
  }
}

export async function setItemModifierGroups(
  supabase: SupabaseClient,
  itemId: string,
  groupIds: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("menu_item_modifier_groups")
    .delete()
    .eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (groupIds.length === 0) return

  const { error: insertError } = await supabase
    .from("menu_item_modifier_groups")
    .insert(groupIds.map((groupId) => ({ menu_item_id: itemId, modifier_group_id: groupId })))
  if (insertError) throw insertError
}

export async function setItemSizes(
  supabase: SupabaseClient,
  itemId: string,
  sizes: MenuItemSizeInput[]
): Promise<void> {
  const { error: deleteError } = await supabase.from("menu_item_sizes").delete().eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (sizes.length === 0) return

  const { error: insertError } = await supabase.from("menu_item_sizes").insert(
    sizes.map((size, index) => ({
      menu_item_id: itemId,
      name: size.name,
      price_delta: size.priceDelta,
      sort_order: index,
    }))
  )
  if (insertError) throw insertError
}
