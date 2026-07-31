"use client"

import { motion, type PanInfo } from "framer-motion"
import { useVisualViewportHeight } from "@/hooks/useVisualViewportHeight"

// No internal AnimatePresence: this component's exit animation only plays
// if the CALLER wraps its conditional render (`{open && <BottomSheet/>}`) in
// its own <AnimatePresence> — an AnimatePresence here would get unmounted
// in the same commit as everything else the moment the caller stops
// rendering this component, so it would never see the removal happen while
// still mounted. See docs/superpowers/specs/2026-07-31-responsive-device-audit-design.md (RC-7).
export function BottomSheet({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  const viewportHeight = useVisualViewportHeight()

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose()
  }

  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-[60] flex h-dvh items-end justify-center bg-black/40 md:backdrop-blur-xs sm:items-center sm:p-4"
      style={viewportHeight ? { height: viewportHeight } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="nb-border border-x-0 border-b-0 sm:border-x-2 sm:border-b-2 flex w-full max-w-sm md:max-w-md max-h-[85%] flex-col overflow-y-auto rounded-t-2xl bg-card sm:rounded-2xl"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={handleDragEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
