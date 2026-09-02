"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CreditCard, Banknote, QrCode, TableIcon, Sparkles, Gift, Check, AlertTriangle } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { computeOrderTotal } from "@/lib/order-total"
import { createClient } from "@/lib/supabase/client"
import { cancelPendingOrder } from "@/lib/supabase/orders-data"
import { isShiftOpen } from "@/lib/supabase/shift-data"
import { getMyRedemptions, type MyRedemption } from "@/lib/supabase/rewards-data"
import { getShopSettings, getLoyaltySettings } from "@/lib/supabase/settings-data"
import { useCart } from "@/hooks/useCart"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import { buildTableCartTransfer, prepareTableCartTransfer } from "@/lib/table-cart-transfer"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PressFeedback } from "@/components/motion/press-feedback"

type OrderType = "pickup" | "dine-in"
type PaymentMethod = "stripe" | "cash" | "vnpay"

const PAYMENT_OPTIONS: { id: PaymentMethod; icon: typeof CreditCard; labelKey: "payStripe" | "payCash" | "payVNPay"; enabled: boolean }[] = [
  { id: "stripe", icon: CreditCard, labelKey: "payStripe", enabled: true },
  { id: "cash", icon: Banknote, labelKey: "payCash", enabled: true },
  { id: "vnpay", icon: QrCode, labelKey: "payVNPay", enabled: true },
]

