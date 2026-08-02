"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, Ticket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import {
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  type Promotion,
  type PromotionInput,
  type DiscountType,
} from "@/lib/supabase/promotions-data"

type FormMode = { type: "add" } | { type: "edit"; promotion: Promotion } | null

function toDatetimeLocalValue(epochMs: number | null): string {
  if (!epochMs) return ""
  const d = new Date(epochMs)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function PromotionForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: Promotion
  onCancel: () => void
  onSave: (input: PromotionInput) => void
}) {
  const t = useTranslations("AdminPromotions")
  const [code, setCode] = useState(initial?.code ?? "")
  const [discountType, setDiscountType] = useState<DiscountType>(initial?.discountType ?? "percent")
  const [discountValue, setDiscountValue] = useState(initial ? String(initial.discountValue) : "")
  const [active, setActive] = useState(initial?.active ?? true)
  const [startsAt, setStartsAt] = useState(toDatetimeLocalValue(initial?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(toDatetimeLocalValue(initial?.endsAt ?? null))
  const [maxRedemptions, setMaxRedemptions] = useState(initial?.maxRedemptions ? String(initial.maxRedemptions) : "")
  const [minSubtotal, setMinSubtotal] = useState(initial?.minSubtotalVnd ? String(initial.minSubtotalVnd) : "")
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    const parsedValue = Number(discountValue)
    if (!code.trim() || !Number.isFinite(parsedValue) || parsedValue <= 0) {
      setError(t("requiredFieldsError"))
      return
    }
    setError(null)
    onSave({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: parsedValue,
      active,
      startsAt: startsAt ? new Date(startsAt).getTime() : null,
      endsAt: endsAt ? new Date(endsAt).getTime() : null,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
      minSubtotalVnd: minSubtotal ? Number(minSubtotal) : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="nb-border nb-shadow flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl bg-card p-6">
        <h2 className="mb-4 text-lg font-bold text-card-foreground">
          {initial ? t("edit") : t("addPromotion")}
        </h2>
        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("codeLabel")}</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-10 uppercase" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("discountTypeLabel")}</label>
            <div className="flex gap-2">
              {(["percent", "fixed"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDiscountType(type)}
                  className={cn(
                    "nb-border-sm flex-1 rounded-lg px-3 py-2 text-sm font-bold",
                    discountType === type ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
                  )}
                >
                  {type === "percent" ? t("discountTypePercent") : t("discountTypeFixed")}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("discountValueLabel")} ({discountType === "percent" ? t("discountValuePercentSuffix") : t("discountValueFixedSuffix")})
            </label>
            <Input type="number" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="h-10" />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
            <span className="text-sm font-medium text-card-foreground">{t("activeToggle")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => setActive((prev) => !prev)}
              className={cn("relative h-6 w-11 rounded-full transition-colors", active ? "bg-primary" : "bg-muted-foreground/30")}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  active ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("startsAtLabel")}</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="nb-border-sm h-10 w-full rounded-lg bg-card px-3 text-sm text-card-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("endsAtLabel")}</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="nb-border-sm h-10 w-full rounded-lg bg-card px-3 text-sm text-card-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("maxRedemptionsLabel")}</label>
            <Input type="number" min={0} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("minSubtotalLabel")}</label>
            <Input type="number" min={0} value={minSubtotal} onChange={(e) => setMinSubtotal(e.target.value)} className="h-10" />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="neubrutal" className="bg-card text-foreground" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="neubrutal" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PromotionsManagement() {
  const t = useTranslations("AdminPromotions")
  const [supabase] = useState(() => createClient())
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)

  useEffect(() => {
    getPromotions(supabase)
      .then(setPromotions)
      .catch(() => setError(t("loadError")))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave(input: PromotionInput) {
    setError(null)
    try {
      if (formMode?.type === "edit") {
        const updated = await updatePromotion(supabase, formMode.promotion.id, input)
        setPromotions((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      } else {
        const created = await createPromotion(supabase, input)
        setPromotions((prev) => [created, ...prev])
      }
      setFormMode(null)
    } catch {
      setError(t("saveError"))
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return
    setError(null)
    try {
      await deletePromotion(supabase, id)
      setPromotions((prev) => prev.filter((p) => p.id !== id))
    } catch {
      setError(t("saveError"))
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="neubrutal" className="h-10 gap-2" onClick={() => setFormMode({ type: "add" })}>
          <Plus className="h-4 w-4" />
          {t("addPromotion")}
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {formMode && (
        <PromotionForm
          initial={formMode.type === "edit" ? formMode.promotion : undefined}
          onCancel={() => setFormMode(null)}
          onSave={handleSave}
        />
      )}

      {isLoading ? (
        <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
      ) : promotions.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t("emptyState")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {promotions.map((promo) => (
            <div key={promo.id} className="nb-border-sm nb-shadow-sm flex items-center justify-between gap-3 rounded-xl bg-card p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-chip text-muted-foreground">
                  <Ticket className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-bold text-card-foreground">{promo.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {promo.discountType === "percent" ? `${promo.discountValue}%` : formatVND(promo.discountValue)}
                    {" · "}
                    {t("timesUsedLabel")}: {promo.timesUsed}
                    {promo.maxRedemptions ? `/${promo.maxRedemptions}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-extrabold",
                    promo.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {t("activeToggle")}: {promo.active ? "✓" : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => setFormMode({ type: "edit", promotion: promo })}
                  aria-label={t("edit")}
                  title={t("edit")}
                  className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(promo.id)}
                  aria-label={t("delete")}
                  title={t("delete")}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
