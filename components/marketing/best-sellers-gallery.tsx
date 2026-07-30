"use client"

import { motion } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

const STAGGER_OFFSETS = [-10, 8, -6, 12, -4, 10, -8, 6]

function GalleryCard({ item, index }: { item: MenuItem; index: number }) {
  const locale = useLocale()
  const offsetX = STAGGER_OFFSETS[index % STAGGER_OFFSETS.length]
  const name = locale === "vi" ? item.nameVi : item.nameEn

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      className="relative my-4 w-[85%] max-w-[550px] overflow-hidden rounded-2xl bg-[#140e0a] p-3 shadow-2xl md:my-6 md:w-[70%] md:max-w-[700px] md:p-4"
      style={{
        x: `${offsetX}%`,
      }}
    >
      <Link href={`/menu/${item.id}` as any} className="group block overflow-hidden rounded-xl">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted">
          <ItemImage item={item} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-60" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-6 md:right-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-accent">PhaDin Selection</p>
              <h4 className="text-lg font-extrabold md:text-2xl">{name}</h4>
            </div>
            <span className="rounded-full bg-primary px-3 py-1 text-sm font-black text-primary-foreground shadow-md">
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

