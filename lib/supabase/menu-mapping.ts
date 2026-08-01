export type MenuIcon = "coffee" | "cup-soda" | "cookie" | "milk"

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
  categoryId: string
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
  category_id: string
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
  id, category_id, name_vi, name_en, description_vi, description_en,
  base_price, icon, is_available, is_popular, image_url, has_size_options,
  menu_item_sizes ( id, name, price_delta, sort_order ),
  menu_item_modifier_groups (
    modifier_groups ( id, name_vi, name_en, is_required, modifiers ( id, name_vi, name_en, price_delta ) )
  )
`

export function mapMenuItemRow(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
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
    modifierGroups: (row.menu_item_modifier_groups ?? []).map((link) => ({
      id: link.modifier_groups.id,
      nameVi: link.modifier_groups.name_vi,
      nameEn: link.modifier_groups.name_en,
      required: link.modifier_groups.is_required,
      options: (link.modifier_groups.modifiers ?? []).map((m) => ({
        id: m.id,
        nameVi: m.name_vi,
        nameEn: m.name_en,
        priceDelta: m.price_delta,
      })),
    })),
  }
}
