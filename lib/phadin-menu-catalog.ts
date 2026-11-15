import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  MenuCategory,
  MenuItem,
  MenuModifierGroup,
} from "@/lib/supabase/menu-data"

export const PHADIN_CATEGORY_IDS = {
  coffee: "0473f8fb-ed5e-44d3-9ee7-2ec803f2ec40",
  teaWarm: "feca9822-7a29-4818-abda-87c6e21ed45e",
  juice: "6546be10-b8d2-4283-b7e7-af8a1000956a",
  smoothieFrappe: "1c4fc178-ef40-4b41-bee7-8acfa28b524b",
  yogurt: "a590f8c1-4d2e-4b9a-8c11-7e3f9a2d5b05",
} as const

export const PHADIN_CATEGORIES: MenuCategory[] = [
  {
    id: PHADIN_CATEGORY_IDS.coffee,
    nameVi: "Cà Phê",
    nameEn: "Coffee",
    sortOrder: 0,
  },
  {
    id: PHADIN_CATEGORY_IDS.teaWarm,
    nameVi: "Trà & Đồ Ấm",
    nameEn: "Tea & Warm Drinks",
    sortOrder: 1,
  },
  {
    id: PHADIN_CATEGORY_IDS.juice,
    nameVi: "Nước Ép",
    nameEn: "Fresh Juice",
    sortOrder: 2,
  },
  {
    id: PHADIN_CATEGORY_IDS.smoothieFrappe,
    nameVi: "Sinh Tố & Đá Xay",
    nameEn: "Smoothies & Frappe",
    sortOrder: 3,
  },
  {
    id: PHADIN_CATEGORY_IDS.yogurt,
    nameVi: "Sữa Chua",
    nameEn: "Yogurt",
    sortOrder: 4,
  },
]

const MILK_OPTIONS_GROUP: MenuModifierGroup = {
  id: "91f1b239-0b3d-4ead-a5e0-4527ee337083",
  nameVi: "Lựa Chọn Sữa",
  nameEn: "Milk Options",
  required: true,
  options: [
    {
      id: "659fe68e-5231-4a02-a8e5-6f7202d46fe4",
      nameVi: "Sữa Đặc",
      nameEn: "Condensed Milk",
      priceDelta: 0,
    },
    {
      id: "fbc42849-36e3-491c-9ca3-121daa1fb3e8",
      nameVi: "Sữa Tươi",
      nameEn: "Fresh Milk",
      priceDelta: 5000,
    },
  ],
}

const EXTRA_SHOT_GROUP: MenuModifierGroup = {
  id: "a2b9e232-24fe-4247-974b-4dca04e9e812",
  nameVi: "Extra Shot",
  nameEn: "Extra Shot",
  required: false,
  options: [
    {
      id: "8b70ffdb-4f4a-4058-a57c-7fd38f03d8ac",
      nameVi: "Extra Shot",
      nameEn: "Extra Shot",
      priceDelta: 15000,
    },
  ],
}

function makeSizes(itemId: string) {
  const prefix = itemId.slice(0, 8)
  return [
    { id: `${prefix}-0000-4000-8000-000000000001`, name: "M", priceDelta: 0, sortOrder: 0 },
    { id: `${prefix}-0000-4000-8000-000000000002`, name: "L", priceDelta: 8000, sortOrder: 1 },
  ]
}

