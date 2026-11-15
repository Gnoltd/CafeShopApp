import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { unstable_cache } from "next/cache"
import { resolvePhadinCatalog } from "@/lib/phadin-menu-catalog"
import { getCategories, getMenuItems, type MenuCategory, type MenuItem } from "./menu-data"

/**
 * Deliberate exception to the DI'd (SupabaseClient-first-arg) query-layer
 * convention: menu content is public/non-personalized (RLS SELECT is
 * `true` for menu_items/menu_item_sizes/menu_item_modifier_groups), so
 * it's identical for every visitor and safe to cache. `/menu` and `/`
 * were measured taking ~600-800ms longer than auth-only pages
 * (e.g. /login) specifically because of this fetch running uncached on
 * every single request (the root layout's `force-dynamic` disables
 * Next's normal page-level caching for locale correctness, so this was
 * the only way to avoid re-running the full nested-join query every
 * load). 20s is short enough that an admin editing the menu sees it
 * reflected almost immediately, long enough to absorb real traffic.
 */
const getCachedMenuData = unstable_cache(
  async (): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> => {
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    const [categories, items] = await Promise.all([getCategories(supabase), getMenuItems(supabase)])
    return resolvePhadinCatalog(categories, items)
  },
  ["public-menu-data"],
  { revalidate: 20 }
)

export async function getPublicMenuData(): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  return getCachedMenuData()
}
