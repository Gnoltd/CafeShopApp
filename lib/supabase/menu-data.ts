import type { SupabaseClient } from "@supabase/supabase-js"

export type MenuIcon = "coffee" | "cup-soda" | "cookie" | "milk"

export type MenuCategory = {
  id: string
  nameVi: string
  nameEn: string
  sortOrder: number
}

export type CategoryInput = {
  nameVi: string
  nameEn: string
  sortOrder: number
}

export type CategoryUpdateInput = {
  nameVi: string
  nameEn: string
}

export type MenuItemSize = {
  id: string
  name: string
  priceDelta: number
  sortOrder: number
}

export type MenuModifierOption = {
  id: string
  nameVi: string
  nameEn: string
  priceDelta: number
}

export type MenuModifierGroup = {
  id: string
  nameVi: string
  nameEn: string
  required: boolean
  options: MenuModifierOption[]
}

export type MenuItem = {
  id: string
  categoryIds: string[]
  nameVi: string
  nameEn: string
  descriptionVi: string
  descriptionEn: string
  basePrice: number
  icon: MenuIcon
  isAvailable: boolean
  isPopular: boolean
  imageUrl: string | null
  hasSizeOptions: boolean
  sizes: MenuItemSize[]
  modifierGroups: MenuModifierGroup[]
}

export type MenuItemSizeInput = {
  name: string
  priceDelta: number
}

export type MenuItemInput = {
  categoryIds: string[]
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

export type ModifierGroupInput = {
  nameVi: string
  nameEn: string
  priceDelta: number
}

export type SaveMenuItemInput = {
  editingId: string | null
  item: MenuItemInput
  extraGroupIds: string[]
  sizes: MenuItemSizeInput[]
  imageFile?: File | null
}

export type CategoryRow = {
  id: string
  name_vi: string
  name_en: string
  sort_order: number
}

export type SizeRow = {
  id: string
  name: string
  price_delta: number
  sort_order: number
}

export type ModifierRow = {
  id: string
  name_vi: string
  name_en: string
  price_delta: number
}

export type ModifierGroupRow = {
  id: string
  name_vi: string
  name_en: string
  is_required: boolean
  modifiers: ModifierRow[] | null
}

export type ModifierGroupLinkRow = {
  modifier_groups: ModifierGroupRow
}

export type MenuItemRow = {
  id: string
  menu_item_categories: { category_id: string }[] | null
  name_vi: string
  name_en: string
  description_vi: string
  description_en: string
  base_price: number
  icon: MenuIcon
  is_available: boolean
  is_popular: boolean
  image_url: string | null
  has_size_options: boolean
  menu_item_sizes: SizeRow[] | null
  menu_item_modifier_groups: ModifierGroupLinkRow[] | null
}

export const MENU_ITEM_SELECT = `
  id, name_vi, name_en, description_vi, description_en,
  base_price, icon, is_available, is_popular, image_url, has_size_options,
  menu_item_categories ( category_id ),
  menu_item_sizes ( id, name, price_delta, sort_order ),
  menu_item_modifier_groups (
    modifier_groups ( id, name_vi, name_en, is_required, modifiers ( id, name_vi, name_en, price_delta ) )
  )
`

export const MENU_ITEM_IMAGES_BUCKET = "menu-item-images"
export const MENU_ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type MenuItemImageValidationError = "invalid_type" | "too_large"

/** Validates a candidate image file before previewing or uploading it. */
export function validateMenuItemImageFile(
  file: Pick<File, "type" | "size">
): MenuItemImageValidationError | null {
  if (!file.type.startsWith("image/")) return "invalid_type"
  if (file.size > MENU_ITEM_IMAGE_MAX_BYTES) return "too_large"
  return null
}

function mapCategoryRow(row: CategoryRow): MenuCategory {
  return {
    id: row.id,
    nameVi: row.name_vi,
    nameEn: row.name_en,
    sortOrder: row.sort_order,
  }
}

function mapModifierGroupRow(row: ModifierGroupRow): MenuModifierGroup {
  return {
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
  }
}

/** Maps a joined `menu_items` database row into the camelCase domain model. */
export function mapMenuItemRow(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    categoryIds: (row.menu_item_categories ?? []).map((c) => c.category_id),
    nameVi: row.name_vi,
    nameEn: row.name_en,
    descriptionVi: row.description_vi,
    descriptionEn: row.description_en,
    basePrice: row.base_price,
    icon: row.icon,
    isAvailable: row.is_available,
    isPopular: row.is_popular,
    imageUrl: row.image_url,
    hasSizeOptions: row.has_size_options,
    sizes: (row.menu_item_sizes ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      priceDelta: s.price_delta,
      sortOrder: s.sort_order,
    })),
    modifierGroups: (row.menu_item_modifier_groups ?? []).map((link) =>
      mapModifierGroupRow(link.modifier_groups)
    ),
  }
}

