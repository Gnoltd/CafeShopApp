"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Sparkles } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { useTables, type TableRecord } from "@/hooks/useTables"
import { TableOrderingSession } from "@/components/customer/table-ordering-session"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

export function TableLanding({
  qrToken,
  categories,
  items,
}: {
  qrToken: string
  categories: MenuCategory[]
  items: MenuItem[]
}) {
  const t = useTranslations("TableLanding")
  const { setActiveTableByToken, notifyCleaning } = useTables()
  const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
  const [notified, setNotified] = useState(false)

  useEffect(() => {
    let cancelled = false
    setActiveTableByToken(qrToken).then((table) => {
      if (!cancelled) setResolvedTable(table)
    })
    return () => {
      cancelled = true
    }
    // Runs once per token; setActiveTableByToken is stable within a TablesProvider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken])

  if (resolvedTable === undefined) {
    return null
  }

  if (!resolvedTable) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("invalidTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("invalidMessage")}</p>
        <Button className="h-11 w-full rounded-xl" render={<Link href="/menu" />} nativeButton={false}>
          {t("backToMenu")}
        </Button>
      </div>
    )
  }

  if (resolvedTable.status === "cleaning") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
          <Sparkles className="h-10 w-10 text-amber-700" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("cleaningTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("cleaningMessage")}</p>
        <Button
          className="h-11 w-full rounded-xl"
          disabled={notified}
          onClick={() => notifyCleaning(resolvedTable.id).then(() => setNotified(true))}
        >
          {notified ? t("staffNotified") : t("notifyStaff")}
        </Button>
      </div>
    )
  }

  return <TableOrderingSession table={resolvedTable} qrToken={qrToken} categories={categories} items={items} />
}
