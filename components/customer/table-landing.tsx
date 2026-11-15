"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AlertCircle } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { TableOrderingSession } from "@/components/customer/table-ordering-session"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import type { TableSessionPort } from "@/lib/supabase/table-session-data"
import { createClient } from "@/lib/supabase/client"
import { createGuestTableLookupAdapter } from "@/lib/supabase/tables-data"
import { resolveGuestTable, type GuestResolvedTable, type GuestTableLookupPort } from "@/lib/guest-active-table"
import { AsyncRetryError, AsyncSkeleton } from "@/components/shared/async-state"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

export function TableLanding({
  qrToken,
  categories,
  items,
  lookupPort: injectedLookupPort,
  sessionPort,
}: {
  qrToken: string
  categories: MenuCategory[]
  items: MenuItem[]
  lookupPort?: GuestTableLookupPort
  sessionPort?: TableSessionPort
}) {
  const t = useTranslations("TableLanding")
  const searchParams = useSearchParams()
  const [defaultLookupPort] = useState<GuestTableLookupPort>(
    () => injectedLookupPort ?? createGuestTableLookupAdapter(createClient())
  )
  const lookupPort = injectedLookupPort ?? defaultLookupPort
  const [resolvedTable, setResolvedTable] = useState<GuestResolvedTable | null | undefined>(undefined)
  const [resolveError, setResolveError] = useState(false)

  const resolveTable = useCallback(async ({ isStale }: LoadContext) => {
    try {
      const resolved = await resolveGuestTable(lookupPort, qrToken)
      if (isStale()) return
      setResolvedTable(resolved?.table ?? null)
      setResolveError(false)
    } catch {
      if (!isStale()) setResolveError(true)
    }
  }, [lookupPort, qrToken])
  const { run: runTableResolve } = useLatestRefetch(resolveTable, 0)

  useEffect(() => {
    void runTableResolve()
  }, [qrToken, runTableResolve])

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
      qrToken={qrToken}
      categories={categories}
      items={items}
      initialTab={searchParams.get("view") === "order" ? "order" : "menu"}
      port={sessionPort}
    />
  )
}
