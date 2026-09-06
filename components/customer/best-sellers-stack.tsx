"use client"

import { useRef, type ReactNode } from "react"
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Gift, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const SCROLL_PER_CARD = 260
const STICKY_HEIGHT = 340

/** One card's position in the stack, as a function of scroll progress: `u`
 * (signed distance from "active") drives translate/rotate/scale/opacity the
 * same way for every card — only `index` shifts where each one's `u` hits 0. */
function StackCard({
  index,
  count,
  scrollYProgress,
  children,
}: {
  index: number
  count: number
  scrollYProgress: MotionValue<number>
  children: ReactNode
}) {
  const transform = useTransform(scrollYProgress, (p) => {
    const u = p * count - index
    const mag = Math.min(Math.abs(u), 1)
    return `translate(${(-u * 90).toFixed(1)}px, ${(-u * 70).toFixed(1)}px) rotate(${(-u * 6).toFixed(2)}deg) scale(${(1 - mag * 0.22).toFixed(3)})`
  })
  const opacity = useTransform(scrollYProgress, (p) => {
    const u = p * count - index
    return Math.abs(u) > 1.6 ? 0 : 1 - Math.min(Math.abs(u), 1) * 0.55
  })
  const zIndex = useTransform(scrollYProgress, (p) => 100 - Math.round(Math.abs(p * count - index) * 10))
  const pointerEvents = useTransform(scrollYProgress, (p) => (Math.abs(p * count - index) < 0.55 ? "auto" : "none"))

  return (
    <motion.div
      className="absolute left-1/2 top-8 w-[240px] -ml-[120px]"
      style={{ transform, opacity, zIndex, pointerEvents }}
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
  const sectionRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  })

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
    <div ref={sectionRef} className="relative" style={{ height: STICKY_HEIGHT + count * SCROLL_PER_CARD }}>
      <div className="sticky top-14 h-[340px] overflow-hidden md:top-16">
        {items.map((item, index) => {
          const name = locale === "vi" ? item.nameVi : item.nameEn
          return (
            <StackCard key={item.id} index={index} count={count} scrollYProgress={scrollYProgress}>
              <Link
                href={`/menu/${item.id}`}
                className="nb-border nb-shadow flex flex-col gap-2.5 rounded-2xl bg-card p-3"
              >
                <div className="relative h-32 overflow-hidden rounded-xl bg-chip">
                  <ItemImage item={item} className="h-full w-full" />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-extrabold leading-tight text-card-foreground">{name}</p>
                  <span className="shrink-0 text-base font-extrabold text-price">{formatVND(item.basePrice)}</span>
                </div>
                <div className="nb-border-sm flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-extrabold text-primary-foreground">
                  <span>{t("selectThis")}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            </StackCard>
          )
        })}
        <StackCard index={items.length} count={count} scrollYProgress={scrollYProgress}>
          <div className="nb-border nb-shadow flex flex-col gap-3 rounded-2xl bg-primary p-4 text-primary-foreground">
            <Gift className="h-6 w-6" />
            <div>
              <p className="text-base font-extrabold leading-tight">{t("rewardsTitle")}</p>
              <p className="mt-1 text-xs opacity-85">{t("rewardsSub")}</p>
            </div>
            <Link
              href="/loyalty/redemptions"
              className="nb-border-sm rounded-lg bg-card py-2 text-center text-xs font-extrabold text-foreground"
            >
              {t("viewAll")}
            </Link>
          </div>
        </StackCard>
      </div>
    </div>
  )
}
