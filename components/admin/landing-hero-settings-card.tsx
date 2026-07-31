"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { ImageIcon, Check, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  getLandingHeroSettings,
  updateLandingHeroSettings,
  type LandingHeroSettings,
} from "@/lib/supabase/settings-data"

const MAX_SIZE_BYTES = 8 * 1024 * 1024

type SlotKey = "base0" | "base1" | "base2" | "reveal"
const SLOTS: { key: SlotKey; labelKey: string }[] = [
  { key: "base0", labelKey: "landingHeroBasePhoto1" },
  { key: "base1", labelKey: "landingHeroBasePhoto2" },
  { key: "base2", labelKey: "landingHeroBasePhoto3" },
  { key: "reveal", labelKey: "landingHeroRevealPhoto" },
]

export function LandingHeroSettingsCard() {
  const t = useTranslations("AdminSettings")
  const [supabase] = useState(() => createClient())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const [currentUrls, setCurrentUrls] = useState<Record<SlotKey, string | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })
  const [pendingFiles, setPendingFiles] = useState<Record<SlotKey, File | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })
  const [previewUrls, setPreviewUrls] = useState<Record<SlotKey, string | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })

  useEffect(() => {
    getLandingHeroSettings(supabase)
      .then((settings) => {
        setCurrentUrls({
          base0: settings.baseImages[0] ?? null,
          base1: settings.baseImages[1] ?? null,
          base2: settings.baseImages[2] ?? null,
          reveal: settings.revealImage,
        })
      })
      .catch(() => setError(t("landingHeroSaveError")))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectFile(slot: SlotKey, file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError(t("landingHeroImageInvalidTypeError"))
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t("landingHeroImageTooLargeError"))
      return
    }
    setError(null)
    setPendingFiles((prev) => ({ ...prev, [slot]: file }))
    setPreviewUrls((prev) => ({ ...prev, [slot]: URL.createObjectURL(file) }))
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      const finalUrls = { ...currentUrls }
      for (const slot of SLOTS.map((s) => s.key)) {
        const file = pendingFiles[slot]
        if (!file) continue
        const path = `${crypto.randomUUID()}-${file.name}`
        const { error: uploadError } = await supabase.storage.from("landing-hero-images").upload(path, file)
        if (uploadError) throw uploadError
        finalUrls[slot] = supabase.storage.from("landing-hero-images").getPublicUrl(path).data.publicUrl
      }

      const input: LandingHeroSettings = {
        baseImages: [finalUrls.base0, finalUrls.base1, finalUrls.base2].filter((u): u is string => !!u),
        revealImage: finalUrls.reveal,
      }
      await updateLandingHeroSettings(supabase, input)

      setCurrentUrls(finalUrls)
      setPendingFiles({ base0: null, base1: null, base2: null, reveal: null })
      setPreviewUrls({ base0: null, base1: null, base2: null, reveal: null })
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch {
      setError(t("landingHeroSaveError"))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ImageIcon className="h-5 w-5 text-primary" />
          {t("landingHeroTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SLOTS.map(({ key, labelKey }) => {
            const pendingPreview = previewUrls[key]
            const uploadedUrl = currentUrls[key]
            return (
              <div key={key} className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">{t(labelKey)}</label>
                <label className="nb-border-sm relative block aspect-video cursor-pointer overflow-hidden rounded-lg bg-card">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => selectFile(key, e.target.files?.[0] ?? null)}
                  />
                  {pendingPreview ? (
                    // Local blob: URL from a just-selected file — next/image
                    // can't optimize object URLs, so this branch stays a raw
                    // <img> (only the already-uploaded branch below migrates).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pendingPreview} alt="" className="h-full w-full object-cover" />
                  ) : uploadedUrl ? (
                    <Image src={uploadedUrl} alt="" fill sizes="(max-width: 640px) 45vw, 200px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                      <span className="text-xs">{t("landingHeroUploadPrompt")}</span>
                    </div>
                  )}
                </label>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button variant="neubrutal" onClick={handleSave} disabled={isSaving} className="h-11 px-6">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("landingHeroSaveButton")}
          </Button>
          {justSaved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
              <Check className="h-4 w-4" />
              {t("landingHeroSavedMessage")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
