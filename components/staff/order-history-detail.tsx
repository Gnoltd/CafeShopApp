"use client"

import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { formatOrderId, formatVND } from "@/lib/format"
import type { OrderHistoryDetail } from "@/lib/supabase/order-history"

export function OrderHistoryDetailView({ order }: { order: OrderHistoryDetail }) {
  const locale = useLocale()
  const t = useTranslations("StaffOrderHistory")

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/staff/orders/history"
        className="mb-4 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("backToList")}
      </Link>

      <h2 className="mb-1 text-2xl font-bold text-primary">#{formatOrderId(order.id)}</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {order.orderType === "dine-in" ? t("tableLabel", { table: order.table ?? "" }) : t("pickupBadge")}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <div className="nb-border-sm rounded-xl bg-card p-3">
          <p className="text-muted-foreground">{t("customerLabel")}</p>
          <p className="font-bold text-card-foreground">{order.customerName ?? t("guestLabel")}</p>
        </div>
        <div className="nb-border-sm rounded-xl bg-card p-3">
          <p className="text-muted-foreground">{t("paymentMethodLabel")}</p>
          <p className="font-bold text-card-foreground">{order.paymentMethod}</p>
        </div>
        <div className="nb-border-sm rounded-xl bg-card p-3">
          <p className="text-muted-foreground">{t("paymentStatusLabel")}</p>
          <p className="font-bold text-card-foreground">{order.paymentStatus}</p>
        </div>
        <div className="nb-border-sm rounded-xl bg-card p-3">
          <p className="text-muted-foreground">{t("columnStatus")}</p>
          <p className="font-bold text-card-foreground">
            {order.status === "completed" ? t("statusCompleted") : t("statusCancelled")}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between border-b-2 border-ink/15 pb-2">
          <h3 className="text-lg font-semibold text-card-foreground">{t("orderDetailsHeading")}</h3>
          <span className="nb-border-sm rounded-full bg-chip px-3 py-1 text-xs font-bold text-secondary">
            {t("itemCount", { count: order.items.length })}
          </span>
        </div>
        <div className="space-y-2">
          {order.items.map((item, index) => (
            <div key={index} className="flex items-center justify-between rounded-xl p-3">
              <div>
                <h5 className="font-bold text-card-foreground">
                  {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                </h5>
                {item.note && <p className="text-xs italic text-accent-foreground">+ {item.note}</p>}
              </div>
              <span className="text-sm font-bold text-primary">{formatVND(item.unitPrice * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="nb-border-sm space-y-2 rounded-xl bg-chip p-4">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("subtotal")}</span>
            <span>{formatVND(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("discount")}</span>
            <span className="text-destructive">-{formatVND(order.discount)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t-2 border-ink/20 pt-2">
            <span className="font-bold text-card-foreground">{t("total")}</span>
            <span className="text-xl font-black text-primary">{formatVND(order.total)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
