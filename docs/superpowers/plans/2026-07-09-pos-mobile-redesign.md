# POS Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `components/staff/pos-terminal.tsx` phone-adaptable: below
the `md` breakpoint, the fixed two-pane desktop layout (menu grid +
`w-[380px]` order sidebar) becomes a single-pane "Menu ⇄ Order"
page-swap with a sticky "View Order" bar and a sticky Charge bar,
while the desktop layout stays pixel-identical ≥`md`.

**Architecture:** One new piece of local state (`mobileView: "menu" |
"order"`) gates mobile-only Tailwind classes and an `AnimatePresence`
overlay; every class it touches is paired with an `md:` override so
desktop rendering never depends on it. The existing order-ticket JSX
is extracted into a local `OrderPanel` subcomponent so the same markup
renders in both the always-visible desktop `<aside>` and the
conditionally-mounted mobile overlay, with a single new `onBack` prop
distinguishing the two call sites.

**Tech Stack:** Next.js/TypeScript/Tailwind, `framer-motion`
(`AnimatePresence`/`motion.div`, already a dependency — see
`components/motion/route-transition.tsx`), next-intl for `en`/`vi`
copy. No DB changes, no new routes, no new dependencies.

## Global Constraints

- Every new/changed translation key must be added to **both**
  `messages/en.json` and `messages/vi.json` in the same task.
- Desktop (`md:` and up) layout must remain pixel-identical to today —
  every mobile-only class/element must be paired with a `md:` override
  that restores current behavior.
- Verification is against the deployed Vercel URL
  (`https://phadincafe.vercel.app`), not `npm run dev`, per this
  project's standing convention — local `build`/`tsc` are for fast
  feedback only. This project has no component-level (`.tsx`) test
  harness — only `lib/`/`hooks/` query-layer logic is unit-tested
  (confirmed: every `*.test.ts` in this repo is under `lib/` or
  `hooks/`, none under `components/`) — so this plan has no new test
  files, matching that established pattern for UI-only changes.
- Commit directly to `main` after each task, per this project's
  established convention for staff/admin UI work sessions.

---

### Task 1: Extract `OrderPanel` subcomponent (no behavior change)

**Files:**
- Modify: `components/staff/pos-terminal.tsx`

**Interfaces:**
- Produces: `OrderPanel(props: OrderPanelProps)` — a local
  (non-exported) component in the same file, taking:
  ```typescript
  type OrderPanelProps = {
    order: OrderLine[]
    updateQuantity: (menuItemId: string, quantity: number) => void
    clearOrder: () => void
    orderType: OrderType
    setOrderType: (type: OrderType) => void
    tables: ReturnType<typeof useTables>["tables"]
    selectedTableId: string
    setSelectedTableId: (id: string) => void
    paymentMethod: PaymentMethod
    setPaymentMethod: (method: PaymentMethod) => void
    subtotal: number
    tax: number
    total: number
    chargeError: string | null
    isCharging: boolean
    handleCharge: () => void
    onBack?: () => void
  }
  ```
  Consumed by `PosTerminal` in Task 2/3 (desktop `<aside>` and mobile
  overlay call sites).

This task is a pure refactor: move the existing order-ticket JSX
(today's `<aside className="flex w-[380px] ...">` block, currently
`pos-terminal.tsx:194–351`) into `OrderPanel`, with zero behavior
change. Verify this by diffing rendered output mentally against the
step below — every prop maps 1:1 to a variable already in scope in
`PosTerminal` today.

- [ ] **Step 1: Add the `OrderPanelProps` type and `OrderPanel` function**

In `components/staff/pos-terminal.tsx`, after the existing `PosTerminal`
function's closing brace, add:

