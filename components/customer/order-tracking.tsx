"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  CookingPot, Check, PackageCheck, CircleCheckBig, Clock, TableIcon, ShoppingBag, MapPin, Phone, Utensils,
  CreditCard, Banknote, QrCode, Ban, Receipt,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatOrderId, formatVND } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { payExistingOrder, changeOrderPaymentMethod, type RealPaymentMethod } from "@/lib/supabase/orders-data"
import { getShopSettings } from "@/lib/supabase/settings-data"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"
import { StepProgress } from "@/components/motion/step-progress"
import { PressFeedback } from "@/components/motion/press-feedback"
import { ReviewForm } from "@/components/customer/review-form"
import { AsyncRetryError, AsyncSkeleton, StaleNotice } from "@/components/shared/async-state"

const GUEST_POLL_INTERVAL_MS = 10000

const STEPS = [
  { key: "stepPaid", icon: Check },
  { key: "stepPreparing", icon: CookingPot },
  { key: "stepReady", icon: PackageCheck },
  { key: "stepServed", icon: Utensils },
  { key: "stepCompleted", icon: CircleCheckBig },
] as const

const STATUS_STEP: Record<OrderStatus, number> = {
  pending_payment: -1,
  paid: 0,
  preparing: 1,
  ready: 2,
  served: 3,
  completed: 4,
  cancelled: -1,
}

const STATUS_LABEL_KEY: Record<OrderStatus, string> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}

const STATUS_ICON: Record<OrderStatus, typeof Check> = {
  pending_payment: Receipt,
  paid: Check,
  preparing: CookingPot,
  ready: PackageCheck,
  served: Utensils,
  completed: CircleCheckBig,
  cancelled: Ban,
}

