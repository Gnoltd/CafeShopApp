"use client"

import { AnimatePresence, motion } from "framer-motion"
import { usePathname } from "@/i18n/navigation"

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {/* Opacity-only: any transform here (e.g. an x slide) creates a CSS
          containing block, which would silently break every descendant
          `position: fixed` element (View Cart bar, bottom sheets, ...) into
          positioning relative to this page's content box instead of the
          real viewport. */}
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
