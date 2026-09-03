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
import type { TableRecord } from "@/hooks/useTables"
import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
import type { AddToCartInput } from "@/hooks/useCart"

export function TableOrderingSession({
  table,
  qrToken,
  categories,
  items,
  initialTab = "menu",
}: {
  table: TableRecord
  qrToken: string
  categories: MenuCategory[]
  items: MenuItem[]
  initialTab?: "menu" | "order"
}) {
  const t = useTranslations("TableSession")
  const session = useTableSession(qrToken)
  const [tab, setTab] = useState<"menu" | "order">(initialTab)
  const [isPlacingRound, setIsPlacingRound] = useState(false)
  const [placeOrderError, setPlaceOrderError] = useState<string | null>(null)
  const [addItemError, setAddItemError] = useState<string | null>(null)
  const [isCheckBillOpen, setIsCheckBillOpen] = useState(false)

  function handleAddItem(item: AddToCartInput) {
    setAddItemError(null)
    session
      .addItem({
        menuItemId: item.menuItemId,
        sizeId: item.size?.id ?? null,
        modifierIds: item.modifiers.map((m) => m.optionId),
        note: item.note ?? null,
      })
      .catch(() => setAddItemError(t("addItemError")))
  }

  function handleUpdateQuantity(cartItemId: string, quantity: number) {
    session.updateQuantity(cartItemId, quantity).catch((error: unknown) => {
      setAddItemError(error instanceof Error && error.message === "stale_cart_item" ? t("cartChangedRetry") : t("cartUpdateError"))
      session.refetch().catch(() => {})
    })
  }

  async function handlePlaceOrder() {
    setPlaceOrderError(null)
    setIsPlacingRound(true)
    try {
      await session.placeRound()
      setTab("order")
    } catch {
      setPlaceOrderError(t("placeOrderFailed"))
    } finally {
      setIsPlacingRound(false)
    }
  }

  if (session.isLoading) return null

  return (
    <div className="mx-auto w-full max-w-2xl md:max-w-6xl">
      <div className="px-4 pt-4 sm:px-6">
        <SegmentedControl
          layoutId="table-session-tab-pill"
          value={tab}
          onChange={setTab}
          options={[
            { value: "menu" as const, label: t("menuTabLabel") },
            { value: "order" as const, label: `${t("orderTabLabel")}${session.cartItems.length > 0 ? ` (${session.cartItems.length})` : ""}` },
          ]}
        />
      </div>

      {addItemError && (
        <p className="mx-4 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive sm:mx-6">{addItemError}</p>
      )}

      {tab === "menu" ? (
        <MenuBrowser
          categories={categories}
          items={items}
          onAddItem={handleAddItem}
          cartItemCount={session.cartItems.reduce((sum, i) => sum + i.quantity, 0)}
          cartSubtotal={session.cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)}
        />
      ) : (
        <TableCartPanel
          cartItems={session.cartItems}
          rounds={session.rounds}
          unpaidTotal={session.unpaidTotal}
          paymentPending={session.paymentPending}
          isPlacingRound={isPlacingRound}
          placeOrderError={placeOrderError}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={session.removeItem}
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
          qrToken={qrToken}
          unpaidTotal={session.unpaidTotal}
          onClose={() => setIsCheckBillOpen(false)}
          onSuccess={() => {
            setIsCheckBillOpen(false)
            session.refetch()
          }}
        />
      )}
    </div>
  )
}