export function CheckoutView() {
  const locale = useLocale()
  const t = useTranslations("Checkout")
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const { items, subtotal, promoCode, promoDiscount, clear } = useCart()

  const [orderType, setOrderType] = useState<OrderType>("pickup")
  const [pickupTime, setPickupTime] = useState("asap")
  const [redeemLoyalty, setRedeemLoyalty] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [payAt, setPayAt] = useState<"now" | "later">("now")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [pointsBalance, setPointsBalance] = useState(0)
  const [redeemValuePerPoint, setRedeemValuePerPoint] = useState(0)
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true)
  const [taxRatePercent, setTaxRatePercent] = useState(0)
  const [usableRedemptions, setUsableRedemptions] = useState<MyRedemption[]>([])
  const [selectedRedemptionIds, setSelectedRedemptionIds] = useState<string[]>([])
  const [isPlacing, setIsPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const [canceledNotice, setCanceledNotice] = useState(false)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  // Optimistic true so the form doesn't flash "closed" while the first
  // check is in flight — place_order's own no_open_shift rejection is
  // still the real, server-authoritative gate.
  const [shiftOpen, setShiftOpen] = useState(true)

  // One fixed redemption chunk per toggle-on, same UX as the old mock's
  // single "50 points for X đ" option — only the VND-per-point conversion
  // becomes real (loyalty_settings.redeem_value_vnd_per_point), not a
  // hardcoded 10,000đ.
  const REDEEM_CHUNK_POINTS = 50

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setIsLoggedIn(true)
      supabase
        .from("profiles")
        .select("loyalty_points_balance")
        .eq("id", user.id)
        .single()
        .then(({ data: profile }) => {
          if (profile) setPointsBalance(profile.loyalty_points_balance)
        })
      getMyRedemptions(supabase)
        .then((all) => setUsableRedemptions(all.filter((r) => !r.isUsed && !r.isExpired)))
        .catch((err) => {
          console.error("Failed to load redemptions on checkout", err)
          setUsableRedemptions([])
        })
    })
    getLoyaltySettings(supabase).then((settings) => {
      setRedeemValuePerPoint(settings.redeemValueVndPerPoint)
      setLoyaltyEnabled(settings.enabled)
    })
    getShopSettings(supabase).then((settings) => setTaxRatePercent(settings.taxRatePercent))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    function checkShiftOpen() {
      isShiftOpen(supabase)
        .then((open) => {
          if (!cancelled) setShiftOpen(open)
        })
        .catch(() => {
          // Fail open on a check error — place_order's own gate is the
          // real enforcement; this is only an early UX hint.
        })
    }
    checkShiftOpen()
    const interval = setInterval(checkShiftOpen, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const canceledOrderId = searchParams.get("stripeCanceled")
    if (!canceledOrderId) return
    cancelPendingOrder(supabase, canceledOrderId).finally(() => {
      setCanceledNotice(true)
      router.replace("/checkout")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchParams.get("paymentFailed") !== "1") return
    setCanceledNotice(true)
    router.replace("/checkout")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canRedeem = pointsBalance >= REDEEM_CHUNK_POINTS
  const loyaltyDiscount = redeemLoyalty && canRedeem ? REDEEM_CHUNK_POINTS * redeemValuePerPoint : 0
  const redemptionDiscount = usableRedemptions
    .filter((r) => selectedRedemptionIds.includes(r.id))
    .reduce((sum, r) => sum + r.discountValueVnd, 0)
  const discount = promoDiscount + loyaltyDiscount + redemptionDiscount
  const { tax, total } = computeOrderTotal({ subtotal, discount, taxRatePercent })

  function toggleRedemption(id: string) {
    setSelectedRedemptionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleTableScan(token: string) {
    try {
      const transferId = prepareTableCartTransfer(
        window.sessionStorage,
        crypto.randomUUID(),
        token,
        buildTableCartTransfer(items)
      )
      router.push(`/table/${encodeURIComponent(token)}?cartTransfer=${transferId}`)
    } catch {
      setError(t("cartTransferPrepareError"))
    }
  }

  async function handlePlaceOrder() {
    if (items.length === 0 || !shiftOpen || (payAt === "now" && !paymentMethod)) return
    setError(null)
    setIsPlacing(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: "pickup",
          tableId: null,
          tableNumber: null,
          pickupTime,
          paymentMethod: payAt === "now" ? paymentMethod : null,
          payAt,
          promoCode,
          redeemLoyaltyPoints: redeemLoyalty && canRedeem ? REDEEM_CHUNK_POINTS : 0,
          redemptionIds: selectedRedemptionIds,
          paymentCollected: false,
          locale,
          items: items.map((item) => ({
            menuItemId: item.menuItemId,
            sizeId: item.size?.id ?? null,
            modifierIds: item.modifiers.map((m) => m.optionId),
            quantity: item.quantity,
            note: item.note ?? null,
          })),
        },
      })
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      clear()
      setSelectedRedemptionIds([])
      router.push(`/orders/${data.orderId}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes("invalid_redemption_code") || message.includes("redemption_already_used") || message.includes("redemption_expired")) {
        setError(t("redemptionInvalidError"))
        setSelectedRedemptionIds([])
      } else if (message.includes("no_open_shift")) {
        setShiftOpen(false)
        setError(t("shopClosedError"))
      } else {
        setError(paymentMethod === "stripe" ? t("cardPaymentUnavailable") : t("placeOrderError"))
      }
      setIsPlacing(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
        <p className="text-muted-foreground">{t("emptyCart")}</p>
        <Button variant="neubrutal" className="h-11" render={<Link href="/menu" />} nativeButton={false}>
          {t("browseMenu")}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-5xl md:px-8 md:pb-8">
      {!shiftOpen && (
        <div className="nb-border nb-shadow-sm mb-6 flex items-start gap-3 rounded-xl bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-extrabold text-destructive">{t("shopClosedTitle")}</p>
            <p className="text-sm text-destructive/80">{t("shopClosedBody")}</p>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* Left Column: Order configurations */}
        <div className="flex-1 min-w-0 md:flex-[3]">
          <section className="mb-6 space-y-2">
            <h2 className="font-bold text-card-foreground">{t("orderType")}</h2>
            <SegmentedControl
              layoutId="checkout-order-type-pill"
              value={orderType}
              onChange={setOrderType}
              options={[
                { value: "pickup" as const, label: t("pickup") },
                { value: "dine-in" as const, label: t("dineIn") },
              ]}
            />
          </section>

          {orderType === "dine-in" && (
            <section className="nb-border nb-shadow-sm mb-6 space-y-3 rounded-xl bg-chip p-4">
              <div className="flex items-start gap-3">
                <TableIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h2 className="font-extrabold text-card-foreground">{t("dineIn")}</h2>
                  <p className="text-sm text-muted-foreground">{t("dineInRequiresScan")}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="neubrutal"
                className="h-11 w-full gap-2"
                onClick={() => {
                  setError(null)
                  setIsScannerOpen(true)
                }}
              >
                <QrCode className="h-4 w-4" />
                {t("openCamera")}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </section>
          )}

          {orderType === "pickup" && (
            <section className="mb-6 space-y-2">
              <label htmlFor="pickup-time" className="block font-bold text-card-foreground">
                {t("pickupTime")}
              </label>
              <select
                id="pickup-time"
                value={pickupTime}
                onChange={(e) => setPickupTime(e.target.value)}
                className="h-14 w-full rounded-xl border border-input bg-card px-4 text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="asap">{t("asap")}</option>
                <option value="15">{t("in15")}</option>
                <option value="30">{t("in30")}</option>
                <option value="schedule">{t("schedule")}</option>
              </select>
            </section>
          )}

          {orderType === "pickup" && loyaltyEnabled && (
            <section className="nb-border nb-shadow-sm mb-6 space-y-3 rounded-xl bg-chip p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-card-foreground">{t("loyaltyPoints")}</h2>
                <Sparkles className="h-6 w-6 text-accent-foreground/70" />
              </div>
              {isLoggedIn ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("pointsBalance", { points: pointsBalance })}</p>
                  <div className="nb-border-sm flex items-center justify-between gap-3 rounded-lg bg-card p-3">
                    <span className="text-sm font-medium text-card-foreground">
                      {t("redeemLabel", { points: REDEEM_CHUNK_POINTS, amount: formatVND(REDEEM_CHUNK_POINTS * redeemValuePerPoint) })}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={redeemLoyalty}
                      disabled={!canRedeem}
                      onClick={() => setRedeemLoyalty((prev) => !prev)}
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
                        redeemLoyalty ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          redeemLoyalty ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground" title={t("loyaltyGuestTooltip")}>
                  {t("loyaltyGuestTooltip")}
                </p>
              )}
            </section>
          )}

          {orderType === "pickup" && isLoggedIn && usableRedemptions.length > 0 && (
            <section className="nb-border nb-shadow-sm mb-6 space-y-3 rounded-xl bg-chip p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-card-foreground">{t("myRewardsTitle")}</h2>
                <Gift className="h-6 w-6 text-accent-foreground/70" />
              </div>
              <div className="flex flex-col gap-2">
                {usableRedemptions.map((r) => {
                  const selected = selectedRedemptionIds.includes(r.id)
                  const name = locale === "vi" ? r.rewardNameVi : r.rewardNameEn
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRedemption(r.id)}
                      className={cn(
                        "nb-border-sm nb-press-sm flex items-center justify-between gap-3 rounded-lg bg-card p-3 text-left",
                        selected && "bg-primary/10"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink",
                            selected && "bg-primary text-primary-foreground"
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="text-sm font-bold text-card-foreground">{name}</span>
                      </span>
                      <span className="text-sm font-extrabold text-price">-{formatVND(r.discountValueVnd)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {orderType === "pickup" && (
            <section className="mb-6 space-y-2">
              <h2 className="font-bold text-card-foreground">{t("payTiming")}</h2>
              <SegmentedControl
                layoutId="checkout-pay-timing-pill"
                value={payAt}
                onChange={setPayAt}
                options={[
                  { value: "now" as const, label: t("payNow") },
                  { value: "later" as const, label: t("payLater") },
                ]}
              />
              {payAt === "later" && <p className="text-sm text-muted-foreground">{t("payLaterNote")}</p>}
            </section>
          )}

          {orderType === "pickup" && payAt === "now" && (
            <section className="mb-6 space-y-2">
              <h2 className="font-bold text-card-foreground">{t("paymentMethod")}</h2>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_OPTIONS.map(({ id, icon: Icon, labelKey, enabled }) => (
                  <PressFeedback
                    key={id}
                    type="button"
                    disabled={!enabled}
                    title={enabled ? undefined : t("paymentMethodComingSoon")}
                    onClick={() => setPaymentMethod(id)}
                    className={cn(
                      "nb-border nb-shadow-sm flex flex-col items-center gap-2 rounded-xl p-4",
                      paymentMethod === id
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground",
                      !enabled && "opacity-50"
                    )}
                  >
                    <Icon className="h-7 w-7" />
                    <span className="text-xs font-extrabold">{t(labelKey)}</span>
                  </PressFeedback>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Sticky Summary & Checkout Action */}
        {orderType === "pickup" && <div className="w-full md:w-80 md:flex-[2] md:sticky md:top-20 md:self-start">
          <section className="nb-border nb-shadow-sm mb-6 space-y-3 rounded-xl bg-chip p-4">
            <h2 className="font-extrabold text-card-foreground">{t("summary")}</h2>
            <div className="space-y-3 max-h-[40vh] overflow-y-auto">
              {items.map((item) => {
                const name = locale === "vi" ? item.nameVi : item.nameEn
                return (
                  <div key={item.cartItemId} className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-card-foreground">{name}</p>
                      <p className="text-xs text-muted-foreground">x{item.quantity}</p>
                      {item.note && (
                        <p className="text-xs italic text-muted-foreground">
                          {t("noteLabel")}: {item.note}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-card-foreground">
                      {formatVND(item.unitPrice * item.quantity)}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">{t("subtotal")}</span>
              <span className="font-bold text-card-foreground">{formatVND(subtotal)}</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("discount")}</span>
                <span className="font-bold text-green-600">-{formatVND(promoDiscount)}</span>
              </div>
            )}
            {redemptionDiscount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("rewardsDiscountLabel")}</span>
                <span className="font-bold text-green-600">-{formatVND(redemptionDiscount)}</span>
              </div>
            )}
            {tax > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("taxLabel", { rate: taxRatePercent })}</span>
                <span className="font-bold text-card-foreground">{formatVND(tax)}</span>
              </div>
            )}
          </section>

          {canceledNotice && (
            <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t("paymentCanceledNotice")}
            </p>
          )}
          {error && (
            <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          {/* Desktop Place Order Card */}
          <div className="nb-border nb-shadow hidden md:flex flex-col gap-4 rounded-xl bg-card p-5">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("total")}</span>
              <span className="text-2xl font-extrabold text-price">{formatVND(total)}</span>
              {discount > 0 && (redeemLoyalty || redemptionDiscount > 0) && (
                <span className="text-[11px] text-accent-foreground/80 mt-1">
                  {t("discountApplied", { amount: formatVND(discount) })}
                </span>
              )}
            </div>
            <Button
              variant="neubrutal"
              onClick={handlePlaceOrder}
              disabled={!shiftOpen || (payAt === "now" && !paymentMethod) || isPlacing}
              className="h-12 w-full text-base"
            >
              {t("placeOrder")}
            </Button>
          </div>
        </div>}
      </div>

      {/* Fixed bottom bar: mobile only */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t bg-card px-6 py-4 shadow-[0_-4px_12px_-1px_rgba(0,0,0,0.1)] md:hidden">
        {orderType === "pickup" && (
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("total")}</span>
            <span className="text-xl font-bold text-primary">{formatVND(total)}</span>
            {discount > 0 && (redeemLoyalty || redemptionDiscount > 0) && (
              <span className="text-[11px] text-accent-foreground/80">
                {t("discountApplied", { amount: formatVND(discount) })}
              </span>
            )}
          </div>
        )}
        <Button
          variant="neubrutal"
          onClick={
            orderType === "dine-in"
              ? () => {
                  setError(null)
                  setIsScannerOpen(true)
                }
              : handlePlaceOrder
          }
          disabled={orderType === "pickup" && (!shiftOpen || (payAt === "now" && !paymentMethod) || isPlacing)}
          className={cn("h-12 px-8 text-base", orderType === "dine-in" && "w-full")}
        >
          {orderType === "dine-in" ? t("openCamera") : t("placeOrder")}
        </Button>
      </div>

      {isScannerOpen && (
        <QrScannerOverlay onClose={() => setIsScannerOpen(false)} onScan={handleTableScan} />
      )}
    </div>
  )
}
