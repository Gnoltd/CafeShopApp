/**
 * Canonical menu item selection shape shared across menu selection UI
 * (useSizeModifierSelection, SizeExtrasSheet, QuickAddPopup, MenuBrowser)
 * and table-session cart mutations.
 */
export type MenuItemSelection = {
  menuItemId: string
  sizeId: string | null
  modifierIds: string[]
  note?: string | null
  quantity?: number
}
