"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Search } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { formatOrderId, formatVND } from "@/lib/format"
import { useOrderHistory } from "@/hooks/useOrderHistory"
import type { OrderHistoryFilters, RealOrderStatus, OrderType } from "@/lib/supabase/orders-data"

const PAGE_SIZE = 20

const STATUS_BADGE: Record<"completed" | "cancelled", string> = {
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
}

function formatDateTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function OrderHistoryList() {
  const locale = useLocale()
  const t = useTranslations("StaffOrderHistory")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<RealOrderStatus | "all">("all")
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderType | "all">("all")
  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined)
  const [dateTo, setDateTo] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const debounceRef = useRef<number | undefined>(undefined)

  const filters: OrderHistoryFilters = {
    dateFrom,
    dateTo,
    statuses: statusFilter === "all" ? undefined : [statusFilter],
    orderType: orderTypeFilter === "all" ? undefined : orderTypeFilter,
    search: search || undefined,
  }
  const { rows, totalCount, isLoading } = useOrderHistory(filters, page, PAGE_SIZE)

  function resetToFirstPage() {
    setPage(1)
  }

  function handleSearchChange(value: string) {
    setSearchInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setSearch(value)
      resetToFirstPage()
    }, 300)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount)

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-bold text-card-foreground">{t("title")}</h1>

      <div className="nb-border-sm mb-3 flex items-center gap-2 rounded-lg bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dateFrom ?? ""}
          onChange={(e) => {
            setDateFrom(e.target.value || undefined)
            resetToFirstPage()
          }}
          className="nb-border-sm rounded-lg bg-card px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={dateTo ?? ""}
          onChange={(e) => {
            setDateTo(e.target.value || undefined)
            resetToFirstPage()
          }}
          className="nb-border-sm rounded-lg bg-card px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as RealOrderStatus | "all")
            resetToFirstPage()
          }}
          className="nb-border-sm rounded-lg bg-card px-3 py-2 text-sm"
        >
          <option value="all">{t("statusAll")}</option>
          <option value="completed">{t("statusCompleted")}</option>
          <option value="cancelled">{t("statusCancelled")}</option>
        </select>
        <select
          value={orderTypeFilter}
          onChange={(e) => {
            setOrderTypeFilter(e.target.value as OrderType | "all")
            resetToFirstPage()
          }}
          className="nb-border-sm rounded-lg bg-card px-3 py-2 text-sm"
        >
          <option value="all">{t("orderTypeAll")}</option>
          <option value="pickup">{t("orderTypePickup")}</option>
          <option value="dine-in">{t("orderTypeDineIn")}</option>
        </select>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          {/* Mobile: card list — the 7-column table below is unreadable at
              phone width, unlike menu-management.tsx which already got this
              treatment (2026-07-31 responsive audit). */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((order) => (
              <Link
                key={order.id}
                href={`/staff/orders/history/${order.id}`}
                className="nb-border-sm nb-shadow-sm nb-press-sm flex flex-col gap-2 rounded-xl bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-primary">#{formatOrderId(order.id)}</span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      STATUS_BADGE[order.status as "completed" | "cancelled"]
                    }`}
                  >
                    {order.status === "completed" ? t("statusCompleted") : t("statusCancelled")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt, locale)}</p>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-muted-foreground">{order.customerName ?? t("guestLabel")}</span>
                  <span className="shrink-0 font-bold text-card-foreground">{formatVND(order.total)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{order.orderType === "dine-in" ? order.table : t("orderTypePickup")}</span>
                  <span>{order.paymentMethod}</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="nb-border nb-shadow-sm hidden overflow-x-auto rounded-xl bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b-2 border-ink/15 bg-muted/40 text-left text-xs font-bold uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t("columnOrderId")}</th>
                  <th className="px-4 py-3">{t("columnDateTime")}</th>
                  <th className="px-4 py-3">{t("columnCustomer")}</th>
                  <th className="px-4 py-3">{t("columnTable")}</th>
                  <th className="px-4 py-3">{t("columnPayment")}</th>
                  <th className="px-4 py-3">{t("columnStatus")}</th>
                  <th className="px-4 py-3 text-right">{t("columnTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id} className="border-b-2 border-ink/15 last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <Link
                        href={`/staff/orders/history/${order.id}`}
                        className="font-bold text-primary hover:underline"
                      >
                        #{formatOrderId(order.id)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.createdAt, locale)}</td>
                    <td className="px-4 py-3">{order.customerName ?? t("guestLabel")}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {order.orderType === "dine-in" ? order.table : t("orderTypePickup")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{order.paymentMethod}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          STATUS_BADGE[order.status as "completed" | "cancelled"]
                        }`}
                      >
                        {order.status === "completed" ? t("statusCompleted") : t("statusCancelled")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary">{formatVND(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("paginationSummary", { from: rangeFrom, to: rangeTo, total: totalCount })}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1.5 disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="nb-border-sm nb-press-sm rounded-lg bg-card px-3 py-1.5 disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  )
}
