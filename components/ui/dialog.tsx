"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The single accessible Dialog module for this app (Task 6, 2026-09-02).
 *
 * It is a thin styled wrapper over `@base-ui/react/dialog`, which already
 * implements — correctly, and better than anything hand-rolled here would —
 * focus trap, focus restore on close/unmount, Escape-to-close,
 * outside-press dismissal, `role="dialog"` + `aria-modal`, `aria-labelledby`
 * wiring from `Dialog.Title`, `aria-describedby` from `Dialog.Description`,
 * scroll locking, and `inert` + `aria-hidden` on all background content
 * (`floating-ui-react/utils/markOthers`). Nothing in this file re-implements
 * any of that: if a behaviour is missing, the fix belongs in how we call the
 * primitive, never in bespoke focus/inert bookkeeping.
 *
 * Layout is split across three parts, mirroring the primitive:
 * `DialogBackdrop` paints the scrim, `DialogViewport` positions (it is the
 * full-screen flex container), and `DialogPopup` is the surface itself. The
 * popup therefore carries **no** `position`/`translate` classes of its own,
 * which is what lets `BottomSheet`/`SideDrawer` hand it a `motion.div` via
 * `render` without framer-motion's inline `transform` fighting a Tailwind
 * `-translate-*` utility for the same property.
 *
 * Two mounting styles are supported, because the codebase already has both:
 *
 * 1. **Controlled** (`open` / `onOpenChange`) — the normal shape. Enter/exit
 *    animate via `data-starting-style` / `data-ending-style`.
 * 2. **Mount-to-open** (`open` hardcoded true while the caller conditionally
 *    renders the whole subtree, as `BottomSheet`/`SideDrawer` callers do
 *    inside their own `<AnimatePresence>`). Focus restore still works in this
 *    shape: Base UI returns focus from the focus manager's effect *cleanup*,
 *    which runs on unmount, not only on an `open: true -> false` transition.
 */

const DialogRoot = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

const dialogViewportVariants = cva("fixed inset-0 z-50 flex", {
  variants: {
    align: {
      /** Centered card — admin forms, confirmations. */
      center: "items-center justify-center p-4",
      /** Bottom sheet on mobile, centered card from `sm` up. */
      sheet: "items-end justify-center sm:items-center sm:p-4",
      /** Left-anchored drawer — the admin mobile nav. */
      drawer: "items-stretch justify-start",
      /** Edge-to-edge surface — the camera QR scanner. */
      fullscreen: "items-stretch justify-stretch",
    },
  },
  defaultVariants: { align: "center" },
})

function DialogViewport({
  className,
  align,
  ...props
}: DialogPrimitive.Viewport.Props & VariantProps<typeof dialogViewportVariants>) {
  return (
    <DialogPrimitive.Viewport
      data-slot="dialog-viewport"
      className={cn(dialogViewportVariants({ align }), className)}
      {...props}
    />
  )
}

const dialogPopupVariants = cva("flex flex-col outline-none", {
  variants: {
    variant: {
      card: "nb-border nb-shadow max-h-[90vh] w-full overflow-hidden rounded-xl bg-card text-card-foreground transition-[opacity,transform] duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none",
      sheet:
        "nb-border max-h-[85%] w-full overflow-y-auto rounded-t-2xl border-x-0 border-b-0 bg-card text-card-foreground sm:rounded-2xl sm:border-x-2 sm:border-b-2",
      drawer:
        "nb-border h-full w-72 max-w-[80vw] overflow-hidden border-y-0 border-l-0 bg-card text-card-foreground",
      fullscreen: "h-full w-full bg-black text-white",
      /** No chrome at all: the caller owns every paint/sizing class. */
      bare: "",
    },
    size: {
      sm: "max-w-sm",
      md: "max-w-md",
      lg: "max-w-lg",
      xl: "max-w-2xl",
      full: "",
    },
  },
  defaultVariants: { variant: "card", size: "sm" },
})

function DialogPopup({
  className,
  variant,
  size,
  ...props
}: DialogPrimitive.Popup.Props & VariantProps<typeof dialogPopupVariants>) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-popup"
      className={cn(dialogPopupVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-bold", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/**
 * Title row with a close button. Every dialog needs a `Dialog.Title` for its
 * accessible name, so this is the default header rather than an optional
 * flourish. Pass `description` whenever there is body copy explaining what
 * the dialog is for — it becomes the dialog's `aria-describedby`.
 */
function DialogHeader({
  title,
  description,
  className,
  children,
  showClose = true,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  className?: string
  children?: React.ReactNode
  showClose?: boolean
}) {
  const t = useTranslations("Dialog")

  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "nb-border flex shrink-0 items-start justify-between gap-3 border-x-0 border-t-0 px-6 py-4",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {children}
      </div>
      {showClose ? (
        <DialogClose
          aria-label={t("close")}
          className="nb-border-sm nb-press-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground"
        >
          <X className="h-5 w-5" />
        </DialogClose>
      ) : null}
    </div>
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("flex-1 space-y-4 overflow-y-auto px-6 py-4", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "nb-border flex shrink-0 justify-end gap-2 border-x-0 border-b-0 px-6 py-4",
        className
      )}
      {...props}
    />
  )
}

/**
 * The shell every admin add/edit modal wants: scrim, centered card, titled
 * header with a close button, scrolling body, footer for the action buttons.
 * These forms are mounted/unmounted by their parent rather than toggling an
 * `open` prop, hence the mount-to-open default.
 */
function FormDialog({
  open = true,
  onClose,
  title,
  description,
  size,
  footer,
  className,
  children,
}: {
  open?: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  size?: VariantProps<typeof dialogPopupVariants>["size"]
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport align="center">
          <DialogPopup size={size} className={className}>
            <DialogHeader title={title} description={description} />
            <DialogBody>{children}</DialogBody>
            {footer ? <DialogFooter>{footer}</DialogFooter> : null}
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  )
}

/**
 * The four Task 6 confirmations (menu deletion, QR regeneration, cash
 * received, mark out of stock) plus the promotion deletion that used to be a
 * `window.confirm` are structurally identical — title, explanatory body,
 * cancel + confirm — so they share this wrapper instead of each hand-rolling
 * a popup. `onConfirm` may be async: the confirm button holds its pending
 * state and the dialog refuses to be dismissed until it settles, so a slow or
 * failing mutation can never look like it silently succeeded.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  pendingLabel?: React.ReactNode
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}) {
  const t = useTranslations("Dialog")
  const [isPending, setIsPending] = React.useState(false)

  async function handleConfirm() {
    setIsPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        // Never let a dismissal (Escape, backdrop press, close button) drop
        // the dialog while the confirmed action is still in flight.
        if (isPending && !nextOpen) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport align="center">
          <DialogPopup size="sm">
            <DialogHeader title={title} description={description} showClose={!isPending} />
            <DialogFooter>
              <Button
                variant="neubrutal"
                className="bg-card text-foreground"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                {cancelLabel ?? t("cancel")}
              </Button>
              <Button
                variant="neubrutal"
                className={destructive ? "bg-destructive text-destructive-foreground" : undefined}
                disabled={isPending}
                onClick={handleConfirm}
              >
                {isPending ? (pendingLabel ?? t("working")) : (confirmLabel ?? t("confirm"))}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  )
}

export {
  ConfirmDialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
  FormDialog,
  dialogPopupVariants,
  dialogViewportVariants,
}
