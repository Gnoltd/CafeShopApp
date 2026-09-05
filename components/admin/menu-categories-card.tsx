"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { createCategory, updateCategory, deleteCategory, type MenuCategory } from "@/lib/supabase/menu-data"

export function MenuCategoriesCard({
  categories,
  onCategoriesChange,
  itemCountByCategory,
}: {
  categories: MenuCategory[]
  onCategoriesChange: (categories: MenuCategory[]) => void
  itemCountByCategory: Record<string, number>
}) {
  const locale = useLocale()
  const t = useTranslations("AdminMenu")
  const supabase = createClient()
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  async function handleRename(category: MenuCategory, field: "nameVi" | "nameEn", value: string) {
    const trimmed = value.trim()
    if (!trimmed || trimmed === category[field]) return
    setError(null)
    try {
      await updateCategory(supabase, category.id, {
        nameVi: field === "nameVi" ? trimmed : category.nameVi,
        nameEn: field === "nameEn" ? trimmed : category.nameEn,
      })
      onCategoriesChange(
        categories.map((c) => (c.id === category.id ? { ...c, [field]: trimmed } : c))
      )
    } catch {
      setError(t("categorySaveError"))
    }
  }

  async function handleAdd() {
    setError(null)
    setIsAdding(true)
    try {
      const nextSortOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1
      const created = await createCategory(supabase, {
        nameVi: t("categoriesTitle"),
        nameEn: t("categoriesTitle"),
        sortOrder: nextSortOrder,
      })
      onCategoriesChange([...categories, created])
    } catch {
      setError(t("categorySaveError"))
    } finally {
      setIsAdding(false)
    }
  }

  async function handleRemove(category: MenuCategory) {
    setError(null)
    try {
      await deleteCategory(supabase, category.id)
      onCategoriesChange(categories.filter((c) => c.id !== category.id))
    } catch {
      // The FK constraint (menu_items_category_id_fkey, ON DELETE RESTRICT)
      // is what actually stops this while items still reference the
      // category -- there's no client-side count check to duplicate.
      setError(t("categoryDeleteError"))
    }
  }

  return (
    <div className="nb-border-sm nb-shadow-sm flex flex-col gap-3 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-card-foreground">{t("categoriesTitle")}</h3>
        <button
          type="button"
          onClick={() => setIsEditing((v) => !v)}
          className="shrink-0 text-xs font-extrabold text-primary underline underline-offset-2"
        >
          {isEditing ? t("doneCategories") : t("manageCategories")}
        </button>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive">{error}</p>}

      {isEditing ? (
        <div className="flex flex-col gap-2">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-1.5">
              <input
                defaultValue={category.nameVi}
                onBlur={(e) => handleRename(category, "nameVi", e.target.value)}
                placeholder={t("nameViLabel")}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                defaultValue={category.nameEn}
                onBlur={(e) => handleRename(category, "nameEn", e.target.value)}
                placeholder={t("nameEnLabel")}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm italic focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => handleRemove(category)}
                aria-label={t("removeCategory")}
                title={t("removeCategory")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-9 w-full" onClick={handleAdd} disabled={isAdding}>
            {t("addCategory")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <span key={category.id} className="nb-border-sm rounded-full bg-chip px-3 py-1 text-xs font-extrabold text-foreground">
              {locale === "vi" ? category.nameVi : category.nameEn} · {itemCountByCategory[category.id] ?? 0}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