```tsx
type OrderPanelProps = {
  order: OrderLine[]
  updateQuantity: (menuItemId: string, quantity: number) => void
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
  total: number
  chargeError: string | null
  isCharging: boolean
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
  total,
  chargeError,
  isCharging,
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
              <div key={line.menuItemId} className="flex flex-col gap-2">
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-card-foreground">
                    {locale === "vi" ? line.nameVi : line.nameEn}
                  </h4>
                  <p className="font-bold text-primary">{formatVND(line.unitPrice * line.quantity)}</p>
                </div>
                <div className="flex items-center gap-2 self-start rounded-lg bg-card p-1">
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.menuItemId, line.quantity - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-bold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.menuItemId, line.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors"
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
            <div className="flex rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setOrderType("dine-in")}
                className={cn(
                  "flex-1 rounded-md py-2 text-xs font-bold transition-all",
                  orderType === "dine-in" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                )}
              >
                {t("dineIn")}
              </button>
              <button
                type="button"
                onClick={() => setOrderType("takeaway")}
                className={cn(
                  "flex-1 rounded-md py-2 text-xs font-bold transition-all",
                  orderType === "takeaway" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
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
                    "rounded-lg border-2 py-2.5 text-[11px] font-bold transition-all",
                    paymentMethod === method
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-muted text-muted-foreground",
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
            <span>{t("tax")}</span>
            <span className="font-bold text-card-foreground">{formatVND(tax)}</span>
          </div>
        </div>

        {chargeError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{chargeError}</p>
        )}

        <button
          type="button"
          onClick={handleCharge}
          disabled={order.length === 0 || isCharging}
          className="flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-50"
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
```

- [ ] **Step 2: Replace the inline `<aside>` block in `PosTerminal` with `OrderPanel`**

Replace the existing (lines ~194–351):

```tsx
      <aside className="flex w-[380px] shrink-0 flex-col border-l bg-muted">
        {/* ... existing order-ticket JSX ... */}
      </aside>
```

with:

```tsx
      <aside className="flex w-[380px] shrink-0 flex-col border-l bg-muted">
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
          total={total}
          chargeError={chargeError}
          isCharging={isCharging}
          handleCharge={handleCharge}
        />
      </aside>
```

- [ ] **Step 3: Add `ArrowLeft` to the `lucide-react` import**

Change:

```tsx
import { Coffee, CupSoda, Cookie, Milk, Search, Minus, Plus, Trash2, ArrowRight } from "lucide-react"
```

to:

```tsx
import { Coffee, CupSoda, Cookie, Milk, Search, Minus, Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add components/staff/pos-terminal.tsx
git commit -m "POS: extract OrderPanel subcomponent (pure refactor, no behavior change)"
```

---

### Task 2: Add translation keys for the mobile swap

**Files:**
- Modify: `messages/en.json` (`Pos` namespace, `messages/en.json:290-306`)
- Modify: `messages/vi.json` (`Pos` namespace, `messages/vi.json:290-306`)

**Interfaces:**
- Produces: `Pos.backToMenu`, `Pos.viewOrder` (ICU count-interpolated)
  translation keys, consumed by `OrderPanel` and the mobile "View
  Order" bar in Task 3.

- [ ] **Step 1: Add keys to `messages/en.json`**

In the `Pos` block, replace:

```json
    "chargeError": "Failed to charge order. Try again."
```

with:

```json
    "chargeError": "Failed to charge order. Try again.",
    "backToMenu": "Back to Menu",
    "viewOrder": "View Order ({count})"
```

- [ ] **Step 2: Add keys to `messages/vi.json`**

In the `Pos` block, replace:

```json
    "chargeError": "Thanh toán thất bại. Vui lòng thử lại."
```

with:

```json
    "chargeError": "Thanh toán thất bại. Vui lòng thử lại.",
    "backToMenu": "Về Thực Đơn",
    "viewOrder": "Xem Đơn ({count})"
```

- [ ] **Step 3: Verify both files still parse as valid JSON**

Run: `node -e "require('./messages/en.json'); require('./messages/vi.json'); console.log('ok')"`
Expected: prints `ok` with no error.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add Pos.backToMenu/viewOrder translation keys for mobile POS swap"
```

---

### Task 3: Mobile "Menu ⇄ Order" swap — state, sticky bar, animated overlay

**Files:**
- Modify: `components/staff/pos-terminal.tsx`

**Interfaces:**
- Consumes: `OrderPanel` from Task 1; `Pos.backToMenu`/`Pos.viewOrder`
  from Task 2.
- Produces: `mobileView` state fully contained inside `PosTerminal`,
  no new exports.

- [ ] **Step 1: Add `framer-motion` import and `mobileView` state**

Add to the top of `components/staff/pos-terminal.tsx`:

```tsx
import { AnimatePresence, motion } from "framer-motion"
```

Inside `PosTerminal`, after the existing `const [chargeError, setChargeError] = useState<string | null>(null)`
line, add:

```tsx
  const [mobileView, setMobileView] = useState<"menu" | "order">("menu")
  const orderItemCount = order.reduce((n, line) => n + line.quantity, 0)