const RAW_PHADIN_ITEMS: Omit<MenuItem, "sizes">[] = [
  // 1. Cà Phê (8 món)
  {
    id: "8ebf4865-fe08-4ce5-a04f-9f5804393a55",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Cà Phê Đen Pha Đin",
    nameEn: "Black Coffee",
    descriptionVi: "Đen đá hoặc đen nóng rang xay nguyên chất hương vị Tây Bắc.",
    descriptionEn: "Traditional bold roasted black coffee, served hot or iced.",
    basePrice: 25000,
    icon: "coffee",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/ca-phe-den-pha-din.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "3929b81c-d4c9-42ef-9a76-b6e201712f23",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Cà Phê Sữa",
    nameEn: "Milk Coffee",
    descriptionVi: "Cà phê phin truyền thống hòa quyện cùng sữa đặc béo ngậy.",
    descriptionEn: "Authentic phin drip coffee with rich condensed milk.",
    basePrice: 29000,
    icon: "coffee",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/ca-phe-sua.jpg",
    hasSizeOptions: true,
    modifierGroups: [MILK_OPTIONS_GROUP, EXTRA_SHOT_GROUP],
  },
  {
    id: "2125b8be-1b27-45dd-9c2f-55662195a1ea",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Bạc Xỉu",
    nameEn: "White Coffee",
    descriptionVi: "Nhiều sữa tươi và sữa đặc, dịu nhẹ vị cà phê.",
    descriptionEn: "Sweet milk-forward coffee with a gentle espresso finish.",
    basePrice: 32000,
    icon: "milk",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/bac-xiu.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "145d4b16-2ab6-4d93-856e-3ffb3f268025",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Cà Phê Muối",
    nameEn: "Salted Cream Coffee",
    descriptionVi: "Cà phê phin đậm đà phủ lớp kem muối mặn dịu béo thơm.",
    descriptionEn: "Rich phin coffee topped with silky salted cream foam.",
    basePrice: 35000,
    icon: "coffee",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/ca-phe-muoi.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "55e969aa-4fca-471d-9eec-ae9e4e511240",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Cà Phê Cốt Dừa",
    nameEn: "Coconut Milk Coffee",
    descriptionVi: "Cốt dừa xay sánh mịn kết hợp cùng cà phê phin đậm vị.",
    descriptionEn: "Blended creamy coconut milk over bold phin coffee.",
    basePrice: 39000,
    icon: "coffee",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/ca-phe-cot-dua.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "b1000001-0000-4000-8000-000000000006",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Americano",
    nameEn: "Iced / Hot Americano",
    descriptionVi: "Espresso pha loãng thanh nhẹ, phục vụ nóng hoặc đá.",
    descriptionEn: "Smooth espresso diluted with hot water or served over ice.",
    basePrice: 32000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/americano.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "b1000001-0000-4000-8000-000000000007",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Café Latte",
    nameEn: "Café Latte",
    descriptionVi: "Espresso hạt Arabica Tây Bắc hòa quyện cùng sữa tươi.",
    descriptionEn: "Northwest Arabica espresso with steamed or chilled fresh milk.",
    basePrice: 39000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/cafe-latte.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },
  {
    id: "b1000001-0000-4000-8000-000000000008",
    categoryIds: [PHADIN_CATEGORY_IDS.coffee],
    nameVi: "Cappuccino",
    nameEn: "Cappuccino",
    descriptionVi: "Espresso kết hợp lớp bọt sữa đánh bông dày mịn.",
    descriptionEn: "Classic espresso topped with airy, velvety milk foam.",
    basePrice: 39000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/cappuccino.jpg",
    hasSizeOptions: true,
    modifierGroups: [EXTRA_SHOT_GROUP],
  },

  // 2. Trà & Đồ Ấm (6 món)
  {
    id: "765a8e06-8a02-4170-993c-65fbcbebf899",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Trà Đào Cam Sả",
    nameEn: "Peach Orange Lemongrass Tea",
    descriptionVi: "Hồng trà ủ lạnh kết hợp đào miếng giòn, cam vàng và hương sả tươi.",
    descriptionEn: "Chilled black tea with crisp peach slices, orange, and lemongrass.",
    basePrice: 35000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/tra-dao-cam-sa.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "0efa7eed-c1f3-408e-bd79-b415a3e81531",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Matcha Latte",
    nameEn: "Matcha Latte",
    descriptionVi: "Bột trà xanh Nhật Bản khuấy mịn cùng sữa tươi nóng hoặc đá.",
    descriptionEn: "Japanese matcha whisked with fresh milk, served hot or iced.",
    basePrice: 38000,
    icon: "milk",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/matcha-latte.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000011",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Trà Gừng Mật Ong",
    nameEn: "Hot Ginger Honey Tea",
    descriptionVi: "Trà ấm pha gừng tươi giã thơm và mật ong rừng Tây Bắc.",
    descriptionEn: "Warming ginger infusion sweetened with wild Northwest honey.",
    basePrice: 30000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/tra-gung-mat-ong.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000012",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Trà Lipton Chanh Mật Ong",
    nameEn: "Lipton Lemon Honey Tea",
    descriptionVi: "Trà Lipton truyền thống kết hợp chanh tươi và mật ong.",
    descriptionEn: "Classic Lipton black tea with fresh lime and honey.",
    basePrice: 28000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/tra-lipton-chanh-mat-ong.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000013",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Trà Hoa Cúc Mật Ong",
    nameEn: "Chamomile Honey Tea",
    descriptionVi: "Trà hoa cúc thanh dịu pha mật ong ấm áp, thư giãn.",
    descriptionEn: "Soothing chamomile blossom tea sweetened with pure honey.",
    basePrice: 32000,
    icon: "coffee",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/tra-hoa-cuc-mat-ong.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000014",
    categoryIds: [PHADIN_CATEGORY_IDS.teaWarm],
    nameVi: "Cacao Sữa Nóng / Đá",
    nameEn: "Hot / Iced Milk Cocoa",
    descriptionVi: "Cacao nguyên chất đậm vị pha cùng sữa đặc béo thơm.",
    descriptionEn: "Rich pure cocoa blended with creamy condensed milk.",
    basePrice: 35000,
    icon: "milk",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/cacao-sua.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },

  // 3. Nước Ép (6 món)
  {
    id: "3e0d2857-ed99-4fab-8b57-047b2251c99b",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Ép Cam Dứa",
    nameEn: "Orange Pineapple Juice",
    descriptionVi: "Cam tươi ép nguyên chất kết hợp dứa chín thơm mát.",
    descriptionEn: "Freshly pressed orange and sweet pineapple juice.",
    basePrice: 38000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/nuoc-ep-cam-dua.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "9d8131f4-065d-4355-9ee7-db9ac5a4c71e",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Ép Cam Cà Rốt",
    nameEn: "Orange Carrot Juice",
    descriptionVi: "Nước ép cam tươi và cà rốt nguyên chất giàu vitamin.",
    descriptionEn: "Vitamin-rich freshly pressed orange and carrot juice.",
    basePrice: 35000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/nuoc-ep-cam-ca-rot.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000017",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Ép Dưa Hấu",
    nameEn: "Fresh Watermelon Juice",
    descriptionVi: "Dưa hấu đỏ ép lạnh tự nhiên, thanh ngọt giải nhiệt.",
    descriptionEn: "Cold-pressed sweet red watermelon juice.",
    basePrice: 32000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/nuoc-ep-dua-hau.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000018",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Cam Tươi",
    nameEn: "Fresh Orange Juice",
    descriptionVi: "Cam tươi vắt nguyên chất 100% giàu vitamin C.",
    descriptionEn: "100% freshly squeezed orange juice.",
    basePrice: 35000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: true,
    imageUrl: "/images/menu/nuoc-cam-tuoi.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000019",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Ép Dứa",
    nameEn: "Fresh Pineapple Juice",
    descriptionVi: "Dứa chín ép tươi giữ trọn vị chua ngọt tự nhiên.",
    descriptionEn: "Freshly pressed ripe pineapple juice.",
    basePrice: 32000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/nuoc-ep-dua.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000020",
    categoryIds: [PHADIN_CATEGORY_IDS.juice],
    nameVi: "Nước Chanh Leo / Chanh Tươi",
    nameEn: "Fresh Passion Fruit / Lime Juice",
    descriptionVi: "Chanh leo hoặc chanh tươi pha đá mát lạnh sảng khoái.",
    descriptionEn: "Refreshing iced passion fruit or fresh lime cooler.",
    basePrice: 28000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/nuoc-chanh-leo-chanh-tuoi.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },

  // 4. Sinh Tố & Đá Xay (4 món)
  {
    id: "b1000001-0000-4000-8000-000000000021",
    categoryIds: [PHADIN_CATEGORY_IDS.smoothieFrappe],
    nameVi: "Sinh Tố Xoài",
    nameEn: "Fresh Mango Smoothie",
    descriptionVi: "Xoài chín xay sánh mịn cùng sữa đặc và đá tuyết.",
    descriptionEn: "Ripe mango blended smooth with condensed milk and ice.",
    basePrice: 39000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/sinh-to-xoai.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000022",
    categoryIds: [PHADIN_CATEGORY_IDS.smoothieFrappe],
    nameVi: "Sinh Tố Bơ",
    nameEn: "Avocado Smoothie",
    descriptionVi: "Bơ sáp dẻo mịn xay cùng sữa tươi và sữa đặc.",
    descriptionEn: "Creamy ripe avocado blended with fresh and condensed milk.",
    basePrice: 42000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/sinh-to-bo.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000023",
    categoryIds: [PHADIN_CATEGORY_IDS.smoothieFrappe],
    nameVi: "Cookie & Cream Đá Xay",
    nameEn: "Cookies & Cream Frappe",
    descriptionVi: "Bánh Oreo xay mịn cùng sữa tươi và kem vani.",
    descriptionEn: "Oreo cookies blended with ice, milk, and vanilla cream.",
    basePrice: 42000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/cookie-cream-da-xay.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "6dd6dac7-49e1-48d0-b643-a4d68850b093",
    categoryIds: [PHADIN_CATEGORY_IDS.smoothieFrappe],
    nameVi: "Sô-cô-la Đá Xay",
    nameEn: "Chocolate Ice Blended",
    descriptionVi: "Sô-cô-la đậm đặc xay đá mịn mát lạnh.",
    descriptionEn: "Rich dark chocolate ice-blended frappe.",
    basePrice: 42000,
    icon: "cup-soda",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/so-co-la-da-xay.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },

  // 5. Sữa Chua (3 món)
  {
    id: "b1000001-0000-4000-8000-000000000025",
    categoryIds: [PHADIN_CATEGORY_IDS.yogurt],
    nameVi: "Sữa Chua Đánh Đá Cà Phê",
    nameEn: "Coffee Crushed Ice Yogurt",
    descriptionVi: "Sữa chua đánh đá mịn rưới cốt cà phê phin đậm đà.",
    descriptionEn: "Tangy yogurt whipped with crushed ice and bold phin coffee.",
    basePrice: 35000,
    icon: "milk",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/sua-chua-danh-da-ca-phe.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000026",
    categoryIds: [PHADIN_CATEGORY_IDS.yogurt],
    nameVi: "Sữa Chua Đánh Đá Truyền Thống",
    nameEn: "Classic Crushed Ice Yogurt",
    descriptionVi: "Sữa chua đánh đá kèm sữa đặc và chút chanh tươi.",
    descriptionEn: "Classic Vietnamese yogurt whipped with condensed milk and crushed ice.",
    basePrice: 28000,
    icon: "milk",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/sua-chua-danh-da-truyen-thong.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
  {
    id: "b1000001-0000-4000-8000-000000000027",
    categoryIds: [PHADIN_CATEGORY_IDS.yogurt],
    nameVi: "Sữa Chua Hoa Quả / Việt Quất",
    nameEn: "Fruit / Blueberry Yogurt",
    descriptionVi: "Sữa chua dầm hoa quả tươi hoặc sốt việt quất chua ngọt.",
    descriptionEn: "Chilled yogurt topped with fresh seasonal fruit and blueberry compote.",
    basePrice: 35000,
    icon: "milk",
    isAvailable: true,
    isPopular: false,
    imageUrl: "/images/menu/sua-chua-hoa-qua-viet-quat.jpg",
    hasSizeOptions: true,
    modifierGroups: [],
  },
]

export const PHADIN_MENU_ITEMS: MenuItem[] = RAW_PHADIN_ITEMS.map((item) => ({
  ...item,
  sizes: makeSizes(item.id),
}))

const LEGACY_SEED_ITEM_NAMES_EN = new Set([
  "Butter Croissant",
  "Crispy Breadsticks",
  "test",
])

/** True when the database rows still reflect the pre-Phadin mock seed (`0009_seed_menu_data.sql`). */
export function isLegacySeedCatalog(items: MenuItem[]): boolean {
  if (items.length === 0) return true
  return items.length < 20 && items.some((item) => LEGACY_SEED_ITEM_NAMES_EN.has(item.nameEn))
}

/**
 * Ensures any DB item missing an `imageUrl` (or still pointing at the old
 * placeholder upload `IMG_7033.jpeg`) receives its curated local image path.
 */
export function attachCuratedMenuImages(items: MenuItem[]): MenuItem[] {
  const byId = new Map(PHADIN_MENU_ITEMS.map((item) => [item.id, item.imageUrl]))
  const byNameVi = new Map(PHADIN_MENU_ITEMS.map((item) => [item.nameVi.toLowerCase(), item.imageUrl]))
  const byNameEn = new Map(PHADIN_MENU_ITEMS.map((item) => [item.nameEn.toLowerCase(), item.imageUrl]))

  return items.map((item) => {
    const hasPlaceholder = item.imageUrl?.includes("IMG_7033.jpeg") ?? false
    if (item.imageUrl && !hasPlaceholder) return item
    const fallbackUrl =
      byId.get(item.id) ??
      byNameVi.get(item.nameVi.toLowerCase()) ??
      byNameEn.get(item.nameEn.toLowerCase()) ??
      null
    return fallbackUrl ? { ...item, imageUrl: fallbackUrl } : item
  })
}

/**
 * Resolves the active Phadin beverage catalog: returns the 27-drink catalog
 * when the database still holds the old 9-item mock seed, or returns the live
 * database catalog with curated image fallbacks attached.
 */
export function resolvePhadinCatalog(
  dbCategories: MenuCategory[],
  dbItems: MenuItem[]
): { categories: MenuCategory[]; items: MenuItem[] } {
  if (isLegacySeedCatalog(dbItems)) {
    return {
      categories: PHADIN_CATEGORIES,
      items: PHADIN_MENU_ITEMS,
    }
  }
  return {
    categories: dbCategories,
    items: attachCuratedMenuImages(dbItems),
  }
}

/** Resolves a single `MenuItem` by id, falling back to the 27-drink catalog when unmigrated. */
export function resolvePhadinMenuItemById(id: string, dbItem: MenuItem | null): MenuItem | null {
  const catalogMatch = PHADIN_MENU_ITEMS.find((item) => item.id === id) ?? null
  if (!dbItem) return catalogMatch
  if (LEGACY_SEED_ITEM_NAMES_EN.has(dbItem.nameEn) && catalogMatch) {
    return catalogMatch
  }
  return attachCuratedMenuImages([dbItem])[0]
}

/**
 * Idempotently syncs the 5 Phadin categories and 27 beverage items into
 * Supabase when called with an authenticated manager/admin client.
 * Safely no-ops if the caller lacks write permissions.
 */
export async function syncPhadinMenuIfNeeded(
  supabase: SupabaseClient,
  currentItems: MenuItem[]
): Promise<boolean> {
  if (!isLegacySeedCatalog(currentItems)) return false

  const { error: catErr } = await supabase.from("categories").upsert(
    PHADIN_CATEGORIES.map((c) => ({
      id: c.id,
      name_vi: c.nameVi,
      name_en: c.nameEn,
      sort_order: c.sortOrder,
    })),
    { onConflict: "id" }
  )
  if (catErr) return false

  const { error: itemErr } = await supabase.from("menu_items").upsert(
    PHADIN_MENU_ITEMS.map((item) => ({
      id: item.id,
      name_vi: item.nameVi,
      name_en: item.nameEn,
      description_vi: item.descriptionVi,
      description_en: item.descriptionEn,
      base_price: item.basePrice,
      icon: item.icon,
      is_available: item.isAvailable,
      is_popular: item.isPopular,
      image_url: item.imageUrl,
      has_size_options: item.hasSizeOptions,
    })),
    { onConflict: "id" }
  )
  if (itemErr) return false

  const itemIds = PHADIN_MENU_ITEMS.map((item) => item.id)
  await supabase.from("menu_item_categories").delete().in("menu_item_id", itemIds)
  await supabase.from("menu_item_categories").insert(
    PHADIN_MENU_ITEMS.flatMap((item) =>
      item.categoryIds.map((categoryId) => ({
        menu_item_id: item.id,
        category_id: categoryId,
      }))
    )
  )

  await supabase.from("menu_item_sizes").delete().in("menu_item_id", itemIds)
  await supabase.from("menu_item_sizes").insert(
    PHADIN_MENU_ITEMS.flatMap((item) =>
      item.sizes.map((size) => ({
        menu_item_id: item.id,
        name: size.name,
        price_delta: size.priceDelta,
        sort_order: size.sortOrder,
      }))
    )
  )

  return true
}
