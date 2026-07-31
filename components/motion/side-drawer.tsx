"use client"

import { motion, type PanInfo } from "framer-motion"

// No internal AnimatePresence: this component's exit animation only plays
// if the CALLER wraps its conditional render (`{open && <SideDrawer/>}`) in
// its own <AnimatePresence> — an AnimatePresence here would get unmounted
// in the same commit as everything else the moment the caller stops
// rendering this component, so it would never see the removal happen while
// still mounted. See docs/superpowers/specs/2026-07-31-responsive-device-audit-design.md (RC-7).
export function SideDrawer({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.x < -80 || info.velocity.x < -500) onClose()
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-stretch justify-start bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="nb-border border-y-0 border-l-0 flex h-full w-72 max-w-[80vw] flex-col overflow-hidden bg-card"
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragEnd={handleDragEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
