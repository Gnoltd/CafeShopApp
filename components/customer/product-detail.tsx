"use client"

import { useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { Coffee, CupSoda, Cookie, Milk, Check } from "lucide-react"
import { useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { useCart, type CartModifier } from "@/hooks/useCart"
import { useSizeModifierSelection } from "@/hooks/useSizeModifierSelection"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PressFeedback, TAP_SCALE, TAP_TRANSITION } from "@/components/motion/press-feedback"
import type { MenuItem, MenuIcon } from "@/lib/supabase/menu-data"

const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

export function ProductDetail({ item }: { item: MenuItem }) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const tProduct = useTranslations("ProductDetail")
  const router = useRouter()
  const { addItem } = useCart()

  const {
    selectedSizeId,
    setSelectedSizeId,
    selectedModifiers,
    toggleModifier,
    selectedSize,
    selectedOptions,
    price,
    extraGroups,
    otherGroups,
  } = useSizeModifierSelection(item)
  const [note, setNote] = useState("")

  const name = locale === "vi" ? item.nameVi : item.nameEn
  const description = locale === "vi" ? item.descriptionVi : item.descriptionEn
  const Icon = ICONS[item.icon]

  function handleAddToCart() {
    const modifiers: CartModifier[] = selectedOptions.map(({ group, option }) => ({
      groupId: group.id,
      optionId: option.id,
      labelVi: option.nameVi,
      labelEn: option.nameEn,
      priceDelta: option.priceDelta,
    }))
    const trimmedNote = note.trim()
    addItem({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      size: selectedSize
        ? { id: selectedSize.id, label: selectedSize.name, priceDelta: selectedSize.priceDelta }
        : undefined,
      modifiers,
      note: trimmedNote || undefined,
      unitPrice: price,
    })
    router.push("/menu")
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 md:max-w-5xl md:px-8 md:pb-8 pt-4">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        {/* Left Column: Hero image (sticky) */}
        <div className="w-full md:w-[40%] md:sticky md:top-20 md:self-start">
          <div className="nb-border nb-shadow relative flex h-64 w-full items-center justify-center overflow-hidden bg-chip text-muted-foreground sm:h-80 md:h-[400px] md:rounded-2xl">
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt={name}
                fill
                sizes="(max-width: 768px) 100vw, 40vw"
                className="object-cover"
                priority
              />
            ) : (
              <Icon className="h-20 w-20" />
            )}
          </div>
        </div>

        {/* Right Column: Details & Selections */}
        <div className="flex-1 px-4 md:px-0">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-card-foreground md:text-3xl">{name}</h1>
            <span className="whitespace-nowrap text-xl font-extrabold text-price md:text-2xl">{formatVND(price)}</span>
          </div>

          <p className="mt-3 text-sm text-muted-foreground md:text-base">{description}</p>

          {item.hasSizeOptions && item.sizes.length > 0 && (
            <section className="mt-6 flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("size")}
              </span>
              <SegmentedControl
                variant="tabs"
                layoutId="product-size-pill"
                value={selectedSizeId ?? ""}
                onChange={setSelectedSizeId}
                options={item.sizes.map((size) => ({
                  value: size.id,
                  label: size.priceDelta > 0 ? `${size.name} +${formatVND(size.priceDelta)}` : size.name,
                }))}
              />
            </section>
          )}

          {extraGroups.length > 0 && (
            <section className="mt-6 flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tProduct("extrasLabel")}
              </span>
              <div className="flex flex-col gap-2">
                {extraGroups.map((group) => {
                  const option = group.options[0]
                  const selected = selectedModifiers[group.id] === option.id
                  return (
                    <PressFeedback
                      key={group.id}
                      type="button"
                      onClick={() => toggleModifier(group, option.id)}
                      className={cn(
                        "nb-border-sm nb-shadow-sm nb-press-sm flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                        selected
                          ? "bg-primary/10 font-bold text-card-foreground"
                          : "bg-card text-card-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Check className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-transparent")} />
                        <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                      </div>
                      <span className={selected ? "text-primary" : "text-muted-foreground"}>
                        {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : tProduct("freeLabel")}
                      </span>
                    </PressFeedback>
                  )
                })}
              </div>
            </section>
          )}

          {otherGroups.map((group) => (
            <section key={group.id} className="mt-6 flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {locale === "vi" ? group.nameVi : group.nameEn}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {group.options.map((option) => {
                  const selected = selectedModifiers[group.id] === option.id
                  return (
                    <PressFeedback
                      key={option.id}
                      type="button"
                      onClick={() => toggleModifier(group, option.id)}
                      className={cn(
                        "nb-border-sm nb-shadow-sm nb-press-sm flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-sm",
                        selected
                          ? "bg-primary/10 font-bold text-card-foreground"
                          : "bg-card text-card-foreground"
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                        {selected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : tProduct("freeLabel")}
                      </span>
                    </PressFeedback>
                  )
                })}
              </div>
            </section>
          ))}

          <section className="mt-6 flex flex-col gap-2">
            <label
              htmlFor="product-note"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("noteLabel")}
            </label>
            <textarea
              id="product-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              rows={2}
              className="nb-border-sm w-full resize-none rounded-lg bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </section>

          {/* Desktop inline Add to Cart CTA */}
          <div className="nb-border nb-shadow-sm hidden md:flex items-center justify-between mt-8 p-4 bg-chip rounded-2xl">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("total")}</span>
              <span className="text-2xl font-extrabold text-price">{formatVND(price)}</span>
            </div>
            <motion.div whileTap={item.isAvailable ? TAP_SCALE : undefined} transition={TAP_TRANSITION}>
              <Button
                variant="neubrutal"
                onClick={handleAddToCart}
                disabled={!item.isAvailable}
                className="h-12 gap-2 px-8 text-base"
              >
                {tProduct("addToCart")}
              </Button>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Fixed bottom bar for Mobile */}
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="nb-border border-x-0 border-b-0 fixed inset-x-0 bottom-0 z-40 flex items-center justify-between bg-card px-6 py-4 md:hidden"
      >
        <span className="text-xl font-extrabold text-price">{formatVND(price)}</span>
        <motion.div whileTap={item.isAvailable ? TAP_SCALE : undefined} transition={TAP_TRANSITION}>
          <Button
            variant="neubrutal"
            onClick={handleAddToCart}
            disabled={!item.isAvailable}
            className="h-12 gap-2 px-8 text-base"
          >
            {tProduct("addToCart")}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  )
}
