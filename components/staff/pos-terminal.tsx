"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "framer-motion"
import { Coffee, CupSoda, Cookie, Milk, Search, Minus, Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatVND } from "@/lib/format"
import { computeOrderTotal } from "@/lib/order-total"
import { createClient } from "@/lib/supabase/client"
import type { MenuCategory, MenuIcon, MenuItem } from "@/lib/supabase/menu-data"
import { useTables } from "@/hooks/useTables"
import { useKitchenOrders } from "@/hooks/useKitchenOrders"
import { useShift } from "@/hooks/useShift"
import { KitchenPendingPayment } from "@/components/staff/kitchen-pending-payment"
import { PosItemPicker, type PosPickerSelection } from "@/components/staff/pos-item-picker"
import { getShopSettings } from "@/lib/supabase/settings-data"

const ICONS: Record<MenuIcon, typeof Coffee> = {
  coffee: Coffee,
  "cup-soda": CupSoda,
  cookie: Cookie,
  milk: Milk,
}

type OrderLine = {
  lineId: string
  menuItemId: string
  nameVi: string
  nameEn: string
  sizeId: string | null
  sizeName: string | null
  modifierIds: string[]
  modifierNames: string[]
  unitPrice: number
  quantity: number
}

function lineMergeKey(menuItemId: string, sizeId: string | null, modifierIds: string[]): string {
  return `${menuItemId}|${sizeId ?? ""}|${[...modifierIds].sort().join(",")}`
}

type OrderType = "dine-in" | "takeaway"
type PaymentMethod = "cash" | "card" | "vnpay"

