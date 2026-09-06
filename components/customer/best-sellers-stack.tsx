"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Gift, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const CARD_WIDTH = 176

/** A horizontal, swipe-snapped carousel (not a vertical scroll-jack — the
 * page's own scroll never drives it, so it can't inflate Home's height).
 * Each card scales/fades by its own distance from the carousel's current
 * scroll center, computed continuously off scrollXProgress. */
function Card({ index, count, scrollXProgress, children }: {
  index: number
  count: number
  scrollXProgress: ReturnType<typeof useScroll>["scrollXProgress"]
  children: React.ReactNode
}) {
  const scale = useTransform(scrollXProgress, (p) => 1 - Math.min(Math.abs(p * (count - 1) - index), 1) * 0.1)
  const opacity = useTransform(scrollXProgress, (p) => 1 - Math.min(Math.abs(p * (count - 1) - index), 1) * 0.35)

  return (
    <motion.div
      className="shrink-0 snap-center"
      style={{ width: CARD_WIDTH, scale, opacity }}
    >
      {children}
    </motion.div>
  )
}

function StaticRow({ item }: { item: MenuItem }) {
  const locale = useLocale()
  const name = locale === "vi" ? item.nameVi : item.nameEn
  return (
    <Link
      href={`/menu/${item.id}`}
      className="nb-border nb-shadow-sm flex items-center gap-3 rounded-lg bg-card p-2.5"
    >
      <ItemImage item={item} className="h-16 w-16 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-card-foreground">{name}</p>
        <p className="text-sm font-extrabold text-price">{formatVND(item.basePrice)}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export function BestSellersStack({ items }: { items: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Home")
  const containerRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const { scrollXProgress } = useScroll({ container: containerRef, axis: "x" })

  if (items.length === 0) return null

  if (reduceMotion) {
    return (
      <div className="flex flex-col gap-3 px-5">
        {items.map((item) => (
          <StaticRow key={item.id} item={item} />
        ))}
      </div>
    )
  }

  const count = items.length + 1 // + the trailing rewards card

  return (
    <div
      ref={containerRef}
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2"
      style={{ scrollbarWidth: "none" }}
    >
      {items.map((item, index) => {
        const name = locale === "vi" ? item.nameVi : item.nameEn
        return (
          <Card key={item.id} index={index} count={count} scrollXProgress={scrollXProgress}>
            <Link href={`/menu/${item.id}`} className="nb-border nb-shadow flex flex-col gap-2.5 rounded-2xl bg-card p-3">
              <div className="relative h-32 overflow-hidden rounded-xl bg-chip">
                <ItemImage item={item} className="h-full w-full" />
              </div>
              <p className="truncate text-sm font-extrabold leading-tight text-card-foreground">{name}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold text-price">{formatVND(item.basePrice)}</span>
                <span className="nb-border-sm flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          </Card>
        )
      })}
      <Card index={items.length} count={count} scrollXProgress={scrollXProgress}>
        <div className="nb-border nb-shadow flex h-full flex-col gap-3 rounded-2xl bg-primary p-3.5 text-primary-foreground">
          <Gift className="h-6 w-6" />
          <div>
            <p className="text-sm font-extrabold leading-tight">{t("rewardsTitle")}</p>
            <p className="mt-1 text-[11px] opacity-85">{t("rewardsSub")}</p>
          </div>
          <Link
            href="/loyalty/redemptions"
            className="nb-border-sm mt-auto rounded-lg bg-card py-2 text-center text-xs font-extrabold text-foreground"
          >
            {t("viewAll")}
          </Link>
        </div>
      </Card>
    </div>
  )
}
