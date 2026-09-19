"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AlertCircle } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { useTables, type TableRecord } from "@/hooks/useTables"
import { TableOrderingSession } from "@/components/customer/table-ordering-session"
import { saveActiveTable } from "@/lib/active-table-storage"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import { AsyncRetryError, AsyncSkeleton } from "@/components/shared/async-state"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

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
  const searchParams = useSearchParams()
  const { setActiveTableByToken } = useTables()
  const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
  const [resolveError, setResolveError] = useState(false)

  const resolveTable = useCallback(async ({ isStale }: LoadContext) => {
    try {
      const table = await setActiveTableByToken(qrToken)
      if (isStale()) return
      setResolvedTable(table)
      setResolveError(false)
    } catch {
      if (!isStale()) setResolveError(true)
    }
  }, [qrToken, setActiveTableByToken])
  const { run: runTableResolve } = useLatestRefetch(resolveTable, 0)

  useEffect(() => {
    void runTableResolve()
  }, [qrToken, runTableResolve])

  useEffect(() => {
    if (resolvedTable) saveActiveTable(qrToken)
  }, [resolvedTable, qrToken])

  function handleRetryResolve() {
    setResolvedTable(undefined)
    setResolveError(false)
    void runTableResolve()
  }

  if (resolveError) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-6">
        <AsyncRetryError onRetry={handleRetryResolve} />
      </div>
    )
  }

  if (resolvedTable === undefined) {
    return <AsyncSkeleton variant="page" />
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

  return (
    <TableOrderingSession
      table={resolvedTable}
      qrToken={qrToken}
      categories={categories}
      items={items}
      initialTab={searchParams.get("view") === "order" ? "order" : "menu"}
    />
  )
}
