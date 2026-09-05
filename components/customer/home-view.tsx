"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronRight, QrCode, ShoppingBasket } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { formatNumber, formatOrderId, formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { getProfile } from "@/lib/supabase/profile-data"
import { getLoyaltyBalance, getLoyaltyTierProgress, type LoyaltyTierProgress } from "@/lib/supabase/loyalty-data"
import { nextAsyncLoadFlags } from "@/lib/async-refetch-flags"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import { useCart, type AddToCartInput } from "@/hooks/useCart"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"
import { ItemImage } from "@/components/customer/item-image"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import { ProgressRing } from "@/components/motion/progress-ring"
import { AsyncSkeleton, AsyncRetryError, StaleNotice } from "@/components/shared/async-state"
import type { MenuItem } from "@/lib/supabase/menu-data"

const ACTIVE_STATUSES: OrderStatus[] = ["pending_payment", "paid", "preparing", "ready", "served"]

const STATUS_KEYS: Record<OrderStatus, string> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}

export function HomeView({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Home")
  const tOrders = useTranslations("OrderHistory")
  const tLoyalty = useTranslations("Loyalty")
  const locale = useLocale()
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const { addItem } = useCart()
  const { myOrders, isLoadingMyOrders, myOrdersError, retryMyOrders } = useOrders()

  const [name, setName] = useState("")
  const [balance, setBalance] = useState(0)
  const [tier, setTier] = useState<LoyaltyTierProgress | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadError, setHasLoadError] = useState(false)
  const [hasStaleData, setHasStaleData] = useState(false)
  const hasLoadedOnceRef = useRef(false)

  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [reorderedId, setReorderedId] = useState<string | null>(null)

  async function load({ isStale }: LoadContext) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const [profileResult, balanceResult, tierResult] = user
        ? await Promise.all([getProfile(supabase, user.id), getLoyaltyBalance(supabase, user.id), getLoyaltyTierProgress(supabase)])
        : [{ fullName: "", phone: "" }, 0, null]
      if (isStale()) return
      setName(profileResult.fullName)
      setBalance(balanceResult)
      setTier(tierResult)
      hasLoadedOnceRef.current = true
      setHasLoadError(false)
      setHasStaleData(false)
    } catch (error) {
      if (isStale()) return
      const flags = nextAsyncLoadFlags(hasLoadedOnceRef.current, "failure")
      setHasLoadError(flags.hasBlockingError)
      setHasStaleData(flags.hasStaleData)
      throw error
    }
  }

  const { run } = useLatestRefetch(load, 300)

  useEffect(() => {
    void run().finally(() => setIsLoading(false))
    // Mount-only load, matching every other customer view's async-state pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTableScan(token: string) {
    try {
      router.push(`/table/${encodeURIComponent(token)}`)
    } catch {
      setScanError(t("scanError"))
    }
  }

  function handleReorder(order: OrderForTracking) {
    order.items.forEach((item) => {
      addItem(
        {
          menuItemId: item.menuItemId,
          nameVi: item.nameVi,
          nameEn: item.nameEn,
          modifiers: (item.modifierIds ?? []).map((id) => ({
            groupId: "historic",
            optionId: id,
            labelVi: tOrders("historicOption"),
            labelEn: tOrders("historicOption"),
            priceDelta: 0,
          })),
          unitPrice: item.unitPrice,
          ...(item.sizeId ? { size: { id: item.sizeId, label: tOrders("historicOption"), priceDelta: 0 } } : {}),
          ...(item.sizeId || (item.modifierIds?.length ?? 0) > 0 ? { needsConfiguration: true } : {}),
        } satisfies AddToCartInput,
        item.quantity
      )
    })
    setReorderedId(order.id)
  }

  const popularItems = items.filter((item) => item.isPopular && item.isAvailable).slice(0, 8)
  const sortedOrders = [...myOrders].sort((a, b) => b.createdAt - a.createdAt)
  const recentOrders = sortedOrders.filter((order) => order.status === "completed").slice(0, 2)
  const activeOrder = sortedOrders.find((order) => ACTIVE_STATUSES.includes(order.status))

  if (isLoading) return <AsyncSkeleton variant="page" />

  if (hasLoadError) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-6">
        <AsyncRetryError onRetry={() => void run()} message={t("loadError")} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 md:max-w-5xl md:px-8 md:py-4">
      {hasStaleData && <StaleNotice onRetry={() => void run()} className="mb-3" />}

      <section className="mb-6">
        <p className="text-xs font-semibold text-muted-foreground">{t("greeting")}</p>
        {name && <h2 className="mt-0.5 text-xl font-bold text-card-foreground">{name}</h2>}
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          className="nb-border nb-shadow nb-press flex flex-col items-start gap-2 rounded-xl bg-secondary p-4 text-left text-secondary-foreground"
        >
          <QrCode className="h-5 w-5" />
          <span className="text-sm font-extrabold leading-tight">{t("dineInTitle")}</span>
          <span className="text-xs opacity-85">{t("dineInSub")}</span>
        </button>
        <Link
          href="/menu"
          className="nb-border nb-shadow nb-press flex flex-col items-start gap-2 rounded-xl bg-card p-4 text-card-foreground"
        >
          <ShoppingBasket className="h-5 w-5 text-secondary" />
          <span className="text-sm font-extrabold leading-tight">{t("pickupTitle")}</span>
          <span className="text-xs text-muted-foreground">{t("pickupSub")}</span>
        </Link>
      </section>

      {scanError && <p className="mb-4 text-sm text-destructive">{scanError}</p>}

      {activeOrder && (
        <Link
          href={`/orders/${activeOrder.id}`}
          className="nb-border nb-shadow nb-press mb-6 flex items-center gap-3 rounded-xl bg-primary p-4 text-primary-foreground"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">
              #{formatOrderId(activeOrder.id)} · {tOrders(STATUS_KEYS[activeOrder.status])}
            </p>
            <p className="mt-0.5 text-xs opacity-85">{t("trackHint")}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-85" />
        </Link>
      )}

      {popularItems.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-sm font-extrabold text-card-foreground">{t("bestsellersTitle")}</p>
            <Link href="/menu" className="text-xs font-extrabold text-muted-foreground">
              {t("viewAll")}
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {popularItems.map((item) => (
              <Link
                key={item.id}
                href={`/menu/${item.id}`}
                className="nb-border nb-shadow nb-press flex w-40 shrink-0 flex-col gap-2 rounded-xl bg-card p-3"
              >
                <ItemImage item={item} className="h-24 w-full rounded-lg" />
                <p className="truncate text-sm font-extrabold text-card-foreground">
                  {locale === "vi" ? item.nameVi : item.nameEn}
                </p>
                <p className="text-sm font-extrabold text-price">{formatVND(item.basePrice)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {isLoadingMyOrders ? null : myOrdersError ? (
        <AsyncRetryError onRetry={retryMyOrders} message={tOrders("loadError")} className="mb-6" />
      ) : (
        recentOrders.length > 0 && (
          <section className="mb-6">
            <p className="mb-2 text-sm font-extrabold text-card-foreground">{t("quickReorderTitle")}</p>
            <div className="flex flex-col gap-2">
              {recentOrders.map((order) => {
                const itemsLabel = order.items.map((item) => (locale === "vi" ? item.nameVi : item.nameEn)).join(", ")
                return (
                  <div key={order.id} className="nb-border nb-shadow-sm flex items-center gap-3 rounded-xl bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-card-foreground">{itemsLabel}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        #{formatOrderId(order.id)} · {formatVND(order.total)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReorder(order)}
                      className="nb-border-sm nb-shadow-sm nb-press-sm shrink-0 rounded-lg bg-chip px-3 py-2 text-xs font-extrabold text-foreground"
                    >
                      {reorderedId === order.id ? tOrders("reorderAdded") : tOrders("reorder")}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )
      )}

      <Link
        href="/loyalty"
        className="nb-border nb-shadow nb-press flex items-center gap-4 rounded-xl bg-secondary p-4 text-secondary-foreground"
      >
        <ProgressRing percent={tier?.progressPercent ?? 0} size={56} strokeWidth={6}>
          <span className="text-xs font-extrabold">{formatNumber(balance)}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">{t("loyaltyCardTitle")}</p>
          <p className="mt-0.5 text-xs opacity-85">
            {(() => {
              const nextTierName = tier && (locale === "vi" ? tier.nextTierNameVi : tier.nextTierNameEn)
              return nextTierName && tier?.pointsToNext != null
                ? tLoyalty("tierProgress", { points: tier.pointsToNext, tier: nextTierName })
                : tLoyalty("tierMaxReached")
            })()}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-85" />
      </Link>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} onScan={handleTableScan} />}
    </div>
  )
}
