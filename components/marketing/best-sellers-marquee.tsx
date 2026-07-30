"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { useLocale } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ItemImage } from "@/components/customer/item-image"
import { formatVND } from "@/lib/format"
import type { MenuItem } from "@/lib/supabase/menu-data"

export function BestSellersMarquee({ items }: { items: MenuItem[] }) {
  const locale = useLocale()
  const [isPaused, setIsPaused] = useState(false)

  if (!items || items.length === 0) return null

  // Duplicate items to ensure smooth continuous marquee loop
  const marqueeItems = [...items, ...items, ...items]

  return (
    <section className="relative overflow-hidden bg-black py-12 md:py-20">
      <div className="mb-6 px-6 text-center md:mb-10">
        <h3 className="text-xl font-bold uppercase tracking-wider text-white/90 md:text-2xl">
          Signature Stream
        </h3>
        <p className="mt-1 text-xs text-white/60 md:text-sm">Hover to explore details</p>
      </div>

      <div
        className="relative flex w-full overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Gradient edge overlays */}
        <div className="pointer-events-none absolute bottom-0 top-0 left-0 z-10 w-16 bg-gradient-to-r from-black to-transparent md:w-32" />
        <div className="pointer-events-none absolute bottom-0 top-0 right-0 z-10 w-16 bg-gradient-to-l from-black to-transparent md:w-32" />

        <motion.div
          className="flex shrink-0 gap-6 py-4 md:gap-10"
          animate={{ x: isPaused ? undefined : ["0%", "-50%"] }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 35,
              ease: "linear",
            },
          }}
        >
          {marqueeItems.map((item, idx) => {
            const name = locale === "vi" ? item.nameVi : item.nameEn
            const isTall = idx % 2 === 1

            return (
              <Link
                key={`${item.id}-${idx}`}
                href="/menu"
                className="group relative flex shrink-0 flex-col items-center justify-end rounded-2xl bg-[#18120e] p-4 text-center transition-all duration-300 hover:scale-105 hover:bg-[#241b15] hover:shadow-2xl hover:shadow-primary/20"
                style={{
                  width: isTall ? "220px" : "180px",
                  height: isTall ? "320px" : "260px",
                }}
              >
                <div className="relative mb-3 flex h-3/5 w-full items-center justify-center overflow-hidden rounded-xl">
                  <ItemImage
                    item={item}
                    className="h-full w-full object-contain filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                <h4 className="line-clamp-1 text-sm font-bold text-white group-hover:text-primary">
                  {name}
                </h4>
                <span className="mt-1 text-xs font-black text-accent">{formatVND(item.basePrice)}</span>
              </Link>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
