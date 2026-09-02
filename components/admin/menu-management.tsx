"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, CupSoda, Cookie, Milk, Search, Plus, Pencil, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import {
  deleteMenuItem,
  updateMenuItem,
  type MenuCategory,
  type MenuIcon,
  type MenuItem,
  type MenuItemInput,
  type MenuItemSizeInput,
} from "@/lib/supabase/menu-data"
import { saveMenuItem } from "@/lib/supabase/save-menu-item"
import type { RecipeEntry } from "@/lib/supabase/inventory-data"
import { MenuItemForm } from "@/components/admin/menu-item-form"

const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

const CATEGORY_BADGE_STYLE = "bg-accent/30 text-accent-foreground"

const PAGE_SIZE = 5

type FormMode = { type: "add" } | { type: "edit"; item: MenuItem } | null

export function MenuManagement({
  categories,
  initialItems,
}: {
  categories: MenuCategory[]
  initialItems: MenuItem[]
}) {
  const locale = useLocale()
  const t = useTranslations("AdminMenu")
  const supabase = createClient()

  const [items, setItems] = useState(initialItems)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const categoryLabel = (id: string) => {
    const category = categories.find((c) => c.id === id)
    if (!category) return id
    return locale === "vi" ? category.nameVi : category.nameEn
  }

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesCategory = !selectedCategory || item.categoryId === selectedCategory
      const matchesQuery =
        query === "" || item.nameVi.toLowerCase().includes(query) || item.nameEn.toLowerCase().includes(query)
      return matchesCategory && matchesQuery
    })
  }, [items, selectedCategory, searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedCategory, searchQuery])

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE))
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pagedItems = visibleItems.slice(pageStart, pageStart + PAGE_SIZE)

  async function toggleAvailability(item: MenuItem) {
    setError(null)
    try {
      const updated = await updateMenuItem(supabase, item.id, {
        categoryId: item.categoryId,
        nameVi: item.nameVi,
        nameEn: item.nameEn,
        descriptionVi: item.descriptionVi,
        descriptionEn: item.descriptionEn,
        basePrice: item.basePrice,
        icon: item.icon,
        isAvailable: !item.isAvailable,
        isPopular: item.isPopular,
        hasSizeOptions: item.hasSizeOptions,
        imageUrl: item.imageUrl,
      })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    } catch {
      setError(t("saveError"))
    }
  }

  async function removeItem(id: string) {
    setError(null)
    try {
      await deleteMenuItem(supabase, id)
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch {
      setError(t("deleteError"))
    }
  }

  async function saveItem(
    input: MenuItemInput,
    extraGroupIds: string[],
    recipeEntries: RecipeEntry[],
    sizes: MenuItemSizeInput[],
    editingId: string | null
  ) {
    setError(null)
    try {
      const refreshed = await saveMenuItem(supabase, { editingId, item: input, extraGroupIds, recipeEntries, sizes })
      setItems((prev) =>
        editingId ? prev.map((item) => (item.id === editingId ? refreshed : item)) : [refreshed, ...prev]
      )
      setFormMode(null)
    } catch {
      setError(t("saveError"))
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="neubrutal" className="h-10 gap-2" onClick={() => setFormMode({ type: "add" })}>
          <Plus className="h-4 w-4" />
          {t("addItem")}
        </Button>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {formMode && (
        <MenuItemForm
          categories={categories}
          initialItem={formMode.type === "edit" ? formMode.item : undefined}
          onCancel={() => setFormMode(null)}
          onSave={(input, extraGroupIds, recipeEntries, sizes) =>
            saveItem(input, extraGroupIds, recipeEntries, sizes, formMode?.type === "edit" ? formMode.item.id : null)
          }
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="nb-border-sm h-10 rounded-lg bg-card pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={cn(
              "nb-border-sm nb-shadow-sm nb-press-sm rounded-lg px-3 py-1.5 text-sm font-extrabold",
              selectedCategory === null
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground"
            )}
          >
            {t("allCategories")}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                "nb-border-sm nb-shadow-sm nb-press-sm rounded-lg px-3 py-1.5 text-sm font-extrabold",
                selectedCategory === category.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground"
              )}
            >
              {locale === "vi" ? category.nameVi : category.nameEn}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {pagedItems.map((item) => {
          const Icon = ICONS[item.icon]
          const isAvailable = item.isAvailable
          return (
            <div key={item.id} className="nb-border-sm nb-shadow-sm flex flex-col gap-3 rounded-xl bg-card p-4">
              <div className="flex items-center gap-3">
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-card-foreground">
                    {locale === "vi" ? item.nameVi : item.nameEn}
                  </p>
                  <p className="truncate text-xs italic text-muted-foreground">
                    {locale === "vi" ? item.nameEn : item.nameVi}
                  </p>
                </div>
                <span className="shrink-0 font-bold text-primary">{formatVND(item.basePrice)}</span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}>
                  {categoryLabel(item.categoryId)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isAvailable}
                    aria-label={t("available")}
                    onClick={() => toggleAvailability(item)}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                      isAvailable ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                        isAvailable ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMode({ type: "edit", item })}
                    aria-label={t("edit")}
                    title={t("edit")}
                    className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={t("delete")}
                    title={t("delete")}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {t("showingItems", {
              start: visibleItems.length === 0 ? 0 : pageStart + 1,
              end: Math.min(pageStart + PAGE_SIZE, visibleItems.length),
              total: visibleItems.length,
            })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("previous")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
                  page === currentPage
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground"
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>

      <div className="nb-border-sm nb-shadow-sm hidden overflow-x-auto rounded-xl bg-card md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("item")}</th>
              <th className="px-4 py-3 font-medium">{t("categoryLabel")}</th>
              <th className="px-4 py-3 font-medium">{t("price")}</th>
              <th className="px-4 py-3 font-medium">{t("available")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pagedItems.map((item) => {
              const Icon = ICONS[item.icon]
              const isAvailable = item.isAvailable
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-5 w-5" />
                        </div>
                      )}
                      <div>
                        <p className="font-bold text-card-foreground">
                          {locale === "vi" ? item.nameVi : item.nameEn}
                        </p>
                        <p className="text-xs italic text-muted-foreground">
                          {locale === "vi" ? item.nameEn : item.nameVi}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("nb-border-sm rounded-full px-2.5 py-1 text-xs font-extrabold", CATEGORY_BADGE_STYLE)}>
                      {categoryLabel(item.categoryId)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-primary">{formatVND(item.basePrice)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAvailable}
                      onClick={() => toggleAvailability(item)}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        isAvailable ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          isAvailable ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setFormMode({ type: "edit", item })}
                        aria-label={t("edit")}
                        title={t("edit")}
                        className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={t("delete")}
                        title={t("delete")}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="flex flex-col items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 sm:flex-row">
          <span className="text-xs text-muted-foreground">
            {t("showingItems", {
              start: visibleItems.length === 0 ? 0 : pageStart + 1,
              end: Math.min(pageStart + PAGE_SIZE, visibleItems.length),
              total: visibleItems.length,
            })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("previous")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "nb-border-sm nb-press-sm rounded-lg px-3 py-1 text-xs font-extrabold",
                  page === currentPage
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground"
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1 text-xs font-extrabold text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
