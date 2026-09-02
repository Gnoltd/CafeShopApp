"use client"

import { motion, type PanInfo } from "framer-motion"
import {
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogViewport,
} from "@/components/ui/dialog"
import { useVisualViewportHeight } from "@/hooks/useVisualViewportHeight"

// No internal AnimatePresence: this component's exit animation only plays
// if the CALLER wraps its conditional render (`{open && <BottomSheet/>}`) in
// its own <AnimatePresence> — an AnimatePresence here would get unmounted
// in the same commit as everything else the moment the caller stops
// rendering this component, so it would never see the removal happen while
// still mounted. See docs/superpowers/specs/2026-07-31-responsive-device-audit-design.md (RC-7).
//
// Accessibility (Task 6, 2026-09-02): the visual shell is unchanged, but the
// markup is now Base UI's Dialog — focus trap + restore, Escape, `aria-modal`,
// and `inert` background all come from the primitive rather than being
// missing. `open` is hardcoded because callers mount/unmount this component
// instead of toggling a prop; Base UI restores focus from its focus-manager
// effect cleanup, so unmounting is a real close as far as focus is concerned.
// Children still supply their own <DialogTitle> for the accessible name.
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
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop
          className="z-[60] md:backdrop-blur-xs"
          render={
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          }
        />
        <DialogViewport
          align="sheet"
          className="top-0 bottom-auto z-[60] h-dvh"
          style={viewportHeight ? { height: viewportHeight } : undefined}
        >
          <DialogPopup
            variant="sheet"
            className="max-w-sm md:max-w-md"
            render={
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.5 }}
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
