"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useReducedMotion } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Gift, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const STEP = 210
const TAIL_BUFFER = 144
const CARD_WIDTH = 244

/** Ported from the Claude Design canvas mockup Home was built from
 * (`PhaDinCafe Customer App.dc.html`'s best-sellers section): each card sits
 * stacked at the same spot and slides/rotates/scales/fades in and out of
 * view as `u` (its own distance from the scroll position, in card-steps)
 * moves past zero. */
function frame(u: number): CSSProperties {
  const cu = Math.max(-1.8, Math.min(1.8, u))
  const mag = Math.min(Math.abs(cu), 1)
  return {
    transform: `translate(${(-cu * 104).toFixed(1)}px, ${(-cu * 84).toFixed(1)}px) rotate(${(-cu * 6).toFixed(2)}deg) scale(${(1 - mag * 0.26).toFixed(3)})`,
    opacity: Math.abs(cu) > 1.45 ? 0 : 1 - mag * 0.62,
    zIndex: 100 - Math.round(Math.abs(cu) * 12),
    pointerEvents: Math.abs(cu) < 0.55 ? "auto" : "none",
  }
}

function ProductCard({ item, style }: { item: MenuItem; style: CSSProperties }) {
  const locale = useLocale()
  const t = useTranslations("Home")
  const name = locale === "vi" ? item.nameVi : item.nameEn
  const sub = locale === "vi" ? item.nameEn : item.nameVi

  return (
    <div
      className="absolute left-1/2 top-[60px] will-change-transform"
      style={{ width: CARD_WIDTH, marginLeft: -CARD_WIDTH / 2, ...style }}
    >
      <Link href={`/menu/${item.id}`} className="nb-border nb-shadow flex flex-col gap-2.5 rounded-2xl bg-card p-3">
        <div className="relative h-[132px] overflow-hidden rounded-xl bg-chip">
          <ItemImage item={item} className="h-full w-full" />
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold leading-tight text-card-foreground">{name}</p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">{sub}</p>
          </div>
          <span className="shrink-0 text-base font-extrabold text-price">{formatVND(item.basePrice)}</span>
        </div>
        <div className="nb-border-sm flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-xs font-extrabold text-primary-foreground">
          <span>{t("selectThis")}</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </div>
      </Link>
    </div>
  )
}

function RewardsCard({ style }: { style: CSSProperties }) {
  const t = useTranslations("Home")
  return (
    <div
      className="absolute left-1/2 top-[60px] will-change-transform"
      style={{ width: CARD_WIDTH, marginLeft: -CARD_WIDTH / 2, ...style }}
    >
      <Link href="/loyalty/redemptions" className="nb-border nb-shadow flex flex-col gap-3 rounded-2xl bg-primary p-4 text-primary-foreground">
        <Gift className="h-6 w-6" />
        <div>
          <p className="text-base font-extrabold leading-tight">{t("rewardsTitle")}</p>
          <p className="mt-1 text-[11px] opacity-85">{t("rewardsSub")}</p>
        </div>
        <div className="nb-border-sm flex items-center justify-center rounded-lg bg-card py-2.5 text-xs font-extrabold text-foreground">
          {t("viewAll")}
        </div>
      </Link>
    </div>
  )
}

function StaticRow({ item }: { item: MenuItem }) {
  const locale = useLocale()
  const name = locale === "vi" ? item.nameVi : item.nameEn
  return (
    <Link href={`/menu/${item.id}`} className="nb-border nb-shadow-sm flex items-center gap-3 rounded-lg bg-card p-2.5">
      <ItemImage item={item} className="h-16 w-16 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-card-foreground">{name}</p>
        <p className="text-sm font-extrabold text-price">{formatVND(item.basePrice)}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export function BestSellersArc({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Home")
  const containerRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const [sp, setSp] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (reduceMotion) return
    function onScroll() {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const el = containerRef.current
        if (!el) return
        setSp(-el.getBoundingClientRect().top)
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [reduceMotion])

  if (items.length === 0) return null

  const header = (
    <div className="flex items-baseline justify-between gap-2 px-4 pb-1 md:px-8">
      <div>
        <p className="text-sm font-extrabold text-card-foreground">{t("bestTitle")}</p>
        <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{t("bestSub")}</p>
      </div>
      <Link href="/menu" className="nb-border-sm rounded-full bg-card px-3 py-1.5 text-[11px] font-extrabold text-foreground">
        {t("viewAll")}
      </Link>
    </div>
  )

  if (reduceMotion) {
    return (
      <section className="mt-5">
        {header}
        <div className="flex flex-col gap-3 px-4 pt-2 md:px-8">
          {items.map((item) => (
            <StaticRow key={item.id} item={item} />
          ))}
        </div>
      </section>
    )
  }

  const prog = Math.max(0, sp) / STEP
  const height = 360 + items.length * STEP + TAIL_BUFFER

  return (
    <section className="mt-5">
      {header}
      <div ref={containerRef} className="relative" style={{ height }}>
        <div className="sticky top-0" style={{ height: "min(360px, 100%)" }}>
          <div className="absolute inset-0 overflow-hidden">
            {items.map((item, index) => (
              <ProductCard key={item.id} item={item} style={frame(prog - index)} />
            ))}
            <RewardsCard style={frame(prog - items.length)} />
          </div>
        </div>
      </div>
    </section>
  )
}
