"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, FormDialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Ingredient } from "@/hooks/useInventory"

export function StockAdjustForm({
  ingredient,
  locale,
  onAdd,
  onRemove,
  onMarkOutOfStock,
  onClose,
}: {
  ingredient: Ingredient
  locale: string
  onAdd: (amount: number) => Promise<void>
  onRemove: (amount: number) => Promise<void>
  onMarkOutOfStock: () => void | Promise<void>
  onClose: () => void
}) {
  const t = useTranslations("AdminInventory")
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isConfirmingOutOfStock, setIsConfirmingOutOfStock] = useState(false)
  const [isMarkingOutOfStock, setIsMarkingOutOfStock] = useState(false)
  const [isAdjusting, setIsAdjusting] = useState(false)

  const name = locale === "vi" ? ingredient.nameVi : ingredient.nameEn
  const parsedAmount = Number(amount)
  const isValidAmount = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0

  async function handleAdd() {
    if (!isValidAmount) {
      setError(t("amountRequiredError"))
      return
    }
    setError(null)
    setIsAdjusting(true)
    try {
      await onAdd(parsedAmount)
      onClose()
    } catch {
      // Never close on failure -- the amount stays in the input so the
      // manager can just retry instead of re-entering it.
      setError(t("adjustStockError"))
    } finally {
      setIsAdjusting(false)
    }
  }

  async function handleRemove() {
    if (!isValidAmount) {
      setError(t("amountRequiredError"))
      return
    }
    setError(null)
    setIsAdjusting(true)
    try {
      await onRemove(parsedAmount)
      onClose()
    } catch {
      setError(t("adjustStockError"))
    } finally {
      setIsAdjusting(false)
    }
  }

  return (
    <FormDialog
      onClose={onClose}
      title={t("adjustStockTitle")}
      isBusy={isMarkingOutOfStock || isAdjusting}
      footer={
        <Button variant="neubrutal" className="bg-card text-foreground" onClick={onClose} disabled={isAdjusting}>
          {t("close")}
        </Button>
      }
    >
      <div>
        <p className="font-bold text-card-foreground">{name}</p>
        <p className="text-sm text-muted-foreground">
          {t("currentStockLabel")}: {ingredient.stock} {ingredient.unit}
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="stock-amount" className="text-xs font-medium text-muted-foreground">
          {t("amountLabel")} ({ingredient.unit})
        </label>
        <Input
          id="stock-amount"
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => {
            setError(null)
            setAmount(e.target.value)
          }}
          placeholder="0"
          className="h-10"
          disabled={isAdjusting}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="neubrutal" onClick={handleAdd} className="h-10" disabled={isAdjusting || isMarkingOutOfStock}>
          {isAdjusting ? t("adjustingStock") : t("addStock")}
        </Button>
        <Button
          variant="neubrutal"
          onClick={handleRemove}
          className="h-10 bg-card text-foreground"
          disabled={isAdjusting || isMarkingOutOfStock}
        >
          {isAdjusting ? t("adjustingStock") : t("removeStock")}
        </Button>
      </div>

      <div className="nb-border border-x-0 border-b-0 pt-4">
        <Button
          onClick={() => setIsConfirmingOutOfStock(true)}
          variant="neubrutal"
          className="h-10 w-full gap-2 bg-card text-destructive"
          disabled={isAdjusting || isMarkingOutOfStock}
        >
          <TriangleAlert className="h-4 w-4" />
          {t("markOutOfStock")}
        </Button>
      </div>

      {/* Zeroing an ingredient's stock immediately makes every menu item that
          uses it unsellable, and there is no undo — hence the confirmation. */}
      <ConfirmDialog
        open={isConfirmingOutOfStock}
        onOpenChange={setIsConfirmingOutOfStock}
        destructive
        title={t("markOutOfStockConfirmTitle")}
        description={t("markOutOfStockConfirmBody", { name })}
        confirmLabel={t("markOutOfStock")}
        onConfirm={async () => {
          setIsMarkingOutOfStock(true)
          try {
            await onMarkOutOfStock()
            onClose()
          } finally {
            setIsMarkingOutOfStock(false)
          }
        }}
      />
    </FormDialog>
  )
}
