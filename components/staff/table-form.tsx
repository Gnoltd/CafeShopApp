"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { FormDialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { TableInput } from "@/hooks/useTables"

export function TableForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (input: TableInput) => Promise<void>
}) {
  const t = useTranslations("AdminTables")
  const [number, setNumber] = useState("")
  const [locationVi, setLocationVi] = useState("")
  const [locationEn, setLocationEn] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    if (!number.trim()) {
      setError(t("tableNumberRequiredError"))
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await onSave({ number: number.trim(), locationVi: locationVi.trim(), locationEn: locationEn.trim() })
    } catch {
      setError(t("tableNumberTakenError"))
      setIsSaving(false)
    }
  }

  return (
    <FormDialog
      onClose={onCancel}
      title={t("addTable")}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="neubrutal" className="bg-card text-foreground" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="neubrutal" onClick={handleSave} disabled={isSaving}>
            {t("save")}
          </Button>
        </>
      }
    >
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("tableNumberLabel")}</label>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} className="h-10" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("locationViLabel")}</label>
        <Input value={locationVi} onChange={(e) => setLocationVi(e.target.value)} className="h-10" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("locationEnLabel")}</label>
        <Input value={locationEn} onChange={(e) => setLocationEn(e.target.value)} className="h-10" />
      </div>
    </FormDialog>
  )
}
