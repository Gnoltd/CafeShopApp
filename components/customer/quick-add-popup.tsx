"use client"

import type { MenuItemSelection } from "@/lib/menu-selection-types"
import { SizeExtrasSheet } from "@/components/shared/size-extras-sheet"
import type { MenuItem } from "@/lib/supabase/menu-data"

/**
 * Quick-add sheet for configuring an item's size and/or extras inside a
 * table ordering session without leaving the Menu grid.
 */
export function QuickAddPopup({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem
  onClose: () => void
  onAdd: (selection: MenuItemSelection) => void
}) {
  return <SizeExtrasSheet item={item} onAdd={onAdd} onClose={onClose} />
}
