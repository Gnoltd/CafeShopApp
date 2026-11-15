"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/dialog"
import { MenuBrowser } from "@/components/customer/menu-browser"
import { TableCartPanel } from "@/components/customer/table-cart-panel"
import { CheckBillSheet } from "@/components/customer/check-bill-sheet"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { useTableSession } from "@/hooks/useTableSession"
import type { TableSessionPort } from "@/lib/supabase/table-session-data"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import type { MenuItemSelection } from "@/lib/menu-selection-types"
import { AsyncRetryError, AsyncSkeleton, StaleNotice } from "@/components/shared/async-state"

export function TableOrderingSession({
  qrToken,
  categories,
  items,
  initialTab = "menu",
  port,
}: {
  qrToken: string
  categories: MenuCategory[]
  items: MenuItem[]
  initialTab?: "menu" | "order"
  port?: TableSessionPort
}) {
  const t = useTranslations("TableSession")
  const session = useTableSession(qrToken, port ? { port } : undefined)
  const [tab, setTab] = useState<"menu" | "order">(initialTab)
  const [isCheckBillOpen, setIsCheckBillOpen] = useState(false)

  function handleAddItem(item: MenuItemSelection) {
    void session.addItem(item)
  }

  function handleUpdateQuantity(cartItemId: string, quantity: number) {
    void session.updateQuantity(cartItemId, quantity)
  }

  function handleRemoveItem(cartItemId: string) {
    void session.removeItem(cartItemId)
  }

  async function handlePlaceOrder() {
    const placed = await session.placeRound()
    if (placed) setTab("order")
  }

  if (session.isLoading) return <AsyncSkeleton variant="page" />

  if (session.hasLoadError) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-6">
        <AsyncRetryError onRetry={session.retryLoad} />
      </div>
    )
  }

  const cartErrorMessage =
    session.error === "add_item"
      ? t("addItemError")
      : session.error === "stale_cart_item"
        ? t("cartChangedRetry")
        : session.error === "cart_update"
          ? t("cartUpdateError")
          : null

  const placeOrderErrorMessage =
    session.error === "place_round" ? t("placeOrderFailed") : null

  return (
    <div className="mx-auto w-full max-w-2xl md:max-w-6xl">
      {session.hasStaleData && (
        <div className="px-4 pt-4 sm:px-6">
          <StaleNotice onRetry={session.refetch} />
        </div>
      )}

      <div className="px-4 pt-4 sm:px-6">
        <SegmentedControl
          layoutId="table-session-tab-pill"
          value={tab}
          onChange={setTab}
          options={[
            { value: "menu" as const, label: t("menuTabLabel") },
            {
              value: "order" as const,
              label: `${t("orderTabLabel")}${session.cartItems.length > 0 ? ` (${session.cartItems.length})` : ""}`,
            },
          ]}
        />
      </div>

      {cartErrorMessage && (
        <p className="mx-4 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive sm:mx-6">
          {cartErrorMessage}
        </p>
      )}

      {tab === "menu" ? (
        <MenuBrowser
          categories={categories}
          items={items}
          onAddItem={handleAddItem}
          cartItemCount={session.cartItems.reduce((sum, i) => sum + i.quantity, 0)}
          cartSubtotal={session.cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)}
          onViewCart={() => setTab("order")}
        />
      ) : (
        <TableCartPanel
          cartItems={session.cartItems}
          rounds={session.rounds}
          unpaidTotal={session.unpaidTotal}
          paymentPending={session.paymentPending}
          isPlacingRound={session.isPlacingRound}
          placeOrderError={placeOrderErrorMessage}
          pendingCartItemIds={session.pendingCartItemIds}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onPlaceOrder={handlePlaceOrder}
          onOpenCheckBill={() => setIsCheckBillOpen(true)}
        />
      )}

      {session.showIdlePrompt && (
        <DialogRoot
          open
          onOpenChange={(nextOpen) => {
            // "Are you still here?" is a question that has to be answered —
            // dismissing it by Escape/backdrop would leave the session in the
            // same idle limbo that raised it, so only the two buttons resolve
            // it. (`disablePointerDismissal` covers the backdrop; the no-op
            // handler covers Escape.)
            if (!nextOpen) return
          }}
          disablePointerDismissal
        >
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport align="sheet">
              <DialogPopup variant="sheet" size="sm" className="nb-shadow p-6">
                <DialogTitle className="mb-2">{t("idlePromptTitle")}</DialogTitle>
                <DialogDescription className="mb-4">{t("idlePromptBody")}</DialogDescription>
                <div className="flex flex-col gap-2">
                  <Button variant="neubrutal" className="h-11 w-full" onClick={session.confirmStillHere}>
                    {t("idlePromptYes")}
                  </Button>
                  <Button variant="ghost" className="h-11 w-full" onClick={session.dismissAndAbandon}>
                    {t("idlePromptNo")}
                  </Button>
                </div>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </DialogRoot>
      )}

      {isCheckBillOpen && (
        <CheckBillSheet
          unpaidTotal={session.unpaidTotal}
          onConfirm={session.requestBill}
          onClose={() => setIsCheckBillOpen(false)}
          onSuccess={() => setIsCheckBillOpen(false)}
        />
      )}
    </div>
  )
}
