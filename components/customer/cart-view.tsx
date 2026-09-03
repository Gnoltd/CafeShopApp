"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { motion, useMotionValue, type PanInfo } from "framer-motion"
import { Minus, Plus, Trash2, ArrowRight, ShoppingBasket, Ticket, X } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVND } from "@/lib/format"
import { useCart, type CartItem } from "@/hooks/useCart"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"
import { AnimatedCounter } from "@/components/motion/animated-counter"

function lineLabel(item: CartItem, locale: string): string {
  const parts: string[] = []
  if (item.size) parts.push(item.size.label)
  item.modifiers.forEach((m) => parts.push(locale === "vi" ? m.labelVi : m.labelEn))
  return parts.join(", ")
}

const SWIPE_DISMISS_THRESHOLD = -80

function CartRow({
  item,
  locale,
  t,
  onRemove,
  onUpdateQuantity,
}: {
  item: CartItem
  locale: string
  t: ReturnType<typeof useTranslations>
  onRemove: (id: string) => void
  onUpdateQuantity: (id: string, quantity: number) => void
}) {
  const x = useMotionValue(0)
  const name = locale === "vi" ? item.nameVi : item.nameEn
  const label = lineLabel(item, locale)

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.x < SWIPE_DISMISS_THRESHOLD) onRemove(item.cartItemId)
  }

  return (
    <motion.div
      style={{ x }}
      drag="x"
      dragConstraints={{ left: -96, right: 0 }}
      dragElastic={{ left: 0.15, right: 0 }}
      onDragEnd={handleDragEnd}
      className="nb-border nb-shadow flex gap-3 rounded-xl bg-card p-3"
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-chip">
        <ShoppingBasket className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight text-card-foreground">{name}</h3>
            <button
              type="button"
              onClick={() => onRemove(item.cartItemId)}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={t("remove")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {label && <p className="mt-1 text-xs text-muted-foreground">{label}</p>}
          {item.needsConfiguration && <p className="mt-1 text-xs font-semibold text-amber-700">{t("configurationWarning")}</p>}
          {item.note && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {t("noteLabel")}: {item.note}
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-extrabold text-price">
              {formatVND(item.unitPrice * item.quantity)}
            </span>
            {item.quantity > 1 && (
              <span className="text-[10px] text-muted-foreground">
                {formatVND(item.unitPrice)} × {item.quantity}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-muted px-1 py-1">
            <button
              type="button"
              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity - 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-background"
              aria-label={t("decrease")}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
            <button
              type="button"
              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-background"
              aria-label={t("increase")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function CartView() {
  const locale = useLocale()
  const t = useTranslations("Cart")
  const { items, updateQuantity, removeItem, subtotal, promoCode, promoDiscount, applyPromoCode, clearPromoCode } =
    useCart()
  const [promoInput, setPromoInput] = useState("")
  const [promoErrorReason, setPromoErrorReason] = useState<
    "not_found" | "inactive" | "not_started" | "expired" | "limit_reached" | "below_minimum" | null
  >(null)
  const [isApplyingPromo, setIsApplyingPromo] = useState(false)

  async function handleApplyPromo() {
    setIsApplyingPromo(true)
    const result = await applyPromoCode(promoInput)
    setIsApplyingPromo(false)
    if (result.valid) {
      setPromoInput("")
      setPromoErrorReason(null)
    } else {
      setPromoErrorReason(result.reason)
    }
  }

  const PROMO_ERROR_KEY = {
    not_found: "promoNotFound",
    inactive: "promoInactive",
    not_started: "promoNotStarted",
    expired: "promoExpired",
    limit_reached: "promoLimitReached",
    below_minimum: "promoBelowMinimum",
  } as const

  const total = Math.max(subtotal - promoDiscount, 0)

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
        <ShoppingBasket className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("empty")}</p>
        <Button variant="neubrutal" className="h-11" render={<Link href="/menu" />} nativeButton={false}>
          {t("browseMenu")}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 sm:px-6 md:max-w-5xl md:px-8 md:py-4">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* Left Column: Cart items and Promo code */}
        <div className="flex-1 min-w-0 md:flex-[3]">
          <StaggerList className="flex flex-col gap-3">
            {items.map((item) => (
              <StaggerItem key={item.cartItemId}>
                <CartRow item={item} locale={locale} t={t} onRemove={removeItem} onUpdateQuantity={updateQuantity} />
              </StaggerItem>
            ))}
          </StaggerList>

          {promoCode ? (
            <div className="nb-border-sm flex items-center justify-between gap-3 rounded-xl bg-chip px-4 py-3 mt-6">
              <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Ticket className="h-4 w-4" />
                {t("promoApplied")}: <strong>{promoCode}</strong>
              </span>
              <button
                type="button"
                onClick={clearPromoCode}
                aria-label={t("removePromo")}
                title={t("removePromo")}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="nb-border-sm mt-6 flex flex-col gap-2 rounded-xl bg-card p-4">
              <span className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Ticket className="h-4 w-4" />
                {t("promoLabel")}
              </span>
              <div className="flex gap-2">
                <Input
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value)
                    setPromoErrorReason(null)
                  }}
                  placeholder={t("promoPlaceholder")}
                  className="nb-border-sm h-10 flex-1 rounded-lg"
                />
                <Button
                  variant="neubrutal"
                  className="h-10"
                  onClick={handleApplyPromo}
                  disabled={!promoInput.trim() || isApplyingPromo}
                >
                  {t("apply")}
                </Button>
              </div>
              {promoErrorReason && <p className="text-xs text-destructive">{t(PROMO_ERROR_KEY[promoErrorReason])}</p>}
            </div>
          )}
        </div>

        {/* Right Column: Sticky Summary & Checkout CTA */}
        <div className="w-full md:w-80 md:flex-[2] md:sticky md:top-20 md:self-start">
          <section className="nb-border nb-shadow space-y-3 rounded-2xl bg-chip p-5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("subtotal")}</span>
              <AnimatedCounter value={subtotal} format={formatVND} className="font-bold" />
            </div>
            {promoDiscount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("discount")}</span>
                <span className="font-bold text-success">-{formatVND(promoDiscount)}</span>
              </div>
            )}
            <div className="h-0.5 bg-ink/20" />
            <div className="flex items-center justify-between">
              <span className="text-lg font-extrabold text-card-foreground">{t("total")}</span>
              <AnimatedCounter value={total} format={formatVND} className="text-lg font-extrabold text-price" />
            </div>
          </section>

          <Button
            variant="neubrutal"
            className="mt-6 h-12 w-full gap-2 text-base"
            render={<Link href="/checkout" />}
            nativeButton={false}
          >
            {t("proceedToCheckout")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