function toMenuItemRowPayload(input: MenuItemInput) {
  return {
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

async function replaceItemChildren(
  supabase: SupabaseClient,
  table: string,
  itemId: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const { error: deleteError } = await supabase.from(table).delete().eq("menu_item_id", itemId)
  if (deleteError) throw deleteError

  if (rows.length === 0) return

  const { error: insertError } = await supabase.from(table).insert(rows)
  if (insertError) throw insertError
}

export async function getCategories(supabase: SupabaseClient): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name_vi, name_en, sort_order")
    .order("sort_order")
  if (error) throw error
  return ((data ?? []) as CategoryRow[]).map(mapCategoryRow)
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

export async function createCategory(supabase: SupabaseClient, input: CategoryInput): Promise<MenuCategory> {
  const { data, error } = await supabase
    .from("categories")
    .insert({ name_vi: input.nameVi, name_en: input.nameEn, sort_order: input.sortOrder })
    .select("id, name_vi, name_en, sort_order")
    .single()
  if (error) throw error
  return mapCategoryRow(data as CategoryRow)
}

export async function updateCategory(
  supabase: SupabaseClient,
  id: string,
  input: CategoryUpdateInput
): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ name_vi: input.nameVi, name_en: input.nameEn })
    .eq("id", id)
  if (error) throw error
}

// Blocked at the DB level by menu_item_categories_category_id_fkey (ON
// DELETE RESTRICT) whenever a menu item still references this category --
// callers must catch and show a friendly error rather than a raw FK
// violation.
export async function deleteCategory(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("categories").delete().eq("id", id)
  if (error) throw error
}

export async function createMenuItem(supabase: SupabaseClient, input: MenuItemInput): Promise<MenuItem> {
  const { data, error } = await supabase
    .from("menu_items")
    .insert(toMenuItemRowPayload(input))
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
    .update(toMenuItemRowPayload(input))
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
  return ((data ?? []) as unknown as ModifierGroupRow[]).map(mapModifierGroupRow)
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

  return mapModifierGroupRow({
    id: groupRow.id,
    name_vi: groupRow.name_vi,
    name_en: groupRow.name_en,
    is_required: groupRow.is_required,
    modifiers: [modifierRow as ModifierRow],
  })
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

  return mapModifierGroupRow({
    id: groupId,
    name_vi: input.nameVi,
    name_en: input.nameEn,
    is_required: false,
    modifiers: [modifierRow as ModifierRow],
  })
}

export async function setItemModifierGroups(
  supabase: SupabaseClient,
  itemId: string,
  groupIds: string[]
): Promise<void> {
  await replaceItemChildren(
    supabase,
    "menu_item_modifier_groups",
    itemId,
    groupIds.map((groupId) => ({ menu_item_id: itemId, modifier_group_id: groupId }))
  )
}

export async function setItemCategories(
  supabase: SupabaseClient,
  itemId: string,
  categoryIds: string[]
): Promise<void> {
  await replaceItemChildren(
    supabase,
    "menu_item_categories",
    itemId,
    categoryIds.map((categoryId) => ({ menu_item_id: itemId, category_id: categoryId }))
  )
}

export async function setItemSizes(
  supabase: SupabaseClient,
  itemId: string,
  sizes: MenuItemSizeInput[]
): Promise<void> {
  await replaceItemChildren(
    supabase,
    "menu_item_sizes",
    itemId,
    sizes.map((size, index) => ({
      menu_item_id: itemId,
      name: size.name,
      price_delta: size.priceDelta,
      sort_order: index,
    }))
  )
}

