"use client"

import { useLocale, useTranslations } from "next-intl"
import { X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { BottomSheet } from "@/components/motion/bottom-sheet"
import { DialogClose, DialogTitle } from "@/components/ui/dialog"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PressFeedback } from "@/components/motion/press-feedback"
import { useSizeModifierSelection } from "@/hooks/useSizeModifierSelection"
import type { CartModifier } from "@/hooks/useCart"
import type { MenuItem } from "@/lib/supabase/menu-data"

export type SizeModifierSelection = {
  size: { id: string; name: string; priceDelta: number } | null
  cartModifiers: CartModifier[]
  modifierIds: string[]
  modifierNames: string[]
  unitPrice: number
}

/**
 * Shared BottomSheet body for QuickAddPopup and PosItemPicker — the two
 * near-identical size/extras pickers that previously hand-rolled the same
 * JSX. onAdd receives both the bilingual CartModifier[] shape (for
 * useCart) and the flat modifierIds/modifierNames shape (for POS's
 * OrderLine merge key) already derived, so each adapter just picks what
 * it needs. Product Detail's full-page layout is a different enough skin
 * that it stays its own JSX, consuming only useSizeModifierSelection.
 */
export function SizeExtrasSheet({
  item,
  onAdd,
  onClose,
}: {
  item: MenuItem
  onAdd: (selection: SizeModifierSelection) => void
  onClose: () => void
}) {
  const locale = useLocale()
  const t = useTranslations("Menu")
  const {
    selectedSizeId,
    setSelectedSizeId,
    selectedModifiers,
    selectedOptions,
    toggleModifier,
    selectedSize,
    price,
    extraGroups,
    otherGroups,
  } = useSizeModifierSelection(item)

  function handleAdd() {
    const cartModifiers: CartModifier[] = selectedOptions.map(({ group, option }) => ({
      groupId: group.id,
      optionId: option.id,
      labelVi: option.nameVi,
      labelEn: option.nameEn,
      priceDelta: option.priceDelta,
    }))
    onAdd({
      size: selectedSize ? { id: selectedSize.id, name: selectedSize.name, priceDelta: selectedSize.priceDelta } : null,
      cartModifiers,
      modifierIds: selectedOptions.map(({ option }) => option.id),
      modifierNames: selectedOptions.map(({ option }) => (locale === "vi" ? option.nameVi : option.nameEn)),
      unitPrice: price,
    })
    onClose()
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <DialogTitle className="text-base font-bold text-card-foreground">
          {locale === "vi" ? item.nameVi : item.nameEn}
        </DialogTitle>
        <DialogClose
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label={t("close")}
        >
          <X className="h-5 w-5" />
        </DialogClose>
      </div>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        {item.hasSizeOptions && item.sizes.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("size")}</span>
            <SegmentedControl
              variant="tabs"
              layoutId="size-extras-sheet-size-pill"
              value={selectedSizeId ?? ""}
              onChange={setSelectedSizeId}
              options={item.sizes.map((size) => ({
                value: size.id,
                label: size.priceDelta > 0 ? `${size.name} +${formatVND(size.priceDelta)}` : size.name,
              }))}
            />
          </div>
        )}

        {extraGroups.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("extrasLabel")}
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
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Check className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-transparent")} />
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    </div>
                    <span className={selected ? "text-primary" : "text-muted-foreground"}>
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : t("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        )}

        {otherGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
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
                      "flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : t("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t px-5 py-4">
        <span className="text-lg font-bold text-primary">{formatVND(price)}</span>
        <Button onClick={handleAdd} className="h-11 rounded-xl px-6 font-bold">
          {t("add")}
        </Button>
      </div>
    </BottomSheet>
  )
}
