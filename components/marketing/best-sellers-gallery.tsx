"use client"

import { useRef } from "react"
import { motion } from "framer-motion"
import { useLocale, useTranslations } from "next-intl"
import { ChevronRight, Sparkles } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

export function BestSellersGallery({ items }: { items: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const scrollRef = useRef<HTMLDivElement>(null)

  const displayItems = items.length > 0 ? items : []

  if (displayItems.length === 0) return null

  return (
    <section className="relative overflow-hidden bg-[#0a0705] py-14 md:py-24">
      {/* Background ambient radial light */}
      <div className="pointer-events-none absolute -left-20 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-20 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]" />

      <div className="relative mx-auto w-full max-w-7xl px-4 md:px-8">
        {/* Section Header */}
        <div className="mb-8 flex items-end justify-between md:mb-12">
          <div>
            <div className="flex items-center gap-2 text-accent">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-extrabold uppercase tracking-widest">PhaDin Selection</span>
            </div>
            <h2 className="mt-1 text-3xl font-black text-white md:text-5xl">{t("bestSellers")}</h2>
            <div className="mt-2 h-1 w-16 rounded-full bg-primary" />
          </div>

          <Link
            href="/menu"
            className="group flex items-center gap-1 text-sm font-extrabold text-accent transition-colors hover:text-white"
          >
            <span>{t("viewAll")}</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        {/* Horizontal Scroll Motion Track */}
        <div
          ref={scrollRef}
          className="no-scrollbar flex w-full snap-x snap-mandatory gap-5 overflow-x-auto pb-6 pt-2 md:gap-8"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {displayItems.map((item, index) => {
            const name = locale === "vi" ? item.nameVi : item.nameEn

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: 40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.06 }}
                className="group relative flex w-[280px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-[#140e0a] p-3.5 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:bg-[#1a120d] hover:shadow-primary/10 sm:w-[340px] md:w-[400px] md:p-4"
              >
                <Link href={`/menu/${item.id}` as any} className="block w-full overflow-hidden rounded-xl">
                  <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-muted">
                    <ItemImage
                      item={item}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-80 transition-opacity group-hover:opacity-60" />
                    
                    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between text-white md:bottom-4 md:left-5 md:right-5">
                      <div className="max-w-[70%]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-accent md:text-xs">
                          Best Seller
                        </p>
                        <h4 className="line-clamp-1 text-base font-extrabold md:text-xl">{name}</h4>
                      </div>
                      <span className="rounded-full bg-primary/95 px-3 py-1 text-xs font-black text-primary-foreground shadow-md backdrop-blur-md md:text-sm">
                        {formatVND(item.basePrice)}
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