/** Uploads a menu item image to Supabase Storage and returns its public URL. */
export async function uploadMenuItemImage(supabase: SupabaseClient, file: File): Promise<string> {
  const path = `${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from(MENU_ITEM_IMAGES_BUCKET).upload(path, file)
  if (uploadError) throw uploadError
  return supabase.storage.from(MENU_ITEM_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Port for menu catalog reads, admin CRUD, image storage, and unified item saves. */
export type MenuPort = {
  getCategories(): Promise<MenuCategory[]>
  getMenuItems(): Promise<MenuItem[]>
  getMenuItemById(id: string): Promise<MenuItem | null>
  createCategory(input: CategoryInput): Promise<MenuCategory>
  updateCategory(id: string, input: CategoryUpdateInput): Promise<void>
  deleteCategory(id: string): Promise<void>
  createMenuItem(input: MenuItemInput): Promise<MenuItem>
  updateMenuItem(id: string, input: MenuItemInput): Promise<MenuItem>
  deleteMenuItem(id: string): Promise<void>
  getModifierGroups(): Promise<MenuModifierGroup[]>
  createModifierGroup(input: ModifierGroupInput): Promise<MenuModifierGroup>
  updateModifierGroup(groupId: string, input: ModifierGroupInput): Promise<MenuModifierGroup>
  setItemModifierGroups(itemId: string, groupIds: string[]): Promise<void>
  setItemCategories(itemId: string, categoryIds: string[]): Promise<void>
  setItemSizes(itemId: string, sizes: MenuItemSizeInput[]): Promise<void>
  uploadMenuItemImage(file: File): Promise<string>
  saveMenuItem(input: SaveMenuItemInput): Promise<MenuItem>
}

export type MenuRepository = MenuPort

type SaveMenuItemPort = Pick<
  MenuPort,
  | "uploadMenuItemImage"
  | "createMenuItem"
  | "updateMenuItem"
  | "setItemModifierGroups"
  | "setItemCategories"
  | "setItemSizes"
  | "getMenuItemById"
>

/** Saves a menu item (optional image upload + item upsert + links + refetch) via a `MenuPort`. */
export async function saveMenuItemWithPort(port: SaveMenuItemPort, input: SaveMenuItemInput): Promise<MenuItem> {
  const itemInput: MenuItemInput = input.imageFile
    ? { ...input.item, imageUrl: await port.uploadMenuItemImage(input.imageFile) }
    : input.item
  const saved = input.editingId
    ? await port.updateMenuItem(input.editingId, itemInput)
    : await port.createMenuItem(itemInput)
  await port.setItemModifierGroups(saved.id, input.extraGroupIds)
  await port.setItemCategories(saved.id, itemInput.categoryIds)
  await port.setItemSizes(saved.id, input.sizes)
  return (await port.getMenuItemById(saved.id)) ?? saved
}

/** Creates a `MenuPort` backed by the provided `SupabaseClient`. */
export function createSupabaseMenuAdapter(supabase: SupabaseClient): MenuPort {
  const adapter: MenuPort = {
    getCategories: () => getCategories(supabase),
    getMenuItems: () => getMenuItems(supabase),
    getMenuItemById: (id) => getMenuItemById(supabase, id),
    createCategory: (input) => createCategory(supabase, input),
    updateCategory: (id, input) => updateCategory(supabase, id, input),
    deleteCategory: (id) => deleteCategory(supabase, id),
    createMenuItem: (input) => createMenuItem(supabase, input),
    updateMenuItem: (id, input) => updateMenuItem(supabase, id, input),
    deleteMenuItem: (id) => deleteMenuItem(supabase, id),
    getModifierGroups: () => getModifierGroups(supabase),
    createModifierGroup: (input) => createModifierGroup(supabase, input),
    updateModifierGroup: (groupId, input) => updateModifierGroup(supabase, groupId, input),
    setItemModifierGroups: (itemId, groupIds) => setItemModifierGroups(supabase, itemId, groupIds),
    setItemCategories: (itemId, categoryIds) => setItemCategories(supabase, itemId, categoryIds),
    setItemSizes: (itemId, sizes) => setItemSizes(supabase, itemId, sizes),
    uploadMenuItemImage: (file) => uploadMenuItemImage(supabase, file),
    saveMenuItem: (input) => saveMenuItemWithPort(adapter, input),
  }
  return adapter
}

/** Unified entrypoint to upload an optional image, create/update an item, wire its links, and return the refreshed record. */
export async function saveMenuItem(supabase: SupabaseClient, input: SaveMenuItemInput): Promise<MenuItem> {
  return saveMenuItemWithPort(createSupabaseMenuAdapter(supabase), input)
}
