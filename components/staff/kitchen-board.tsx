"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Coffee, CornerUpLeft, ShoppingBag, Utensils } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatOrderId } from "@/lib/format"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { PREV_ITEM_STATUS } from "@/hooks/useKitchenOrders"
import type { KdsStatus, KdsOrder } from "@/hooks/useKitchenOrders"

const COLUMNS: { status: KdsStatus; key: "columnNew" | "columnPreparing" | "columnReady"; dot: string }[] = [
  { status: "paid", key: "columnNew", dot: "bg-primary" },
  { status: "preparing", key: "columnPreparing", dot: "bg-amber-600" },
  { status: "ready", key: "columnReady", dot: "bg-success" },
]

export function formatElapsed(createdAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export type UrgencyLevel = "normal" | "warning" | "critical"

export function urgencyLevelFor(createdAt: number, now: number): UrgencyLevel {
  const minutes = (now - createdAt) / 60000
  return minutes >= 15 ? "critical" : minutes >= 10 ? "warning" : "normal"
}

export type PaymentAction = "mark-table-cash" | "confirm-table-cash" | "confirm-pickup-cash" | null

export function paymentActionForOrder(order: KdsOrder): PaymentAction {
  if (order.status === "pending_payment" && order.orderType === "pickup" && order.paymentMethod === "cash") {
    return "confirm-pickup-cash"
  }
  if (order.status !== "served" || order.paymentStatus !== "pending") return null
  if (order.orderType === "dine-in") {
    return order.paymentMethod === "cash" ? "confirm-table-cash" : order.paymentMethod === null ? "mark-table-cash" : null
  }
  return order.paymentMethod === "cash" ? "confirm-pickup-cash" : null
}

// The item furthest along the preparing->ready->served sequence -- the one
// a mis-tap most likely just advanced. Mirrors `next` (the first
// not-yet-served item the main CTA advances) from the opposite end, so a
// single "back" affordance stays meaningful without tracking a full
// per-item undo history.
export function regressTargetFor(order: KdsOrder) {
  return [...order.items].reverse().find((item) => PREV_ITEM_STATUS[item.status] !== null) ?? null
}

export function itemOptionsText(item: KdsOrder["items"][number], locale: string): string {
  const parts: string[] = []
  if (item.sizeName) parts.push(item.sizeName)
  for (const modifier of item.modifierNames) parts.push(locale === "vi" ? modifier.nameVi : modifier.nameEn)
  return parts.join(" · ")
}

export function KitchenBoard({
  orders,
  now,
  onAdvanceItem,
  onRegressItem,
  isItemPending,
  onPaymentAction,
}: {
  orders: KdsOrder[]
  now: number
  onAdvanceItem: (orderId: string, itemId: string) => void
  onRegressItem: (orderId: string, itemId: string) => void
  isItemPending: (orderId: string, itemId: string) => boolean
  onPaymentAction: (order: KdsOrder, action: PaymentAction) => void
}) {
  const t = useTranslations("KitchenDisplay")
  const locale = useLocale()
  const [mobileColumn, setMobileColumn] = useState<KdsStatus>("paid")

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SegmentedControl
        variant="tabs"
        layoutId="kds-mobile-columns"
        className="mb-3 md:hidden"
        value={mobileColumn}
        onChange={setMobileColumn}
        options={COLUMNS.map(({ status, key }) => ({ value: status, label: t(key) }))}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-3">
        {COLUMNS.map((column, index) => {
          const tickets = orders.filter(
            (order) =>
              order.status === column.status ||
              (column.status === "paid" && order.status === "pending_payment") ||
              (column.status === "ready" && order.status === "served")
          )
          return (
            <section
              key={column.status}
              className={cn(
                "min-h-0 flex-col overflow-hidden border-border md:flex md:border-r-2",
                index === 2 && "md:border-r-0",
                mobileColumn === column.status ? "flex" : "hidden md:flex"
              )}
            >
              <header className="flex shrink-0 items-center gap-2.5 border-b-[2.5px] border-ink bg-chip px-4 py-3">
                <span className={cn("size-2.5 rounded-sm", column.dot)} />
                <h2 className="flex-1 text-[13px] font-extrabold">{t(column.key)}</h2>
                <span className="nb-border-sm rounded-full bg-card px-2 py-0.5 text-xs font-extrabold">{tickets.length}</span>
              </header>
              <div className="kds-col flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
                {tickets.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-xl border-[2.5px] border-dashed border-border px-4 py-7 text-center text-xs font-bold text-muted-foreground">
                    <Coffee className="size-6" />
                    {t("empty")}
                  </div>
                )}
                {tickets.map((order) => (
                  <Ticket
                    key={order.id}
                    order={order}
                    now={now}
                    locale={locale}
                    onAdvanceItem={onAdvanceItem}
                    onRegressItem={onRegressItem}
                    isItemPending={isItemPending}
                    onPaymentAction={onPaymentAction}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Ticket({
  order,
  now,
  locale,
  onAdvanceItem,
  onRegressItem,
  isItemPending,
  onPaymentAction,
}: {
  order: KdsOrder
  now: number
  locale: string
  onAdvanceItem: (orderId: string, itemId: string) => void
  onRegressItem: (orderId: string, itemId: string) => void
  isItemPending: (orderId: string, itemId: string) => boolean
  onPaymentAction: (order: KdsOrder, action: PaymentAction) => void
}) {
  const t = useTranslations("KitchenDisplay")
  const next = order.items.find((item) => item.status !== "served")
  const done = order.items.filter((item) => item.status === "served").length
  const late = now - order.createdAt >= 600000
  const paymentAction = paymentActionForOrder(order)
  const regressTarget = regressTargetFor(order)

  return (
    <article className="nb-border nb-shadow-sm flex flex-col gap-3 rounded-xl bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-none font-extrabold">#{formatOrderId(order.id)}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={cn(
                "nb-border-sm inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                order.orderType === "pickup" ? "bg-chip" : "bg-accent text-accent-foreground"
              )}
            >
              {order.orderType === "pickup" ? <ShoppingBag className="size-3" /> : <Utensils className="size-3" />}
              {order.orderType === "pickup" ? t("pickup") : t("table", { table: order.table ?? "" })}
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {new Date(order.createdAt).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={cn("text-xl leading-none font-extrabold", late ? "text-destructive" : "text-card-foreground")}>
            {formatElapsed(order.createdAt, now)}
          </p>
          <p className="mt-1 text-[10px] font-bold text-muted-foreground">
            {done}/{order.items.length} {t("itemsLabel")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {order.items.map((item) => {
          // Three real statuses (preparing/ready/served), not two -- a
          // checkbox that only lit up at "served" made the first tap on any
          // item (preparing -> ready) show *no visible change at all* on
          // the item itself, with the only externally visible effect being
          // the whole ticket relocating to a different column a moment
          // later. That disconnect between "what I tapped" and "what
          // changed" is what read as taps not registering / the board
          // jumping on its own. Every status now gets its own look.
          const served = item.status === "served"
          const ready = item.status === "ready"
          const optionsText = itemOptionsText(item, locale)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onAdvanceItem(order.id, item.id)}
              disabled={served || order.status === "pending_payment" || isItemPending(order.id, item.id)}
              className="flex items-start gap-2 text-left disabled:pointer-events-none"
            >
              <span
                className={cn(
                  "nb-border-sm mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px]",
                  served ? "bg-success text-white" : ready ? "bg-warn text-white" : "bg-card"
                )}
              >
                {(served || ready) && <Check className="size-3" />}
              </span>
              <span className={cn("min-w-0 flex-1 text-sm font-extrabold leading-tight", served && "text-muted-foreground line-through")}>
                {item.quantity}× {locale === "vi" ? item.nameVi : item.nameEn}
                {ready && <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-warn no-underline">{t("readyLabel")}</span>}
                {optionsText && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground no-underline">{optionsText}</span>
                )}
                {item.note && <span className="mt-1 block text-[11px] font-semibold text-muted-foreground no-underline">{item.note}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {paymentAction ? (
        <button
          type="button"
          onClick={() => onPaymentAction(order, paymentAction)}
          className="nb-border nb-shadow nb-press h-10 rounded-lg bg-secondary text-xs font-extrabold uppercase tracking-wide text-secondary-foreground"
        >
          {paymentAction === "mark-table-cash" ? t("markCash") : t("confirmCashReceived")}
        </button>
      ) : next ? (
        <div className="flex items-center gap-2">
          {regressTarget && (
            <button
              type="button"
              onClick={() => onRegressItem(order.id, regressTarget.id)}
              disabled={isItemPending(order.id, regressTarget.id)}
              aria-label={t("undoItem")}
              title={t("undoItem")}
              className="nb-border nb-shadow-sm nb-press flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground disabled:opacity-40"
            >
              <CornerUpLeft className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onAdvanceItem(order.id, next.id)}
            disabled={isItemPending(order.id, next.id)}
            className={cn(
              "nb-border nb-shadow nb-press h-10 flex-1 rounded-lg text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-40",
              next.status === "ready" ? "bg-success" : "bg-primary"
            )}
          >
            {order.status === "paid" && next.status === "preparing"
              ? t("startPreparing")
              : next.status === "ready"
                ? t("markServed")
                : t("markReady")}
          </button>
        </div>
      ) : order.status === "served" && order.paymentStatus === "pending" ? (
        <p className="rounded-md bg-warn/15 px-2 py-2 text-center text-xs font-bold text-warn">{t("awaitingGatewayPayment")}</p>
      ) : null}
    </article>
  )
}
