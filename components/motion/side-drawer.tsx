"use client"

import { motion, type PanInfo } from "framer-motion"
import {
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogViewport,
} from "@/components/ui/dialog"

// No internal AnimatePresence: this component's exit animation only plays
// if the CALLER wraps its conditional render (`{open && <SideDrawer/>}`) in
// its own <AnimatePresence> — an AnimatePresence here would get unmounted
// in the same commit as everything else the moment the caller stops
// rendering this component, so it would never see the removal happen while
// still mounted. See docs/superpowers/specs/2026-07-31-responsive-device-audit-design.md (RC-7).
//
// Accessibility (Task 6, 2026-09-02): same visual shell, now built on Base
// UI's Dialog so focus trap/restore, Escape, `aria-modal` and the `inert`
// background come from the primitive. See components/ui/dialog.tsx for why
// `open` is hardcoded here. Children supply their own <DialogTitle>.
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
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop
          render={
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          }
        />
        <DialogViewport align="drawer">
          <DialogPopup
            variant="drawer"
            size="full"
            render={
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.5, right: 0 }}
                onDragEnd={handleDragEnd}
              />
            }
          >
            {children}
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  )
}
