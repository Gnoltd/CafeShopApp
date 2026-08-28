"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "framer-motion"
import { Search, Plus, Ban } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { useCart, type AddToCartInput } from "@/hooks/useCart"
import { ItemImage } from "@/components/customer/item-image"
import { QuickAddPopup } from "@/components/customer/quick-add-popup"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"
import { TAP_SCALE, TAP_TRANSITION } from "@/components/motion/press-feedback"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

const ALL_CATEGORY = "all"

export function MenuBrowser({
  categories,
  items,
  onAddItem,
  cartItemCount,
  cartSubtotal,
  cartHref = "/cart",
}: {
  categories: MenuCategory[]
  items: MenuItem[]
  onAddItem?: (item: AddToCartInput, quantity?: number) => void
  cartItemCount?: number
  cartSubtotal?: number
  cartHref?: string
}) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const router = useRouter()
  const { addItem, itemCount, subtotal } = useCart()
  const addToCart = onAddItem ?? addItem
  const displayItemCount = cartItemCount ?? itemCount
  const displaySubtotal = cartSubtotal ?? subtotal

  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY)
  const [searchQuery, setSearchQuery] = useState("")
  const [quickAddItem, setQuickAddItem] = useState<MenuItem | null>(null)

  const name = (item: MenuItem) => (locale === "vi" ? item.nameVi : item.nameEn)
  const description = (item: MenuItem) => (locale === "vi" ? item.descriptionVi : item.descriptionEn)
  const categoryLabel = (c: MenuCategory) => (locale === "vi" ? c.nameVi : c.nameEn)

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesCategory = selectedCategory === ALL_CATEGORY || item.categoryId === selectedCategory
      const matchesQuery =
        query === "" ||
        item.nameVi.toLowerCase().includes(query) ||
        item.nameEn.toLowerCase().includes(query)
      return matchesCategory && matchesQuery
    })
  }, [items, selectedCategory, searchQuery])

  function openItem(item: MenuItem) {
    if (!item.isAvailable) return
    router.push(`/menu/${item.id}`)
  }

  function quickAdd(item: MenuItem) {
    if (!item.isAvailable) return
    const needsChoice = (item.hasSizeOptions && item.sizes.length > 0) || item.modifierGroups.length > 0
    if (needsChoice) {
      setQuickAddItem(item)
      return
    }
    addToCart({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      modifiers: [],
      unitPrice: item.basePrice,
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-6xl md:px-8">
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="nb-border h-11 rounded-lg bg-card pl-9"
        />
      </div>

      <SegmentedControl
        variant="chips"
        layoutId="menu-category-pill"
        className="mb-6"
        value={selectedCategory}
        onChange={setSelectedCategory}
        options={[
          { value: ALL_CATEGORY, label: t("allCategories") },
          ...categories.map((category) => ({ value: category.id, label: categoryLabel(category) })),
        ]}
      />

      {visibleItems.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("emptyResults")}</p>
      )}

      <StaggerList staggerKey={selectedCategory + searchQuery} className="flex flex-col gap-3 md:grid md:grid-cols-3 lg:grid-cols-4 md:gap-6">
        {visibleItems.map((item) => (
          <StaggerItem key={item.id} className="h-full">
            <button
              type="button"
              onClick={() => openItem(item)}
              className={cn(
                "nb-border nb-shadow nb-press flex w-full items-center gap-3 rounded-xl bg-card p-2 text-left md:h-full md:flex-col md:items-stretch md:p-0 md:overflow-hidden",
                !item.isAvailable && "opacity-70"
              )}
            >
              <ItemImage
                item={item}
                className={cn("h-28 w-28 shrink-0 rounded-lg md:h-48 md:w-full md:rounded-none", !item.isAvailable && "grayscale")}
                sizes="(max-width: 768px) 112px, 400px"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1 md:p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 font-bold text-card-foreground md:text-base">{name(item)}</span>
                  {item.isPopular && (
                    <Badge variant="neubrutal" className="shrink-0 text-primary">
                      {t("popular")}
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground md:line-clamp-2 md:text-sm md:h-10">{description(item)}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-extrabold text-price md:text-base">{formatVND(item.basePrice)}</span>
                  {item.isAvailable ? (
                    <motion.span
                      role="button"
                      aria-label={t("add")}
                      whileTap={TAP_SCALE}
                      transition={TAP_TRANSITION}
                      onClick={(e) => {
                        e.stopPropagation()
                        quickAdd(item)
                      }}
                      className="nb-border-sm nb-shadow-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  ) : (
                    <span className="nb-border-sm flex h-8 w-8 items-center justify-center rounded-full bg-chip text-muted-foreground">
                      <Ban className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
            </button>
          </StaggerItem>
        ))}
      </StaggerList>

      {displayItemCount > 0 && (
        <Link
          href={cartHref}
          className="nb-border nb-shadow nb-press fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center justify-between rounded-2xl bg-secondary px-5 py-4 text-secondary-foreground transition-colors hover:opacity-95 md:bottom-6 md:max-w-lg md:px-6"
        >
          <span className="font-semibold">
            {t("viewCart")} · {t("itemCount", { count: displayItemCount })}
          </span>
          <span className="text-lg font-bold">{formatVND(displaySubtotal)}</span>
        </Link>
      )}

      <AnimatePresence>
        {quickAddItem && (
          <QuickAddPopup key="quick-add-popup" item={quickAddItem} onClose={() => setQuickAddItem(null)} onAdd={onAddItem} />
        )}
      </AnimatePresence>
    </div>
  )
}
