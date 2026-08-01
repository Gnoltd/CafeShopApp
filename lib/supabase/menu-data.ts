// Re-export barrel: kept so existing imports of "@/lib/supabase/menu-data"
// keep working unchanged. The real modules are split by caller population --
// menu-catalog.ts (shared reads: customer, staff POS, admin) and
// menu-admin.ts (admin-only CRUD) -- sharing menu-mapping.ts for the row<->
// type translation. New code should import from the specific module it
// needs rather than this barrel.

export type { MenuIcon, MenuItemSize, MenuModifierOption, MenuModifierGroup, MenuItem } from "./menu-mapping"

export type { MenuCategory } from "./menu-catalog"
export { getCategories, getMenuItems, getMenuItemById } from "./menu-catalog"

export type { MenuItemSizeInput, MenuItemInput, ModifierGroupInput } from "./menu-admin"
export {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  setItemModifierGroups,
  setItemSizes,
} from "./menu-admin"
