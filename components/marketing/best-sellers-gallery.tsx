"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const STAGGER_OFFSETS = [-15, 8, -10, 18, -5, 12, -12, 15, -8, 10]

function GalleryCard({ item, index }: { item: MenuItem; index: number }) {
  const locale = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  const clipInset = useTransform(scrollYProgress, [0, 0.4, 0.8], ["20%", "0%", "0%"])
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [1.35, 1.05, 1.0])
  const offsetX = STAGGER_OFFSETS[index % STAGGER_OFFSETS.length]
  const name = locale === "vi" ? item.nameVi : item.nameEn

  return (
    <motion.div
      ref={ref}
      className="relative my-4 w-[75%] max-w-[550px] overflow-hidden rounded-2xl bg-[#140e0a] p-3 shadow-2xl md:my-6 md:w-[65%] md:max-w-[700px] md:p-4"
      style={{
        x: `${offsetX}%`,
      }}
    >
      <Link href="/menu" className="group block overflow-hidden rounded-xl">
        <motion.div
          className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted"
          style={{
            clipPath: useTransform(clipInset, (v) => `inset(${v} 0%)`),
          }}
        >
          <motion.div className="h-full w-full" style={{ scale }}>
            <ItemImage item={item} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
          </motion.div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-60" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-6 md:right-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-accent">PhaDin Selection</p>
              <h4 className="text-lg font-extrabold md:text-2xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary/90 px-3 py-1 text-sm font-black text-primary-foreground shadow-md backdrop-blur-md">
              {formatVND(item.basePrice)}
            </span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  )
}

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const t = useTranslations("Landing")
  const displayItems = items.length > 0 ? items : []

  if (displayItems.length === 0) return null

  return (
    <section className="relative overflow-hidden bg-[#0a0705] py-16 md:py-24">
      <div className="mx-auto flex flex-col items-center px-4">
        <div className="mb-10 text-center md:mb-16">
          <span className="text-xs font-extrabold uppercase tracking-widest text-accent">Craft & Passion</span>
          <h2 className="mt-1 text-3xl font-black text-white md:text-5xl">{t("bestSellers")}</h2>
          <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-primary" />
        </div>

        <div className="flex w-full flex-col items-center">
          {displayItems.map((item, index) => (
            <GalleryCard key={item.id} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