export function PosTerminal({ categories, items }: { categories: MenuCategory[]; items: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Pos")
  const [supabase] = useState(() => createClient())
  const { tables } = useTables()
  const { pendingPaymentOrders, confirmCashPayment } = useKitchenOrders()
  const { isShiftOpen } = useShift()

  const [selectedCategory, setSelectedCategory] = useState(categories[0]?.id ?? "")
  const [searchQuery, setSearchQuery] = useState("")
  const [order, setOrder] = useState<OrderLine[]>([])
  const [orderType, setOrderType] = useState<OrderType>("dine-in")
  const [selectedTableId, setSelectedTableId] = useState(tables[0]?.id ?? "")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [isCharging, setIsCharging] = useState(false)
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"menu" | "order">("menu")
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null)
  const [taxRatePercent, setTaxRatePercent] = useState(0)
  const orderItemCount = order.reduce((n, line) => n + line.quantity, 0)

  const selectedTable = tables.find((tbl) => tbl.id === selectedTableId) ?? tables[0]

  useEffect(() => {
    if (!selectedTableId && tables.length > 0) {
      setSelectedTableId(tables[0].id)
    }
  }, [tables, selectedTableId])

  useEffect(() => {
    getShopSettings(supabase)
      .then((settings) => setTaxRatePercent(settings.taxRatePercent))
      .catch(() => setTaxRatePercent(0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const name = (item: MenuItem) => (locale === "vi" ? item.nameVi : item.nameEn)
  const categoryLabel = (c: MenuCategory) => (locale === "vi" ? c.nameVi : c.nameEn)

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesCategory = item.categoryId === selectedCategory
      const matchesQuery =
        query === "" || item.nameVi.toLowerCase().includes(query) || item.nameEn.toLowerCase().includes(query)
      return item.isAvailable && matchesCategory && matchesQuery
    })
  }, [items, selectedCategory, searchQuery])

  function addLine(item: MenuItem, selection: PosPickerSelection) {
    const key = lineMergeKey(item.id, selection.sizeId, selection.modifierIds)
    setOrder((prev) => {
      const existing = prev.find(
        (line) => lineMergeKey(line.menuItemId, line.sizeId, line.modifierIds) === key
      )
      if (existing) {
        return prev.map((line) => (line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line))
      }
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          menuItemId: item.id,
          nameVi: item.nameVi,
          nameEn: item.nameEn,
          sizeId: selection.sizeId,
          sizeName: selection.sizeName,
          modifierIds: selection.modifierIds,
          modifierNames: selection.modifierNames,
          unitPrice: selection.unitPrice,
          quantity: 1,
        },
      ]
    })
  }

  function addToOrder(item: MenuItem) {
    const needsPicker = (item.hasSizeOptions && item.sizes.length > 0) || item.modifierGroups.length > 0
    if (needsPicker) {
      setPickerItem(item)
      return
    }
    addLine(item, { sizeId: null, sizeName: null, modifierIds: [], modifierNames: [], unitPrice: item.basePrice })
  }

  function updateQuantity(lineId: string, quantity: number) {
    setOrder((prev) =>
      quantity <= 0
        ? prev.filter((line) => line.lineId !== lineId)
        : prev.map((line) => (line.lineId === lineId ? { ...line, quantity } : line))
    )
  }

  const subtotal = order.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const { tax, total } = computeOrderTotal({ subtotal, taxRatePercent })

  async function handleCharge() {
    if (order.length === 0) return
    setChargeError(null)
    setIsCharging(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("place-order", {
        body: {
          orderType: orderType === "dine-in" ? "dine_in" : "pickup",
          tableId: orderType === "dine-in" ? (selectedTable?.id ?? null) : null,
          pickupTime: null,
          paymentMethod: paymentMethod === "card" ? "stripe" : paymentMethod === "vnpay" ? "vnpay" : "cash",
          promoCode: null,
          redeemLoyaltyPoints: 0,
          paymentCollected: true,
          items: order.map((line) => ({
            menuItemId: line.menuItemId,
            sizeId: line.sizeId,
            modifierIds: line.modifierIds,
            quantity: line.quantity,
            note: null,
          })),
        },
      })
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      setOrder([])
      setMobileView("menu")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setChargeError(message.includes("no_open_shift") ? t("noOpenShiftError") : t("chargeError"))
    } finally {
      setIsCharging(false)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className={cn("flex-1 flex-col overflow-hidden", mobileView === "order" ? "hidden md:flex" : "flex")}>
        <div className="border-b p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="nb-border-sm h-10 w-full rounded-lg bg-card pl-9 pr-3 text-sm outline-none"
            />
          </div>
        </div>

        {pendingPaymentOrders.length > 0 && (
          <div className="px-4 pt-4">
            <KitchenPendingPayment orders={pendingPaymentOrders} onConfirm={confirmCashPayment} />
          </div>
        )}

        <div className="relative">
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 pt-4">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "nb-border-sm nb-shadow-sm nb-press-sm shrink-0 whitespace-nowrap rounded-lg px-5 py-2.5 text-sm font-extrabold",
                  selectedCategory === category.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-card-foreground"
                )}
              >
                {categoryLabel(category)}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 top-4 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleItems.map((item) => {
              const Icon = ICONS[item.icon]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addToOrder(item)}
                  className="nb-border-sm nb-shadow-sm nb-press-sm flex flex-col gap-2 rounded-xl bg-card p-2 text-left"
                >
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-chip text-muted-foreground">
                    <Icon className="h-8 w-8" />
                  </div>
                  <div className="px-1 pb-1">
                    <h3 className="line-clamp-1 font-bold text-card-foreground">{name(item)}</h3>
                    <p className="mt-1 text-lg font-extrabold text-price">{formatVND(item.basePrice)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <aside className="hidden w-[380px] shrink-0 flex-col border-l bg-muted md:flex">
        <OrderPanel
          order={order}
          updateQuantity={updateQuantity}
          clearOrder={() => setOrder([])}
          orderType={orderType}
          setOrderType={setOrderType}
          tables={tables}
          selectedTableId={selectedTableId}
          setSelectedTableId={setSelectedTableId}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          subtotal={subtotal}
          tax={tax}
          taxRatePercent={taxRatePercent}
          total={total}
          chargeError={chargeError}
          isCharging={isCharging}
          isShiftOpen={isShiftOpen}
          handleCharge={handleCharge}
        />
      </aside>

      {mobileView === "menu" && order.length > 0 && (
        <button
          type="button"
          onClick={() => setMobileView("order")}
          className="nb-border nb-shadow fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground md:hidden"
        >
          <span className="text-sm font-bold">{t("viewOrder", { count: orderItemCount })}</span>
          <span className="text-sm font-bold">{formatVND(total)}</span>
        </button>
      )}

      <AnimatePresence>
        {mobileView === "order" && (
          <motion.div
            key="mobile-order"
            className="fixed inset-0 z-30 flex flex-col bg-muted md:hidden"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <OrderPanel
              order={order}
              updateQuantity={updateQuantity}
              clearOrder={() => setOrder([])}
              orderType={orderType}
              setOrderType={setOrderType}
              tables={tables}
              selectedTableId={selectedTableId}
              setSelectedTableId={setSelectedTableId}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              subtotal={subtotal}
              tax={tax}
              taxRatePercent={taxRatePercent}
              total={total}
              chargeError={chargeError}
              isCharging={isCharging}
              isShiftOpen={isShiftOpen}
              handleCharge={handleCharge}
              onBack={() => setMobileView("menu")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pickerItem && (
          <PosItemPicker
            key="pos-item-picker"
            item={pickerItem}
            onAdd={(selection) => addLine(pickerItem, selection)}
            onClose={() => setPickerItem(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

type OrderPanelProps = {
  order: OrderLine[]
  updateQuantity: (lineId: string, quantity: number) => void
  clearOrder: () => void
  orderType: OrderType
  setOrderType: (type: OrderType) => void
  tables: { id: string; number: string }[]
  selectedTableId: string
  setSelectedTableId: (id: string) => void
  paymentMethod: PaymentMethod
  setPaymentMethod: (method: PaymentMethod) => void
  subtotal: number
  tax: number
  taxRatePercent: number
  total: number
  chargeError: string | null
  isCharging: boolean
  isShiftOpen: boolean
  handleCharge: () => void
  onBack?: () => void
}

function OrderPanel({
  order,
  updateQuantity,
  clearOrder,
  orderType,
  setOrderType,
  tables,
  selectedTableId,
  setSelectedTableId,
  paymentMethod,
  setPaymentMethod,
  subtotal,
  tax,
  taxRatePercent,
  total,
  chargeError,
  isCharging,
  isShiftOpen,
  handleCharge,
  onBack,
}: OrderPanelProps) {
  const locale = useLocale()
  const t = useTranslations("Pos")

  return (
    <>
      <div className="flex items-center justify-between border-b bg-card p-4">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("backToMenu")}
              className="rounded-lg p-2 text-card-foreground transition-colors hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-lg font-bold text-card-foreground">{t("orderTitle")}</h2>
        </div>
        {order.length > 0 && (
          <button
            type="button"
            onClick={clearOrder}
            className="rounded-lg p-2 text-destructive transition-colors hover:bg-destructive/10"
            aria-label={t("clearOrder")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {order.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyOrder")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {order.map((line) => (
              <div key={line.lineId} className="flex flex-col gap-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-card-foreground">
                      {locale === "vi" ? line.nameVi : line.nameEn}
                    </h4>
                    {(line.sizeName || line.modifierNames.length > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {[line.sizeName, ...line.modifierNames].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <p className="font-extrabold text-price">{formatVND(line.unitPrice * line.quantity)}</p>
                </div>
                <div className="nb-border-sm flex items-center gap-2 self-start rounded-lg bg-card p-1">
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.lineId, line.quantity - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-chip"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-bold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t bg-card p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("type")}
            </label>
            <div className="nb-border-sm flex rounded-lg bg-card p-1">
              <button
                type="button"
                onClick={() => setOrderType("dine-in")}
                className={cn(
                  "flex-1 rounded-md py-2 text-xs font-extrabold",
                  orderType === "dine-in" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {t("dineIn")}
              </button>
              <button
                type="button"
                onClick={() => setOrderType("takeaway")}
                className={cn(
                  "flex-1 rounded-md py-2 text-xs font-extrabold",
                  orderType === "takeaway" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {t("takeaway")}
              </button>
            </div>
          </div>
          {orderType === "dine-in" && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("table")}
              </label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="h-full rounded-lg border-none bg-muted px-3 text-xs font-bold outline-none"
              >
                {tables.map((tbl) => (
                  <option key={tbl.id} value={tbl.id}>
                    {t("table")} {tbl.number}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("payment")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["cash", "card", "vnpay"] as PaymentMethod[]).map((method) => {
              const enabled = method === "cash" || method === "card" || method === "vnpay"
              return (
                <button
                  key={method}
                  type="button"
                  disabled={!enabled}
                  title={enabled ? undefined : t("paymentMethodComingSoon")}
                  onClick={() => setPaymentMethod(method)}
                  className={cn(
                    "nb-border-sm nb-shadow-sm rounded-lg py-2.5 text-[11px] font-extrabold",
                    paymentMethod === method
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground",
                    !enabled && "opacity-50"
                  )}
                >
                  {method === "cash" ? t("payCash") : method === "card" ? t("payCard") : "VNPay"}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>{t("subtotal")}</span>
            <span className="font-bold text-card-foreground">{formatVND(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("tax", { rate: taxRatePercent })}</span>
            <span className="font-bold text-card-foreground">{formatVND(tax)}</span>
          </div>
        </div>

        {!isShiftOpen && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("noOpenShiftNotice")}</p>
        )}
        {chargeError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{chargeError}</p>
        )}

        <button
          type="button"
          onClick={handleCharge}
          disabled={order.length === 0 || isCharging || !isShiftOpen}
          className="nb-border nb-shadow nb-press flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground disabled:opacity-50"
        >
          <span className="flex flex-col items-start">
            <span className="text-[10px] font-bold uppercase opacity-80">{t("charge")}</span>
            <span className="text-lg font-bold">{formatVND(total)}</span>
          </span>
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </>
  )
}
