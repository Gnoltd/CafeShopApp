"use client"

import { useTranslations } from "next-intl"
import { ScanQrButton } from "@/components/customer/scan-qr-button"

export function MenuOrderingNotice() {
  const t = useTranslations("Menu")
  return (
    <section className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">{t("browseTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("browseHelp")}</p>
      </div>
      <div className="shrink-0"><ScanQrButton /></div>
    </section>
  )
}
