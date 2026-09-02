"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { UploadCloud, X, Plus, Pencil, ChevronUp, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormDialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { createModifierGroup, getModifierGroups, updateModifierGroup } from "@/lib/supabase/menu-data"
import type { MenuCategory, MenuIcon, MenuItem, MenuItemInput, MenuItemSizeInput, MenuModifierGroup } from "@/lib/supabase/menu-data"
import {
  getIngredients,
  getMenuItemIngredients,
  getModifierIngredients,
  setModifierIngredients,
  type Ingredient,
  type RecipeEntry,
} from "@/lib/supabase/inventory-data"
import { RecipeChecklist, type RecipeSelection } from "@/components/admin/recipe-checklist"
import { MenuItemReviewsPanel } from "@/components/admin/menu-item-reviews-panel"

const ICON_OPTIONS: MenuIcon[] = ["coffee", "cup-soda", "cookie", "milk"]

export function MenuItemForm({
  categories,
  initialItem,
  onCancel,
  onSave,
}: {
  categories: MenuCategory[]
  initialItem?: MenuItem
  onCancel: () => void
  onSave: (input: MenuItemInput, extraGroupIds: string[], recipeEntries: RecipeEntry[], sizes: MenuItemSizeInput[]) => void
}) {
  const t = useTranslations("AdminMenu")
  const locale = useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEditing = Boolean(initialItem)

  const [nameVi, setNameVi] = useState(initialItem?.nameVi ?? "")
  const [nameEn, setNameEn] = useState(initialItem?.nameEn ?? "")
  const [categoryId, setCategoryId] = useState(initialItem?.categoryId ?? categories[0]?.id ?? "")
  const [price, setPrice] = useState(initialItem ? String(initialItem.basePrice) : "")
  const [descriptionVi, setDescriptionVi] = useState(initialItem?.descriptionVi ?? "")
  const [descriptionEn, setDescriptionEn] = useState(initialItem?.descriptionEn ?? "")
  const [icon, setIcon] = useState<MenuIcon>(initialItem?.icon ?? "coffee")
  const [isAvailable, setIsAvailable] = useState(initialItem?.isAvailable ?? true)
  const [isPopular, setIsPopular] = useState(initialItem?.isPopular ?? false)
  const [hasSizeOptions, setHasSizeOptions] = useState(initialItem?.hasSizeOptions ?? true)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(initialItem?.imageUrl ?? null)
  // Tracks whether *this form* created the current preview URL via
  // createObjectURL — an inherited initialItem.imageUrl may still be
  // referenced by the table row / Menu grid / Product Detail Page, so we
  // must never revoke a URL we didn't create ourselves.
  const [ownsPreviewUrl, setOwnsPreviewUrl] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const [sizes, setSizes] = useState<{ name: string; price: string }[]>(
    initialItem?.sizes.map((s) => ({ name: s.name, price: String(s.priceDelta) })) ?? []
  )
  const [sizesError, setSizesError] = useState<string | null>(null)

  function addSize() {
    setSizes((prev) => [...prev, { name: "", price: "0" }])
  }

  function updateSizeName(index: number, name: string) {
    setSizes((prev) => prev.map((s, i) => (i === index ? { ...s, name } : s)))
  }

  function updateSizePrice(index: number, price: string) {
    setSizes((prev) => prev.map((s, i) => (i === index ? { ...s, price } : s)))
  }

  function removeSize(index: number) {
    setSizes((prev) => prev.filter((_, i) => i !== index))
  }

  function moveSize(index: number, direction: -1 | 1) {
    setSizes((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const supabase = createClient()
  const [extraGroups, setExtraGroups] = useState<MenuModifierGroup[]>([])
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>(
    initialItem?.modifierGroups.filter((g) => g.options.length === 1).map((g) => g.id) ?? []
  )
  const [showAddExtraForm, setShowAddExtraForm] = useState(false)
  const [newExtraNameVi, setNewExtraNameVi] = useState("")
  const [newExtraNameEn, setNewExtraNameEn] = useState("")
  const [newExtraPrice, setNewExtraPrice] = useState("")
  const [extrasError, setExtrasError] = useState<string | null>(null)

  const [editingExtraId, setEditingExtraId] = useState<string | null>(null)
  const [editExtraNameVi, setEditExtraNameVi] = useState("")
  const [editExtraNameEn, setEditExtraNameEn] = useState("")
  const [editExtraPrice, setEditExtraPrice] = useState("")
  const [editExtraRecipe, setEditExtraRecipe] = useState<RecipeSelection>({})
  const [editExtraError, setEditExtraError] = useState<string | null>(null)
  const [isSavingExtra, setIsSavingExtra] = useState(false)

  const [ingredientsList, setIngredientsList] = useState<Ingredient[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeSelection>({})
  const [recipeError, setRecipeError] = useState<string | null>(null)

  useEffect(() => {
    getModifierGroups(supabase).then((groups) => {
      setExtraGroups(groups.filter((g) => g.options.length === 1))
    })
    // Runs once on mount; supabase is a fresh client instance each render
    // but functionally equivalent, so depending on it would only cause
    // needless repeated fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getIngredients(supabase).then(setIngredientsList)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initialItem) return
    getMenuItemIngredients(supabase, initialItem.id).then((entries) => {
      const map: RecipeSelection = {}
      entries.forEach((e) => {
        map[e.ingredientId] = e.quantityUsed
      })
      setSelectedRecipe(map)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl && ownsPreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl, ownsPreviewUrl])

  function selectFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError(t("imageInvalidTypeError"))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t("imageTooLargeError"))
      return
    }
    setError(null)
    if (imagePreviewUrl && ownsPreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setOwnsPreviewUrl(true)
  }

  function removeImage() {
    if (imagePreviewUrl && ownsPreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(null)
    setImagePreviewUrl(null)
    setOwnsPreviewUrl(false)
  }

  async function handleAddExtra() {
    const parsedPrice = Number(newExtraPrice)
    if (!newExtraNameVi.trim() || !newExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setExtrasError(t("extraRequiredFieldsError"))
      return
    }
    setExtrasError(null)
    try {
      const created = await createModifierGroup(supabase, {
        nameVi: newExtraNameVi.trim(),
        nameEn: newExtraNameEn.trim(),
        priceDelta: parsedPrice,
      })
      setExtraGroups((prev) => [...prev, created])
      setSelectedExtraIds((prev) => [...prev, created.id])
      setNewExtraNameVi("")
      setNewExtraNameEn("")
      setNewExtraPrice("")
      setShowAddExtraForm(false)
    } catch {
      setExtrasError(t("extraSaveError"))
    }
  }

  async function openExtraEdit(group: MenuModifierGroup) {
    setEditingExtraId(group.id)
    setEditExtraNameVi(group.nameVi)
    setEditExtraNameEn(group.nameEn)
    setEditExtraPrice(String(group.options[0].priceDelta))
    setEditExtraError(null)
    const entries = await getModifierIngredients(supabase, group.options[0].id)
    const map: RecipeSelection = {}
    entries.forEach((entry) => {
      map[entry.ingredientId] = entry.quantityUsed
    })
    setEditExtraRecipe(map)
  }

  async function handleSaveExtraEdit(group: MenuModifierGroup) {
    const parsedPrice = Number(editExtraPrice)
    if (!editExtraNameVi.trim() || !editExtraNameEn.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setEditExtraError(t("extraRequiredFieldsError"))
      return
    }
    const recipeEntries = Object.entries(editExtraRecipe).map(([ingredientId, quantityUsed]) => ({
      ingredientId,
      quantityUsed,
    }))
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setEditExtraError(t("recipeQuantityRequiredError"))
      return
    }
    setEditExtraError(null)
    setIsSavingExtra(true)
    try {
      const updated = await updateModifierGroup(supabase, group.id, {
        nameVi: editExtraNameVi.trim(),
        nameEn: editExtraNameEn.trim(),
        priceDelta: parsedPrice,
      })
      await setModifierIngredients(supabase, updated.options[0].id, recipeEntries)
      setExtraGroups((prev) => prev.map((g) => (g.id === group.id ? updated : g)))
      setEditingExtraId(null)
    } catch {
      setEditExtraError(t("extraEditSaveError"))
    } finally {
      setIsSavingExtra(false)
    }
  }

  async function handleSave() {
    const parsedPrice = Number(price)
    if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError(t("requiredFieldsError"))
      return
    }

    const recipeEntries: RecipeEntry[] = Object.entries(selectedRecipe).map(([ingredientId, quantityUsed]) => ({
      ingredientId,
      quantityUsed,
    }))
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setRecipeError(t("recipeQuantityRequiredError"))
      return
    }
    setRecipeError(null)

    if (sizes.some((s) => !s.name.trim())) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    const parsedSizes: MenuItemSizeInput[] = sizes.map((s) => ({ name: s.name.trim(), priceDelta: Number(s.price) }))
    if (parsedSizes.some((s) => !Number.isFinite(s.priceDelta) || s.priceDelta < 0)) {
      setSizesError(t("sizeRequiredFieldsError"))
      return
    }
    setSizesError(null)

    // imagePreviewUrl is a blob: URL only when imageFile is also set (see
    // selectFile/removeImage above, which always set/clear both together) —
    // so a real upload is needed exactly when imageFile is present; any
    // inherited real URL (editing without changing the photo) or null
    // (removed) passes through untouched.
    let finalImageUrl: string | null = imagePreviewUrl
    if (imageFile) {
      setIsUploading(true)
      const path = `${crypto.randomUUID()}-${imageFile.name}`
      const { error: uploadError } = await supabase.storage.from("menu-item-images").upload(path, imageFile)
      if (uploadError) {
        setError(t("imageUploadError"))
        setIsUploading(false)
        return
      }
      finalImageUrl = supabase.storage.from("menu-item-images").getPublicUrl(path).data.publicUrl
      setIsUploading(false)
    }

    setError(null)
    onSave(
      {
        categoryId,
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim(),
        descriptionVi: descriptionVi.trim(),
        descriptionEn: descriptionEn.trim(),
        basePrice: parsedPrice,
        icon,
        isAvailable,
        isPopular,
        hasSizeOptions,
        imageUrl: finalImageUrl,
      },
      selectedExtraIds,
      recipeEntries,
      parsedSizes
    )
  }

  return (
    <FormDialog
      onClose={onCancel}
      size="xl"
      title={isEditing ? t("editItemTitle") : t("addItem")}
      isBusy={isUploading}
      footer={
        <>
          <Button variant="neubrutal" className="bg-card text-foreground" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="neubrutal" onClick={handleSave} disabled={isUploading}>
            {isUploading ? t("uploadingButton") : t("save")}
          </Button>
        </>
      }
    >
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("nameViLabel")}</label>
          <Input value={nameVi} onChange={(e) => setNameVi(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("nameEnLabel")}</label>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="h-10" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("categoryLabel")}</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="nb-border-sm h-10 w-full rounded-lg bg-card px-3 text-sm text-card-foreground focus:outline-none"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameVi} / {category.nameEn}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("priceLabel")}</label>
          <Input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("descriptionViLabel")}</label>
          <textarea
            value={descriptionVi}
            onChange={(e) => setDescriptionVi(e.target.value)}
            rows={3}
            className="nb-border-sm w-full resize-none rounded-lg bg-card px-3 py-2 text-sm text-card-foreground focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("descriptionEnLabel")}</label>
          <textarea
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
            rows={3}
            className="nb-border-sm w-full resize-none rounded-lg bg-card px-3 py-2 text-sm text-card-foreground focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("photoLabel")}</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
        />
        {imagePreviewUrl ? (
          <div className="nb-border-sm flex items-center gap-3 rounded-lg bg-card p-3">
            {ownsPreviewUrl ? (
              // Local blob: URL from a just-selected file — next/image
              // can't optimize object URLs without `unoptimized`, so
              // this branch stays a raw <img>.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePreviewUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
            ) : (
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg">
                <Image src={imagePreviewUrl} alt="" fill sizes="96px" className="object-cover" />
              </div>
            )}
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {imageFile?.name ?? t("currentPhoto")}
            </span>
            <button
              type="button"
              onClick={removeImage}
              aria-label={t("removeImage")}
              title={t("removeImage")}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDraggingOver(true)
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDraggingOver(false)
              selectFile(e.dataTransfer.files?.[0] ?? null)
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              isDraggingOver ? "border-primary bg-primary/5" : "border-input"
            )}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("dragDropText")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {t("browseButton")}
            </Button>
          </div>
        )}
      </div>

      <div className="nb-border-sm flex items-center justify-between rounded-lg bg-card p-3">
        <span className="text-sm font-medium text-card-foreground">{t("availableToggle")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={isAvailable}
          onClick={() => setIsAvailable((prev) => !prev)}
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
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("iconLabel")}</label>
        <div className="flex gap-2">
          {ICON_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setIcon(option)}
              aria-pressed={icon === option}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg border-2 transition-colors",
                icon === option ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground"
              )}
            >
              {option === "coffee" && <span className="text-lg">☕</span>}
              {option === "cup-soda" && <span className="text-lg">🥤</span>}
              {option === "cookie" && <span className="text-lg">🍪</span>}
              {option === "milk" && <span className="text-lg">🥛</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="nb-border-sm flex items-center justify-between rounded-lg bg-card p-3">
        <span className="text-sm font-medium text-card-foreground">{t("popularToggle")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={isPopular}
          onClick={() => setIsPopular((prev) => !prev)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            isPopular ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              isPopular ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      <div className="nb-border-sm flex items-center justify-between rounded-lg bg-card p-3">
        <span className="text-sm font-medium text-card-foreground">{t("hasSizeOptionsToggle")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={hasSizeOptions}
          onClick={() => setHasSizeOptions((prev) => !prev)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            hasSizeOptions ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              hasSizeOptions ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("sizesLabel")}</label>
        {sizesError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{sizesError}</p>
        )}
        <div className="nb-border-sm space-y-2 rounded-lg bg-card p-3">
          {sizes.length === 0 && <p className="text-sm text-muted-foreground">{t("noSizesYet")}</p>}
          {sizes.map((size, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={size.name}
                onChange={(e) => updateSizeName(index, e.target.value)}
                placeholder={t("sizeNamePlaceholder")}
                className="h-9 flex-1"
              />
              <Input
                type="number"
                min={0}
                value={size.price}
                onChange={(e) => updateSizePrice(index, e.target.value)}
                className="h-9 w-28"
              />
              <button
                type="button"
                onClick={() => moveSize(index, -1)}
                disabled={index === 0}
                aria-label={t("moveSizeUp")}
                title={t("moveSizeUp")}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveSize(index, 1)}
                disabled={index === sizes.length - 1}
                aria-label={t("moveSizeDown")}
                title={t("moveSizeDown")}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeSize(index)}
                aria-label={t("removeSize")}
                title={t("removeSize")}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addSize}>
          <Plus className="h-4 w-4" />
          {t("addSize")}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("extrasLabel")}</label>
        {extrasError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{extrasError}</p>
        )}
        <div className="nb-border-sm space-y-2 rounded-lg bg-card p-3">
          {extraGroups.length === 0 && !showAddExtraForm && (
            <p className="text-sm text-muted-foreground">{t("noExtrasYet")}</p>
          )}
          {extraGroups.map((group) => {
            const checked = selectedExtraIds.includes(group.id)
            const option = group.options[0]
            const isEditingThis = editingExtraId === group.id
            return (
              <div key={group.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedExtraIds((prev) =>
                          checked ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                        )
                      }
                      className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                    />
                    <span className="text-card-foreground">
                      {group.nameVi} / {group.nameEn}
                    </span>
                  </label>
                  <span className="font-medium text-primary">+{formatVND(option.priceDelta)}</span>
                  <button
                    type="button"
                    onClick={() => (isEditingThis ? setEditingExtraId(null) : openExtraEdit(group))}
                    aria-label={t("editExtra")}
                    title={t("editExtra")}
                    className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-secondary/10"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isEditingThis && (
                  <div className="nb-border-sm space-y-2 rounded-lg bg-chip p-3">
                    {editExtraError && (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {editExtraError}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input
                        value={editExtraNameVi}
                        onChange={(e) => setEditExtraNameVi(e.target.value)}
                        className="h-9"
                      />
                      <Input
                        value={editExtraNameEn}
                        onChange={(e) => setEditExtraNameEn(e.target.value)}
                        className="h-9"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={editExtraPrice}
                        onChange={(e) => setEditExtraPrice(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <RecipeChecklist
                      ingredients={ingredientsList}
                      selected={editExtraRecipe}
                      onChange={setEditExtraRecipe}
                      locale={locale}
                      emptyLabel={t("noIngredientsForRecipe")}
                      quantityPlaceholder={t("recipeQuantityPlaceholder")}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingExtraId(null)}>
                        {t("cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveExtraEdit(group)}
                        disabled={isSavingExtra}
                      >
                        {t("saveExtra")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {showAddExtraForm ? (
          <div className="nb-border-sm space-y-2 rounded-lg bg-chip p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                value={newExtraNameVi}
                onChange={(e) => setNewExtraNameVi(e.target.value)}
                placeholder={t("extraNameViPlaceholder")}
                className="h-9"
              />
              <Input
                value={newExtraNameEn}
                onChange={(e) => setNewExtraNameEn(e.target.value)}
                placeholder={t("extraNameEnPlaceholder")}
                className="h-9"
              />
              <Input
                type="number"
                min={0}
                value={newExtraPrice}
                onChange={(e) => setNewExtraPrice(e.target.value)}
                placeholder={t("extraPricePlaceholder")}
                className="h-9"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddExtraForm(false)}>
                {t("cancel")}
              </Button>
              <Button type="button" size="sm" onClick={handleAddExtra}>
                {t("confirmAddExtra")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAddExtraForm(true)}>
            <Plus className="h-4 w-4" />
            {t("addNewExtra")}
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("recipeLabel")}</label>
        {recipeError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{recipeError}</p>
        )}
        <RecipeChecklist
          ingredients={ingredientsList}
          selected={selectedRecipe}
          onChange={setSelectedRecipe}
          locale={locale}
          emptyLabel={t("noIngredientsForRecipe")}
          quantityPlaceholder={t("recipeQuantityPlaceholder")}
        />
      </div>

      {isEditing && initialItem && <MenuItemReviewsPanel itemId={initialItem.id} />}
    </FormDialog>
  )
}
