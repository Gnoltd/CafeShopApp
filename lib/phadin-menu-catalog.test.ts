import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import {
  PHADIN_CATEGORIES,
  PHADIN_MENU_ITEMS,
  attachCuratedMenuImages,
  isLegacySeedCatalog,
  resolvePhadinCatalog,
  resolvePhadinMenuItemById,
  syncPhadinMenuIfNeeded,
} from "./phadin-menu-catalog"
import type { MenuCategory, MenuItem } from "./supabase/menu-data"

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public")

describe("PHADIN_MENU_ITEMS & PHADIN_CATEGORIES", () => {
  it("defines 5 beverage categories and 27 drink items with 8 popular items", () => {
    expect(PHADIN_CATEGORIES).toHaveLength(5)
    expect(PHADIN_MENU_ITEMS).toHaveLength(27)

    const popularItems = PHADIN_MENU_ITEMS.filter((item) => item.isPopular)
    expect(popularItems).toHaveLength(8)

    const categoryIdSet = new Set(PHADIN_CATEGORIES.map((c) => c.id))
    for (const item of PHADIN_MENU_ITEMS) {
      expect(item.categoryIds.length).toBeGreaterThan(0)
      for (const catId of item.categoryIds) {
        expect(categoryIdSet.has(catId)).toBe(true)
      }
      expect(item.sizes).toHaveLength(2)
      expect(item.sizes.map((s) => s.name)).toEqual(["M", "L"])
    }
  })

  it("points every menu item to an existing JPEG image file in public/images/menu/", () => {
    const seenUrls = new Set<string>()
    for (const item of PHADIN_MENU_ITEMS) {
      expect(item.imageUrl).toMatch(/^\/images\/menu\/[a-z0-9-]+\.jpg$/)
      expect(seenUrls.has(item.imageUrl!)).toBe(false)
      seenUrls.add(item.imageUrl!)

      const diskPath = path.join(PUBLIC_DIR, item.imageUrl!)
      expect(existsSync(diskPath), `${diskPath} must exist`).toBe(true)
      const stat = statSync(diskPath)
      expect(stat.size).toBeGreaterThan(10 * 1024)
      expect(stat.size).toBeLessThan(5 * 1024 * 1024)
    }
  })

  it("detects legacy mock seed catalog vs migrated catalog", () => {
    const legacyItem: MenuItem = {
      ...PHADIN_MENU_ITEMS[0],
      nameVi: "Bánh Croissant Bơ",
      nameEn: "Butter Croissant",
    }
    expect(isLegacySeedCatalog([legacyItem])).toBe(true)
    expect(isLegacySeedCatalog(PHADIN_MENU_ITEMS)).toBe(false)

    const resolvedFromLegacy = resolvePhadinCatalog([], [legacyItem])
    expect(resolvedFromLegacy.categories).toHaveLength(5)
    expect(resolvedFromLegacy.items).toHaveLength(27)

    const migratedWithoutImage: MenuItem = {
      ...PHADIN_MENU_ITEMS[0],
      imageUrl: null,
    }
    const attached = attachCuratedMenuImages([migratedWithoutImage])
    expect(attached[0].imageUrl).toBe("/images/menu/ca-phe-den-pha-din.jpg")

    const resolvedById = resolvePhadinMenuItemById(PHADIN_MENU_ITEMS[0].id, migratedWithoutImage)
    expect(resolvedById?.imageUrl).toBe("/images/menu/ca-phe-den-pha-din.jpg")
  })

  it("syncs categories, items, category links, and sizes when legacy catalog is detected", async () => {
    const upsertCategories = vi.fn().mockResolvedValue({ error: null })
    const upsertItems = vi.fn().mockResolvedValue({ error: null })
    const deleteIn = vi.fn().mockResolvedValue({ error: null })
    const insertRows = vi.fn().mockResolvedValue({ error: null })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "categories") return { upsert: upsertCategories }
        if (table === "menu_items") return { upsert: upsertItems }
        return {
          delete: () => ({ in: deleteIn }),
          insert: insertRows,
        }
      }),
    }

    const legacyCategories: MenuCategory[] = [{ id: "c1", nameVi: "Bánh Ngọt", nameEn: "Pastries", sortOrder: 2 }]
    const legacyItems: MenuItem[] = [
      {
        ...PHADIN_MENU_ITEMS[0],
        nameVi: "Bánh Croissant Bơ",
        nameEn: "Butter Croissant",
        categoryIds: [legacyCategories[0].id],
      },
    ]

    const synced = await syncPhadinMenuIfNeeded(supabase as never, legacyItems)
    expect(synced).toBe(true)
    expect(upsertCategories).toHaveBeenCalledTimes(1)
    expect(upsertItems).toHaveBeenCalledTimes(1)
    expect(insertRows).toHaveBeenCalledTimes(2)
  })
})
