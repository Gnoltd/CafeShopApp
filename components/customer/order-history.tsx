"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronRight, RotateCcw, Check } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { formatOrderId, formatVND } from "@/lib/format"
import { useOrders, type OrderForTracking, type OrderStatus } from "@/hooks/useOrders"
import { useCart } from "@/hooks/useCart"
import { SegmentedControl } from "@/components/motion/segmented-control"
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list"

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  paid: "bg-blue-100 text-blue-800",
  preparing: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  served: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
}

const STATUS_KEYS: Record<
  OrderStatus,
  "statusPendingPayment" | "statusPaid" | "statusPreparing" | "statusReady" | "statusServed" | "statusCompleted" | "statusCancelled"
> = {
  pending_payment: "statusPendingPayment",
  paid: "statusPaid",
  preparing: "statusPreparing",
  ready: "statusReady",
  served: "statusServed",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
}

type Filter = "all" | "active" | "completed"

const FILTERS: { id: Filter; labelKey: "filterAll" | "filterActive" | "filterCompleted" }[] = [
  { id: "all", labelKey: "filterAll" },
  { id: "active", labelKey: "filterActive" },
  { id: "completed", labelKey: "filterCompleted" },
]

function matchesFilter(status: OrderStatus, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "active")
    return status === "pending_payment" || status === "paid" || status === "preparing" || status === "ready" || status === "served"
  return status === "completed" || status === "cancelled"
}

function formatOrderDate(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function OrderHistory() {
  const locale = useLocale()
  const t = useTranslations("OrderHistory")
  const router = useRouter()
  const { myOrders, isLoadingMyOrders } = useOrders()
  const { addItem } = useCart()
  const [filter, setFilter] = useState<Filter>("all")
  const [reorderedId, setReorderedId] = useState<string | null>(null)

  function handleReorder(order: OrderForTracking) {
    order.items.forEach((item) => {
      addItem(
        {
          menuItemId: item.menuItemId,
          nameVi: item.nameVi,
          nameEn: item.nameEn,
          modifiers: (item.modifierIds ?? []).map((id) => ({ groupId: "historic", optionId: id, labelVi: t("historicOption"), labelEn: t("historicOption"), priceDelta: 0 })),
          unitPrice: item.unitPrice,
          ...(item.sizeId ? { size: { id: item.sizeId, label: t("historicOption"), priceDelta: 0 } } : {}),
          ...(item.sizeId || (item.modifierIds?.length ?? 0) > 0 ? { needsConfiguration: true } : {}),
        },
        item.quantity
      )
    })
    setReorderedId(order.id)
    setTimeout(() => router.push("/cart"), 500)
  }

  const sorted = useMemo(() => [...myOrders].sort((a, b) => b.createdAt - a.createdAt), [myOrders])
  const filtered = sorted.filter((order) => matchesFilter(order.status, filter))

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 md:max-w-5xl md:px-8 md:py-4">
      <SegmentedControl
        layoutId="order-history-filter-pill"
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map(({ id, labelKey }) => ({ value: id, label: t(labelKey) }))}
      />

      {isLoadingMyOrders ? (
        <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <StaggerList staggerKey={filter} className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
          {filtered.map((order) => {
            const itemsLabel = order.items
              .map((item) => (locale === "vi" ? item.nameVi : item.nameEn))
              .join(", ")
            return (
              <StaggerItem key={order.id}>
                <div className="nb-border nb-shadow flex flex-col gap-3 rounded-xl bg-card p-4">
                  <Link href={`/orders/${order.id}`} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-card-foreground">#{formatOrderId(order.id)}</span>
                        <span
                          className={cn(
                            "nb-border-sm shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                            STATUS_STYLES[order.status]
                          )}
                        >
                          {t(STATUS_KEYS[order.status])}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatOrderDate(order.createdAt, locale)}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {t("itemCount", { count: order.items.length })}: {itemsLabel}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-extrabold text-price">{formatVND(order.total)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleReorder(order)}
                    className="nb-border-sm nb-shadow-sm nb-press-sm flex items-center justify-center gap-1.5 rounded-lg bg-chip py-2 text-xs font-extrabold text-foreground"
                  >
                    {reorderedId === order.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-success" />
                        {t("reorderAdded")}
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("reorder")}
                      </>
                    )}
                  </button>
                </div>
              </StaggerItem>
            )
          })}
        </StaggerList>
      )}
    </div>
  )
}