export function OrderTracking({ orderId, table }: { orderId: string; table?: string }) {
  const locale = useLocale()
  const t = useTranslations("OrderTracking")
  const { getOrder } = useOrders()
  const [supabase] = useState(() => createClient())

  const [order, setOrder] = useState<OrderForTracking | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  // True once the FIRST load succeeded but the most recent guest-poll or
  // Realtime-triggered refetch failed. `order` is left exactly as it was
  // (never cleared) on that failure -- this only flags it as possibly
  // outdated until the next successful refetch clears it.
  const [isOrderStale, setIsOrderStale] = useState(false)
  const [loadRetryNonce, setLoadRetryNonce] = useState(0)
  const [isGuestPolling, setIsGuestPolling] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [paymentAttemptId] = useState(() => crypto.randomUUID())
  const [paymentNotice, setPaymentNotice] = useState(false)
  const [cashConfirmed, setCashConfirmed] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [openReviewIndex, setOpenReviewIndex] = useState<number | null>(null)
  const [shopPhone, setShopPhone] = useState("")
  const [shopAddress, setShopAddress] = useState("")
  const searchParams = useSearchParams()

  useEffect(() => {
    const failed = searchParams.get("paymentFailed") === "1" || searchParams.get("stripeCanceled") === "1"
    if (failed) setPaymentNotice(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getShopSettings(supabase)
      .then((settings) => {
        setShopPhone(settings.phone)
        setShopAddress(settings.address)
      })
      .catch(() => {
        setShopPhone("")
        setShopAddress("")
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePayNow(method: RealPaymentMethod) {
    setIsPaying(true)
    try {
      const { checkoutUrl } = await payExistingOrder(supabase, orderId, locale, method, paymentAttemptId)
      if (checkoutUrl) {
        window.location.href = checkoutUrl
        return
      }
      // Cash has no redirect -- give immediate feedback instead of
      // waiting for Realtime (or guest polling, up to 10s) to reflect
      // the DB change back into local `order` state.
      if (method === "cash") setCashConfirmed(true)
      setIsPaying(false)
    } catch {
      setPaymentNotice(true)
      setIsPaying(false)
    }
  }

  async function handleChangeMethod() {
    setIsPaying(true)
    try {
      await changeOrderPaymentMethod(supabase, orderId, null)
      setCashConfirmed(false)
      setPaymentNotice(false)
      const refreshed = await getOrder(orderId)
      setOrder(refreshed)
    } catch {
      setPaymentNotice(true)
    } finally {
      setIsPaying(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    let pollInterval: ReturnType<typeof setInterval> | undefined
    let channel: ReturnType<typeof supabase.channel> | undefined

    // Used by both the guest poll and the Realtime handler below -- both
    // only ever run AFTER the first load already succeeded (see `load`
    // below), so a failure here must never blank/replace the good `order`
    // already on screen -- just flag it as possibly outdated until the
    // next successful refetch clears the flag.
    async function refetchOrder() {
      try {
        const refreshed = await getOrder(orderId)
        if (cancelled) return
        setOrder(refreshed)
        setIsOrderStale(false)
      } catch {
        if (cancelled) return
        setIsOrderStale(true)
      }
    }

    async function load() {
      setLoadError(false)
      setIsOrderStale(false)
      let found: OrderForTracking | null
      try {
        found = await getOrder(orderId)
      } catch {
        // getOrderForTracking throws on any RPC/network error (not just
        // "not found", which resolves to `null` instead) -- without this
        // catch `order` stayed `undefined` forever, a permanent blank
        // screen with no way to recover short of a manual page reload.
        if (!cancelled) setLoadError(true)
        return
      }
      if (cancelled) return
      setOrder(found)
      if (!found) return

      const { data: { user } } = await supabase.auth.getUser()
      if (!cancelled) setIsLoggedIn(Boolean(user))
      if (!user) {
        // No session at all — this can only be a guest's own order (the
        // RPC already refused anything else). Realtime's authorization
        // is gated by the same RLS a direct SELECT would need, which a
        // guest never satisfies, so there is no live-push option here —
        // poll instead.
        setIsGuestPolling(true)
        pollInterval = setInterval(refetchOrder, GUEST_POLL_INTERVAL_MS)
        return
      }

      // Logged-in customer (own order, matches orders_select_own) or
      // staff (matches orders_select_staff) — both are genuinely visible
      // to Realtime under existing RLS, so subscribe for real. No
      // server-side `filter` here — found live that Supabase Realtime's
      // column filters don't reliably combine with RLS-gated
      // postgres_changes (a filtered subscription silently received
      // nothing, while the identical subscription with no filter
      // delivered events correctly). Filtering to this one order id is
      // done client-side instead, on the delivered payload.
      channel = supabase
        .channel(`order-tracking-${orderId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders" },
          async (payload) => {
            if ((payload.new as { id?: string })?.id !== orderId) return
            await refetchOrder()
          }
        )
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" && status !== "CLOSED") {
            console.warn(`Order tracking realtime subscription status: ${status}`)
          }
        })
    }
    load()

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, loadRetryNonce])

  function handleRetryLoad() {
    setOrder(undefined)
    setIsOrderStale(false)
    setLoadRetryNonce((n) => n + 1)
  }

  function handleRetryStale() {
    setLoadRetryNonce((n) => n + 1)
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-[50vh] w-full max-w-md items-center justify-center px-6">
        <AsyncRetryError onRetry={handleRetryLoad} />
      </div>
    )
  }

  if (order === undefined) {
    return <AsyncSkeleton variant="page" />
  }

  if (order === null) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-bold text-card-foreground">{t("notFoundTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("notFoundMessage")}</p>
      </div>
    )
  }

  const currentStep = STATUS_STEP[order.status]
  const paymentMethod = order.paymentMethod
  const StatusIcon = STATUS_ICON[order.status]

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4 sm:px-6 md:max-w-5xl md:px-8 md:pb-8">
      {isOrderStale && <StaleNotice onRetry={handleRetryStale} className="mb-4" />}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        {/* Left Column: Progress status */}
        <div className="flex-1 min-w-0 md:flex-[3]">
          <section className="nb-border nb-shadow relative overflow-hidden rounded-xl bg-chip p-6 text-center">
            <p className="text-xs font-extrabold uppercase tracking-widest text-secondary">{t("orderId")}</p>
            <h2 className="mb-4 text-3xl font-extrabold text-price">#{formatOrderId(order.id)}</h2>
            <div className="nb-border-sm mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-primary/15">
              <StatusIcon className="h-12 w-12 text-primary" />
            </div>
            <h3 className="mb-1 text-xl font-semibold text-card-foreground">{t(STATUS_LABEL_KEY[order.status])}</h3>
            {order.status === "preparing" && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 text-primary" />
                {t("etaLabel")}
              </p>
            )}
            {isGuestPolling && <p className="mt-2 text-[11px] text-muted-foreground">{t("guestPollingNote")}</p>}
          </section>

          <section className="mt-8 px-2">
            <StepProgress
              currentStep={currentStep}
              steps={STEPS.map((step) => ({ key: step.key, label: t(step.key), icon: step.icon }))}
            />
          </section>

          {order.status === "served" && order.paymentStatus === "pending" && (
            <section className="nb-border nb-shadow-sm mt-6 rounded-xl bg-chip p-4 text-center">
              {paymentNotice && <p className="mb-3 text-sm text-destructive">{t("paymentRetryNotice")}</p>}
              {paymentMethod === null && !cashConfirmed ? (
                <>
                  <p className="mb-3 text-sm font-medium text-card-foreground">{t("choosePaymentMethodPrompt")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <PressFeedback
                      type="button"
                      disabled={isPaying}
                      onClick={() => handlePayNow("cash")}
                      className="nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl bg-card p-4 text-muted-foreground disabled:opacity-50"
                    >
                      <Banknote className="h-7 w-7" />
                      <span className="text-xs font-bold">{t("payMethodCash")}</span>
                    </PressFeedback>
                    <PressFeedback
                      type="button"
                      disabled={isPaying}
                      onClick={() => handlePayNow("stripe")}
                      className="nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl bg-card p-4 text-muted-foreground disabled:opacity-50"
                    >
                      <CreditCard className="h-7 w-7" />
                      <span className="text-xs font-bold">{t("payMethodCard")}</span>
                    </PressFeedback>
                    <PressFeedback
                      type="button"
                      disabled={isPaying}
                      onClick={() => handlePayNow("vnpay")}
                      className="nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl bg-card p-4 text-muted-foreground disabled:opacity-50"
                    >
                      <QrCode className="h-7 w-7" />
                      <span className="text-xs font-bold">{t("payMethodVNPay")}</span>
                    </PressFeedback>
                  </div>
                </>
              ) : paymentMethod === "cash" || cashConfirmed ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("cashAwaitingStaffNote")}</p>
                  <button
                    type="button"
                    disabled={isPaying}
                    onClick={handleChangeMethod}
                    className="mt-3 text-sm font-bold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {t("changePaymentMethod")}
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-3 text-sm font-medium text-card-foreground">{t("payNowPrompt")}</p>
                  <Button variant="neubrutal" className="h-11 w-full" disabled={isPaying} onClick={() => paymentMethod && handlePayNow(paymentMethod)}>
                    {isPaying ? t("payNowLoading") : t("payNowButton")}
                  </Button>
                  <button
                    type="button"
                    disabled={isPaying}
                    onClick={handleChangeMethod}
                    className="mt-3 text-sm font-bold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {t("chooseDifferentMethod")}
                  </button>
                </>
              )}
            </section>
          )}

          <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="nb-border nb-shadow-sm flex items-center gap-4 rounded-xl bg-card p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary/20 text-secondary">
                {order.orderType === "dine-in" ? <TableIcon className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
              </div>
              <div>
                <h4 className="text-sm font-bold text-card-foreground">
                  {order.orderType === "dine-in" ? t("tableLabel", { table: order.table ?? table ?? "" }) : t("pickupBadge")}
                </h4>
                {order.orderType === "dine-in" && (
                  <p className="text-xs text-muted-foreground">{t("dineInBadge")}</p>
                )}
              </div>
            </div>
            <div className="nb-border nb-shadow-sm flex items-center gap-4 rounded-xl bg-card p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground">
                <MapPin className="h-5 w-5" />
              </div>
              {shopAddress && (
                <div>
                  <h4 className="text-sm font-bold text-card-foreground">{shopAddress}</h4>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Order Details & Totals */}
        <div className="w-full md:w-80 md:flex-[2] md:sticky md:top-20 md:self-start">
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-lg font-semibold text-card-foreground">{t("orderDetails")}</h3>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-secondary">
                {t("itemCount", { count: order.items.length })}
              </span>
            </div>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {order.items.map((item, index) => (
                <div key={index} className="nb-border-sm rounded-xl bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="font-bold text-card-foreground text-sm">
                        {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                      </h5>
                      {item.note && <p className="text-xs italic text-accent-foreground">+ {item.note}</p>}
                    </div>
                    <span className="text-sm font-extrabold text-price shrink-0">{formatVND(item.unitPrice * item.quantity)}</span>
                  </div>
                  {isLoggedIn && order.status === "completed" && (
                    openReviewIndex === index ? (
                      <ReviewForm itemId={item.menuItemId} onDone={() => setOpenReviewIndex(null)} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenReviewIndex(index)}
                        className="mt-1 text-xs font-semibold text-secondary hover:underline"
                      >
                        {t("rateReviewButton")}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-2 rounded-xl bg-muted p-4">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("subtotal")}</span>
                <span>{formatVND(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("discount")}</span>
                <span className="text-destructive">-{formatVND(order.discount)}</span>
              </div>
              {order.taxAmount > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{t("taxLabel")}</span>
                  <span>{formatVND(order.taxAmount)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <span className="font-bold text-card-foreground">{t("total")}</span>
                <span className="text-xl font-black text-primary">{formatVND(order.total)}</span>
              </div>
            </div>
          </section>

          {/* Desktop inline Contact Shop */}
          {shopPhone && (
            <div className="hidden md:block mt-6">
              <a
                href={`tel:${shopPhone}`}
                className="nb-border nb-shadow-sm nb-press-sm flex items-center justify-center gap-2 rounded-xl bg-primary py-4 font-bold text-primary-foreground"
              >
                <Phone className="h-5 w-5" />
                {t("contactShop")}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Mobile fixed bottom Contact bar */}
      {shopPhone && (
        <div className="nb-border border-x-0 border-b-0 fixed inset-x-0 bottom-0 z-40 bg-background/90 p-4 backdrop-blur-md md:hidden">
          <a
            href={`tel:${shopPhone}`}
            className="nb-border nb-shadow-sm nb-press-sm mx-auto flex max-w-2xl items-center justify-center gap-2 rounded-xl bg-primary py-4 font-bold text-primary-foreground"
          >
            <Phone className="h-5 w-5" />
            {t("contactShop")}
          </a>
        </div>
      )}
    </div>
  )
}
