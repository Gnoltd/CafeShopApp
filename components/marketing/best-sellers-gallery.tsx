"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { motion, useScroll, useTransform, useMotionValueEvent } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles, ArrowRight, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import { isInPreloadBuffer } from "@/lib/gallery-preload"
import type { MenuItem } from "@/lib/supabase/menu-data"

const CATEGORY_CHIPS = [
  { id: "coffee", labelVi: "Cà Phê", labelEn: "Coffee" },
  { id: "tea", labelVi: "Trà", labelEn: "Tea" },
  { id: "pastries", labelVi: "Bánh Ngọt", labelEn: "Pastries" },
  { id: "blended", labelVi: "Đá Xay", labelEn: "Blended" },
]

const ARC_ITEM_IMAGE_SIZES = "(max-width: 640px) 82vw, (max-width: 768px) 460px, 520px"

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

  const step = 1 / Math.max(total, 1)
  const windowStart = index * step * 0.7
  const windowEnd = Math.min(1, windowStart + step * 1.4)
  const windowMid = (windowStart + windowEnd) / 2

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
    [0.7, 0.95, 1.24, 0.95, 0.7]
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
    [12, 0, -12]
  )

  return (
    <motion.div
      className="absolute flex items-center justify-center transform-gpu"
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
        className="group relative flex w-[78vw] max-w-[360px] flex-col overflow-hidden rounded-2xl bg-[#160f0b] p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)] border border-white/10 transition-all duration-300 hover:border-primary/50 hover:shadow-primary/30 sm:w-[74vw] sm:max-w-[415px] sm:p-3.5 md:max-w-[468px] md:p-4 lg:max-w-[520px] lg:p-5"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted">
          <ItemImage
            item={item}
            className="h-full w-full"
            imageClassName="transition-transform duration-700 group-hover:scale-110"
            sizes={ARC_ITEM_IMAGE_SIZES}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-85 transition-opacity group-hover:opacity-70" />

          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-5 md:right-5">
            <div className="max-w-[70%]">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-accent md:text-xs">
                PhaDin Selection
              </span>
              <h4 className="line-clamp-1 text-lg font-black md:text-2xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary px-3.5 py-1 text-xs font-black text-primary-foreground shadow-lg md:text-sm">
              {formatVND(item.basePrice)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

function PreloadImage({ item }: { item: MenuItem }) {
  if (!item.imageUrl) return null
  return (
    <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
      <Image src={item.imageUrl} alt="" fill sizes={ARC_ITEM_IMAGE_SIZES} loading="eager" />
    </div>
  )
}

function ArcPromotionItem({
  total,
  scrollYProgress,
}: {
  total: number
  scrollYProgress: any
}) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const index = total - 1

  const step = 1 / Math.max(total, 1)
  const windowStart = index * step * 0.7
  const windowMid = 0.95
  const windowEnd = 1.0

  const x = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["70vw", "0vw", "0vw"]
  )

  const y = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    ["50vh", "-10vh", "-10vh"]
  )

  const scale = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    [0.75, 1.25, 1.25]
  )

  const opacity = useTransform(
    scrollYProgress,
    [windowStart, windowStart + (windowMid - windowStart) * 0.3, windowEnd],
    [0, 1, 1]
  )

  const rotate = useTransform(
    scrollYProgress,
    [windowStart, windowMid, windowEnd],
    [10, 0, 0]
  )

  return (
    <motion.div
      className="absolute flex items-center justify-center transform-gpu"
      style={{
        x,
        y,
        scale,
        opacity,
        rotate,
        zIndex: 120,
      }}
    >
      <div className="nb-border nb-shadow relative w-[80vw] max-w-[352px] overflow-hidden rounded-3xl bg-card p-4 sm:w-[86vw] sm:max-w-[480px] sm:p-7 md:max-w-[560px] lg:max-w-[620px]">
        <div className="flex flex-col gap-2.5 sm:gap-3.5">
          <div className="flex items-center gap-2 text-[#b3341f]">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-wider sm:text-xs">
              {t("promoLabel")}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-extrabold text-card-foreground sm:text-xl md:text-2xl">
              {t("promoTitle")}
            </h3>
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {t("promoDescription")}
            </p>
          </div>

          <div>
            <span className="nb-border-sm nb-shadow-sm inline-block rounded-full bg-[#b3341f] px-4 py-1.5 text-xs font-black text-white sm:px-5 sm:py-2">
              {t("promoBadge")}
            </span>
          </div>
        </div>

        <div className="my-4 h-px w-full bg-border/60 sm:my-5" />

        <div className="flex flex-col items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground sm:text-xs">
            {t("categories")}
          </span>
          <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:gap-3">
            {CATEGORY_CHIPS.map((category) => {
              const label = locale === "vi" ? category.labelVi : category.labelEn
              return (
                <Link
                  key={category.id}
                  href="/menu"
                  className="nb-border-sm nb-shadow-sm nb-press-sm flex items-center gap-1 rounded-full bg-card px-4 py-1.5 text-xs font-extrabold text-foreground transition-all hover:bg-muted/80 sm:px-5 sm:py-2"
                >
                  <span>{label}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

const WINDOW_RADIUS = 2
const PRELOAD_BUFFER = 2
const PRELOAD_RADIUS = WINDOW_RADIUS + PRELOAD_BUFFER

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isMobileView, setIsMobileView] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  })

  const displayItems = items.length > 0 ? items : []
  const totalCount = displayItems.length + 1

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const step = 1 / Math.max(totalCount, 1)
    const nextIndex = Math.min(totalCount - 1, Math.max(0, Math.round(latest / (step * 0.7))))
    setActiveIndex((current) => (current === nextIndex ? current : nextIndex))
  })

  if (displayItems.length === 0) return null

  return (
    <section ref={containerRef} className="relative h-[320vh] sm:h-[360vh] md:h-[400vh] bg-[#070504]">
      <div className="sticky top-0 flex h-dvh w-full flex-col items-center justify-between overflow-hidden py-6 sm:py-8 md:py-12">
        {/* Ambient background glows */}
        <div className="pointer-events-none absolute -left-20 top-1/3 h-[300px] w-[300px] rounded-full bg-primary/10 blur-[100px] sm:-left-32 sm:h-[500px] sm:w-[500px] sm:blur-[150px]" />
        <div className="pointer-events-none absolute -right-20 bottom-1/3 h-[300px] w-[300px] rounded-full bg-accent/10 blur-[100px] sm:-right-32 sm:h-[500px] sm:w-[500px] sm:blur-[150px]" />

        {/* Section Title */}
        <div className="relative z-10 text-center px-4">
          <div className="flex items-center justify-center gap-2 text-accent">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-extrabold uppercase tracking-widest">Craft & Motion</span>
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-4xl md:text-5xl">{t("bestSellers")}</h2>
          <p className="mt-1 text-xs text-white/60 md:text-sm">Scroll down to explore signature creations</p>
        </div>

        {/* Arc Trajectory Motion Viewport across ALL devices */}
        <div className="relative flex h-full w-full items-center justify-center">
          {displayItems.map((item, index) => {
            if (Math.abs(index - activeIndex) > WINDOW_RADIUS) return null
            return (
              <ArcItem
                key={item.id}
                item={item}
                index={index}
                total={totalCount}
                scrollYProgress={scrollYProgress}
              />
            )
          })}

          {displayItems.map((item, index) => {
            if (!isInPreloadBuffer(index, activeIndex, WINDOW_RADIUS, PRELOAD_RADIUS)) return null
            return <PreloadImage key={`preload-${item.id}`} item={item} />
          })}

          {/* Final Arc Item: Merged Promotion Card & Category Buttons */}
          {Math.abs(totalCount - 1 - activeIndex) <= WINDOW_RADIUS && (
            <ArcPromotionItem total={totalCount} scrollYProgress={scrollYProgress} />
          )}
        </div>

        {/* Footer Navigation Link */}
        <div className="relative z-10 px-4">
          <Link
            href="/menu"
            className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-xs font-extrabold text-white backdrop-blur-md transition-all hover:bg-primary sm:px-6 sm:py-2.5 sm:text-sm"
          >
            <span>{t("viewAll")}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
