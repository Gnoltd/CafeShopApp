"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

function ArcItem({
  item,
  index,
  total,
  scrollYProgress,
}: {
  item: MenuItem
  index: number
  total: number
  scrollYProgress: any
}) {
  const locale = useLocale()
  const name = locale === "vi" ? item.nameVi : item.nameEn

  // Calculate normalized progress window for this item
  const step = 1 / Math.max(total, 1)
  const windowStart = index * step * 0.7
  const windowEnd = Math.min(1, windowStart + step * 1.5)
  const windowMid = (windowStart + windowEnd) / 2

  // Transform mappings for parabolic arc: Bottom-Right -> Center-Apex -> Top-Left
  const x = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["70vw", "0vw", "-70vw"]
  )

  const y = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["50vh", "-12vh", "-60vh"]
  )

  const scale = useTransform(
    scrollYProgress,
    [
      windowStart,
      windowStart + (windowMid - windowStart) * 0.5,
      windowMid,
      windowMid + (windowEnd - windowMid) * 0.5,
      windowEnd,
    ],
    [0.75, 1.1, 1.55, 1.1, 0.75]
  )

  const opacity = useTransform(
    scrollYProgress,
    [
      windowStart,
      windowStart + (windowMid - windowStart) * 0.3,
      windowMid + (windowEnd - windowMid) * 0.7,
      windowEnd,
    ],
    [0, 1, 1, 0]
  )

  const rotate = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    [14, 0, -14]
  )

  return (
    <motion.div
      className="absolute flex items-center justify-center"
      style={{
        x,
        y,
        scale,
        opacity,
        rotate,
        zIndex: Math.round(100 - Math.abs(index - total / 2)),
      }}
    >
      <Link
        href={`/menu/${item.id}` as any}
        className="group relative flex w-[88vw] max-w-[480px] flex-col overflow-hidden rounded-3xl bg-[#160f0b] p-5 shadow-[0_25px_60px_rgba(0,0,0,0.9)] border border-white/10 transition-all duration-300 hover:border-primary/50 hover:shadow-primary/30 sm:max-w-[580px] md:max-w-[650px] md:p-6"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-muted">
          <ItemImage
            item={item}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-85 transition-opacity group-hover:opacity-70" />

          <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between text-white md:bottom-6 md:left-7 md:right-7">
            <div className="max-w-[70%]">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-accent md:text-sm">
                PhaDin Selection
              </span>
              <h4 className="line-clamp-1 text-xl font-black md:text-3xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary px-4 py-1.5 text-xs font-black text-primary-foreground shadow-lg md:text-base">
              {formatVND(item.basePrice)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Landing")
  const containerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  })

  const displayItems = items.length > 0 ? items : []

  if (displayItems.length === 0) return null

  return (
    <section ref={containerRef} className="relative h-[350vh] bg-[#070504]">
      <div className="sticky top-0 flex h-screen w-full flex-col items-center justify-between overflow-hidden py-10 md:py-14">
        {/* Ambient background glows */}
        <div className="pointer-events-none absolute -left-32 top-1/3 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[150px]" />
        <div className="pointer-events-none absolute -right-32 bottom-1/3 h-[500px] w-[500px] rounded-full bg-accent/10 blur-[150px]" />

        {/* Section Title */}
        <div className="relative z-10 text-center px-4">
          <div className="flex items-center justify-center gap-2 text-accent">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-extrabold uppercase tracking-widest">Craft & Motion</span>
          </div>
          <h2 className="mt-1 text-3xl font-black text-white md:text-5xl">{t("bestSellers")}</h2>
          <p className="mt-1 text-xs text-white/60 md:text-sm">Scroll down to explore signature creations</p>
        </div>

        {/* Arc Trajectory Motion Viewport */}
        <div className="relative flex h-full w-full items-center justify-center">
          {displayItems.map((item, index) => (
            <ArcItem
              key={item.id}
              item={item}
              index={index}
              total={displayItems.length}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>

        {/* Footer Navigation Link */}
        <div className="relative z-10 px-4">
          <Link
            href="/menu"
            className="flex items-center gap-2 rounded-full bg-white/10 px-6 py-2.5 text-sm font-extrabold text-white backdrop-blur-md transition-all hover:bg-primary hover:text-primary-foreground hover:shadow-lg"
          >
            <span>{t("viewAll")}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
