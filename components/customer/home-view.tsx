"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronRight, Coffee, Gift, QrCode, ShoppingBasket, MapPin, Clock } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { formatNumber, formatOrderId, formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { getProfile } from "@/lib/supabase/profile-data"
import { getLoyaltyBalance, getLoyaltyTierProgress, type LoyaltyTierProgress } from "@/lib/supabase/loyalty-data"
import { getTableSession } from "@/lib/supabase/table-session-data"
import { getActiveTable, clearActiveTable } from "@/lib/active-table-storage"
import { nextAsyncLoadFlags } from "@/lib/async-refetch-flags"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"
import { useCart, type AddToCartInput } from "@/hooks/useCart"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import { QuickAddPopup } from "@/components/customer/quick-add-popup"
import { BestSellersArc } from "@/components/customer/best-sellers-arc"
import { ProgressRing } from "@/components/motion/progress-ring"
import { AsyncSkeleton, AsyncRetryError, StaleNotice } from "@/components/shared/async-state"
import type { MenuItem } from "@/lib/supabase/menu-data"
import type { ShopSettings } from "@/lib/supabase/settings-data"

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

type Daypart = "morning" | "afternoon" | "evening"

function resolveDaypart(hour: number): Daypart {
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

type TableResume = { qrToken: string; roundCount: number }

export function HomeView({ items, shopSettings }: { items: MenuItem[]; shopSettings: ShopSettings }) {
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

  const [daypart, setDaypart] = useState<Daypart>("morning")
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [reorderedId, setReorderedId] = useState<string | null>(null)
  const [quickAddItem, setQuickAddItem] = useState<MenuItem | null>(null)
  const [suggestAdded, setSuggestAdded] = useState(false)
  const [tableResume, setTableResume] = useState<TableResume | null>(null)

  useEffect(() => {
    // Deferred like useTheme's readInitialTheme -- the server has no notion
    // of the visitor's local clock, so always render "morning" first and
    // correct it right after mount to avoid a hydration mismatch.
    queueMicrotask(() => setDaypart(resolveDaypart(new Date().getHours())))
  }, [])

  useEffect(() => {
    const token = getActiveTable()
    if (!token) return
    let cancelled = false
    getTableSession(supabase, token)
      .then((session) => {
        if (cancelled) return
        if (session.hasSession) {
          setTableResume({ qrToken: token, roundCount: session.rounds.length })
        } else {
          clearActiveTable()
        }
      })
      .catch(() => {
        // Best-effort signal only — leave the stored token for next time.
      })
    return () => {
      cancelled = true
    }
  }, [supabase])

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

  function handleQuickAddSuggested(item: MenuItem) {
    const needsChoice = (item.hasSizeOptions && item.sizes.length > 0) || item.modifierGroups.length > 0
    if (needsChoice) {
      setQuickAddItem(item)
      return
    }
    addItem({
      menuItemId: item.id,
      nameVi: item.nameVi,
      nameEn: item.nameEn,
      modifiers: [],
      unitPrice: item.basePrice,
    })
    setSuggestAdded(true)
  }

  const popularItems = items.filter((item) => item.isPopular && item.isAvailable)
  const suggested =
    popularItems.length === 0
      ? null
      : popularItems[
          daypart === "morning" ? 0 : daypart === "afternoon" ? Math.min(1, popularItems.length - 1) : popularItems.length - 1
        ]
  const sortedOrders = [...myOrders].sort((a, b) => b.createdAt - a.createdAt)
  const recentOrders = sortedOrders.filter((order) => order.status === "completed").slice(0, 2)
  const activeOrder = sortedOrders.find((order) => ACTIVE_STATUSES.includes(order.status))
  const suggestedName = suggested ? (locale === "vi" ? suggested.nameVi : suggested.nameEn) : ""

  if (isLoading) return <AsyncSkeleton variant="page" />

  if (hasLoadError) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-6">
        <AsyncRetryError onRetry={() => void run()} message={t("loadError")} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 md:max-w-5xl md:py-4">
      {hasStaleData && <StaleNotice onRetry={() => void run()} className="mb-3 px-4" />}

      <div className="flex flex-col gap-4 px-4 md:px-8">
        <section className="home-rise">
          <div className="nb-border nb-shadow rounded-2xl bg-primary p-4 text-primary-foreground">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-wider opacity-85">{t(`greeting${capitalize(daypart)}`)}</p>
                <p className="mt-1.5 font-playfair text-3xl italic leading-tight">{name || t("storeFallbackName")}</p>
                <p className="mt-2 max-w-[22ch] text-xs leading-relaxed opacity-90">{t(`heroSub${capitalize(daypart)}`)}</p>
              </div>
              <div className="relative flex h-24 w-20 shrink-0 items-end justify-center">
                <span className="home-steam absolute bottom-[76px] left-1/2 h-3 w-[3px] -translate-x-2 rounded-full bg-white/80" />
                <span className="home-steam absolute bottom-[76px] left-1/2 h-4 w-[3px] translate-x-0.5 rounded-full bg-white/80 [animation-delay:0.7s]" />
                <span className="home-steam absolute bottom-[76px] left-1/2 h-2.5 w-[3px] translate-x-3 rounded-full bg-white/80 [animation-delay:1.4s]" />
                <Coffee className="h-14 w-14 opacity-90" />
              </div>
            </div>

            {suggested && (
              <button
                type="button"
                onClick={() => handleQuickAddSuggested(suggested)}
                className="mt-4 flex w-full items-center gap-3 rounded-lg border-2 border-white/55 p-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">{t("suggestedForYou")}</p>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-sm font-extrabold">{suggestedName}</span>
                    <span className="shrink-0 text-sm font-extrabold opacity-90">{formatVND(suggested.basePrice)}</span>
                  </div>
                </div>
                <span className="nb-border-sm shrink-0 rounded-md bg-card px-3 py-1.5 text-[11px] font-extrabold text-foreground">
                  {suggestAdded ? t("addedToCart") : t("quickAdd")}
                </span>
              </button>
            )}
          </div>
        </section>

        <section className="home-rise grid grid-cols-2 gap-3" style={{ animationDelay: "90ms" }}>
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="nb-border nb-shadow nb-press flex flex-col gap-2.5 overflow-hidden rounded-xl bg-secondary p-3.5 text-left text-secondary-foreground"
          >
            <div className="relative flex h-9 w-9 items-center justify-center">
              <QrCode className="h-9 w-9" />
              <span className="home-scan-line absolute -left-0.5 -right-0.5 top-0 h-0.5 bg-accent" />
            </div>
            <div>
              <p className="text-sm font-extrabold leading-tight">{t("dineInTitle")}</p>
              <p className="mt-0.5 text-[11px] leading-tight opacity-85">{t("dineInSub")}</p>
            </div>
          </button>
          <Link
            href="/menu"
            className="nb-border nb-shadow nb-press flex flex-col gap-2.5 rounded-xl bg-card p-3.5 text-card-foreground"
          >
            <ShoppingBasket className="h-9 w-9 text-secondary" />
            <div className="mt-auto">
              <p className="text-sm font-extrabold leading-tight">{t("pickupTitle")}</p>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{t("pickupSub")}</p>
            </div>
          </Link>
        </section>

        {scanError && <p className="text-sm text-destructive">{scanError}</p>}

        <Link
          href="/loyalty/redemptions"
          className="home-rise nb-border nb-shadow nb-press flex items-center gap-3 rounded-xl bg-accent p-3.5 text-accent-foreground"
          style={{ animationDelay: "160ms" }}
        >
          <Gift className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold leading-tight">{t("rewardsTitle")}</p>
            <p className="mt-0.5 text-[11px] font-semibold opacity-80">{t("rewardsSub")}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-75" />
        </Link>

        {tableResume && (
          <Link
            href={`/table/${encodeURIComponent(tableResume.qrToken)}`}
            className="nb-border nb-shadow nb-press flex items-center gap-3 rounded-xl bg-primary p-3.5 text-primary-foreground"
          >
            <span className="live-pulse-dot" style={{ background: "#fff" }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold">{t("tableResumeTitle")}</p>
              <p className="mt-0.5 text-[11px] opacity-85">{t("tableResumeHint")}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </Link>
        )}

        {activeOrder && (
          <Link
            href={`/orders/${activeOrder.id}`}
            className="nb-border nb-shadow-sm nb-press-sm flex items-center gap-3 rounded-xl bg-chip p-3.5"
          >
            <span className="live-pulse-dot" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-extrabold text-card-foreground">
                #{formatOrderId(activeOrder.id)} · {tOrders(STATUS_KEYS[activeOrder.status])}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("trackHint")}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </div>

      {popularItems.length > 0 && <BestSellersArc items={popularItems} />}

      <div className="mt-5 flex flex-col gap-4 px-4 md:px-8">
        <section>
          <p className="mb-2 text-sm font-extrabold text-card-foreground">{t("quickReorderTitle")}</p>
          {isLoadingMyOrders ? null : myOrdersError ? (
            <AsyncRetryError onRetry={retryMyOrders} message={tOrders("loadError")} />
          ) : recentOrders.length === 0 ? null : (
            <div className="flex flex-col gap-2.5">
              {recentOrders.map((order) => {
                const itemsLabel = order.items.map((item) => (locale === "vi" ? item.nameVi : item.nameEn)).join(", ")
                return (
                  <div key={order.id} className="nb-border nb-shadow-sm flex items-center gap-3 rounded-lg bg-card p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-card-foreground">{itemsLabel}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        #{formatOrderId(order.id)} · {formatVND(order.total)}
                      </p>
                    </div>
                    <Button variant="neubrutal" size="sm" onClick={() => handleReorder(order)}>
                      {reorderedId === order.id ? tOrders("reorderAdded") : tOrders("reorder")}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <Link
          href="/loyalty"
          className="nb-border nb-shadow nb-press flex items-center gap-3.5 rounded-xl bg-secondary p-3.5 text-secondary-foreground"
        >
          <ProgressRing percent={tier?.progressPercent ?? 0} size={52} strokeWidth={5}>
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

        {(shopSettings.address || shopSettings.openingHours) && (
          <section className="nb-border nb-shadow-sm flex flex-col gap-2.5 rounded-xl bg-card p-3.5">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-chip text-secondary">
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-card-foreground">{shopSettings.shopName || t("storeFallbackName")}</p>
                {shopSettings.address && (
                  <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-muted-foreground">{shopSettings.address}</p>
                )}
              </div>
            </div>
            {shopSettings.openingHours && (
              <div className="nb-border-sm inline-flex w-fit items-center gap-1.5 rounded-full bg-chip px-2.5 py-1">
                <Clock className="h-3.5 w-3.5 text-secondary" />
                <span className="text-[11px] font-extrabold">{shopSettings.openingHours}</span>
              </div>
            )}
            <p className="text-[11px] font-semibold leading-relaxed text-muted-foreground">{t("storeNote")}</p>
          </section>
        )}
      </div>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} onScan={handleTableScan} />}
      {quickAddItem && (
        <QuickAddPopup
          item={quickAddItem}
          onClose={() => setQuickAddItem(null)}
          onAdd={(input) => {
            addItem(input)
            setSuggestAdded(true)
          }}
        />
      )}
    </div>
  )
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>
}