```

- [ ] **Step 2: Gate the menu pane wrapper on `mobileView`**

Replace the menu pane's outer wrapper:

```tsx
      <div className="flex flex-1 flex-col overflow-hidden">
```

with:

```tsx
      <div className={cn("flex-1 flex-col overflow-hidden", mobileView === "order" ? "hidden md:flex" : "flex")}>
```

- [ ] **Step 3: Add bottom padding to the menu grid scroll container on mobile**

Replace:

```tsx
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
```

with:

```tsx
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
```

- [ ] **Step 4: Hide the desktop `<aside>` below `md`**

Replace:

```tsx
      <aside className="flex w-[380px] shrink-0 flex-col border-l bg-muted">
```

with:

```tsx
      <aside className="hidden w-[380px] shrink-0 flex-col border-l bg-muted md:flex">
```

- [ ] **Step 5: Add the mobile sticky "View Order" bar and animated Order overlay**

Immediately after the closing `</aside>` tag (still inside the
outermost `<div className="flex h-full overflow-hidden">`), add:

```tsx
      {mobileView === "menu" && order.length > 0 && (
        <button
          type="button"
          onClick={() => setMobileView("order")}
          className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg md:hidden"
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
              total={total}
              chargeError={chargeError}
              isCharging={isCharging}
              handleCharge={handleCharge}
              onBack={() => setMobileView("menu")}
            />
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 6: Return to Menu automatically after a successful charge**

`handleCharge` already does `setOrder([])` on success. Immediately
after that line, add `setMobileView("menu")` so a completed charge on
mobile returns the staff member to the menu (an empty Order view would
otherwise be left showing). Replace:

```tsx
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      setOrder([])
```

with:

```tsx
      if (invokeError || data?.error) throw invokeError ?? new Error(data.error)
      setOrder([])
      setMobileView("menu")
```

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/staff/pos-terminal.tsx
git commit -m "POS: mobile Menu <-> Order page-swap with sticky View Order bar"
```

---

### Task 4: Full verification

- [ ] **Step 1: Grep for stray direct references to the old inline aside markup**

Run: `grep -n "w-\[380px\]" components/staff/pos-terminal.tsx`
Expected: exactly 1 match — the desktop `<aside>` line (now `hidden
w-[380px] shrink-0 flex-col border-l bg-muted md:flex`) — confirms
Task 1's extraction didn't leave a duplicate copy of the order-ticket
markup behind, and the mobile overlay (`fixed inset-0`, no fixed
width) correctly reuses `OrderPanel` rather than redefining its own
sizing.

- [ ] **Step 2: Push to `main`**

```bash
git push
```

- [ ] **Step 3: Live verification on Vercel**

Once deployed, verify live at `https://phadincafe.vercel.app/en/staff/pos`
(log in as `admin@phadincoffee.dev` or the staff test account):

- **Desktop regression check** (browser window ≥768px wide): confirm
  the two-pane layout looks and behaves exactly as before — menu grid
  left, order ticket right, no sticky "View Order" bar visible, Charge
  button reachable without scrolling past anything new.
- **Mobile flow** (resize below 768px, or use device emulation): add
  2-3 items from the Menu view, confirm the sticky "View Order (N)"
  bar appears at the bottom showing the correct item count and total;
  tap it, confirm the swap animation plays and the Order view shows
  the same line items, type/table selector, and payment method picker;
  tap the back arrow, confirm return to the Menu view with category
  selection and scroll position intact (no remount); reopen the Order
  view and complete a full Charge with Cash, confirm the order is
  created (check it appears in `/staff/orders` KDS) and the view
  returns to Menu with the ticket cleared.
- **Search + category filter on mobile**: confirm the search input and
  horizontally-scrollable category tabs are still usable and not
  obscured by the new sticky bar.
