"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AlertCircle, Sparkles } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { useTables, type TableRecord } from "@/hooks/useTables"
import { useCart } from "@/hooks/useCart"
import { TableOrderingSession } from "@/components/customer/table-ordering-session"
import {
  clearStoredTableCartTransfer,
  loadTableCartTransfer,
  type TableCartTransferItem,
} from "@/lib/table-cart-transfer"
import { createClient } from "@/lib/supabase/client"
import { importTableCart } from "@/lib/supabase/table-session-data"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import { AsyncRetryError, AsyncSkeleton } from "@/components/shared/async-state"

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const transferId = searchParams.get("cartTransfer")
  const [supabase] = useState(() => createClient())
  const { setActiveTableByToken, notifyCleaning } = useTables()
  const { consumeTransfer } = useCart()
  const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
  const [resolveError, setResolveError] = useState(false)
  const [resolveRetryNonce, setResolveRetryNonce] = useState(0)
  const [notified, setNotified] = useState(false)
  const [transferSnapshot] = useState<TableCartTransferItem[] | null>(() => {
    if (!transferId || typeof window === "undefined") return null
    return loadTableCartTransfer(window.sessionStorage, transferId)
  })
  const [transferStatus, setTransferStatus] = useState<"idle" | "importing" | "failed" | "completed">(
    transferId ? (transferSnapshot ? "importing" : "failed") : "idle"
  )
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setResolveError(false)
    setActiveTableByToken(qrToken)
      .then((table) => {
        if (!cancelled) setResolvedTable(table)
      })
      .catch(() => {
        // getTableByToken throws on any RPC/network error (a genuinely
        // invalid/unknown token instead resolves to `null`) -- without
        // this catch `resolvedTable` stayed `undefined` forever, a
        // permanent blank screen on the very page a scanned QR code
        // lands a guest on.
        if (!cancelled) setResolveError(true)
      })
    return () => {
      cancelled = true
    }
    // Runs once per token (and once more on Retry); setActiveTableByToken is
    // stable within a TablesProvider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken, resolveRetryNonce])

  function handleRetryResolve() {
    setResolvedTable(undefined)
    setResolveRetryNonce((n) => n + 1)
  }

  useEffect(() => {
    if (!transferId || !resolvedTable || resolvedTable.status === "cleaning") return
    if (!transferSnapshot) return
    const activeTransferId = transferId
    const activeTransferSnapshot = transferSnapshot
    let cancelled = false

    async function transferCart() {
      try {
        await importTableCart(supabase, qrToken, activeTransferId, activeTransferSnapshot)
      } catch {
        if (!cancelled) setTransferStatus("failed")
        return
      }
      if (cancelled) return

      // From here the database transaction has committed. Never turn local
      // cleanup/navigation errors into a retryable import, which could consume
      // the same local quantities twice.
      setTransferStatus("completed")
      consumeTransfer(activeTransferSnapshot)
      clearStoredTableCartTransfer(window.sessionStorage, activeTransferId)
      router.replace(`/table/${encodeURIComponent(qrToken)}?view=order`)
    }

    void transferCart()
    return () => {
      cancelled = true
    }
    // Run once per scanned transfer (and once more only when Retry is tapped).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId, resolvedTable, retryNonce, qrToken, supabase])

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

  if (transferStatus === "importing") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-6 text-center">
        <p className="font-bold text-card-foreground">{t("transferringCart")}</p>
      </div>
    )
  }

  if (transferStatus === "failed") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("transferFailedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("transferFailedMessage")}</p>
        {transferSnapshot && (
          <Button
            variant="neubrutal"
            className="h-11 w-full"
            onClick={() => {
              setTransferStatus("importing")
              setRetryNonce((value) => value + 1)
            }}
          >
            {t("retryTransfer")}
          </Button>
        )}
        <Button variant="ghost" className="h-11 w-full" render={<Link href="/checkout" />} nativeButton={false}>
          {t("backToCheckout")}
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
      initialTab={transferStatus === "completed" || searchParams.get("view") === "order" ? "order" : "menu"}
    />
  )
}
