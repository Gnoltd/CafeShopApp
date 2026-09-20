# Minimal Ordering Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut PhaDinCafe down to its essential daily operation — guest
scans a table QR, orders from the shared table cart, staff run KDS +
Tables and settle in cash — deleting every other feature (accounts,
loyalty, rewards, address book, shift reconciliation, POS, landing page,
online payment gateways, tax) while never dropping DB tables/columns
except the one gate that would otherwise deadlock ordering.

**Architecture:** Almost entirely deletion + simplification of an
existing, live Next.js App Router + Supabase app. The one path that
survives untouched end-to-end is the Shared Table Ordering Session
(`table_sessions`/`table_cart_items`, `hooks/useTableSession.tsx`,
`place_table_round`) — every other customer-facing surface either dies
or gets rebuilt as a thin read-only/staff-only shell around existing
data. Work proceeds leaf-to-root: first untangle shared code the
survivors still reach into (types, `MenuBrowser`), then delete dead
surfaces, then rebuild the few new/simplified ones, then fix routing/
roles, then docs.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres/Auth/
Realtime/Edge Functions), Tailwind v4 + shadcn/Base UI, next-intl,
Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-minimal-ordering-rebuild-design.md`

## Global Constraints

- Never drop a DB table or column in this plan. The one exception is
  removing the `no_open_shift` runtime gate from `place_order_legacy`
  (Decision 8) — that's a body edit, not a drop.
- No Stripe/VNPay/promo-code/tax logic may remain reachable from any
  customer-facing or staff-facing code path.
- Every customer-facing page is guest/anonymous — no customer account
  concept anywhere.
- Every order places through `place_table_round` — there must be no
  other code path that creates an `orders` row.
- Keep the existing 3 roles (`staff|manager|admin`) and RLS exactly as
  they are; do not touch `current_user_role()` or role-checking SQL.
- Apply every migration through `mcp__supabase__apply_migration`
  (project `qhiypdqnrnzndxdwqxbx`, live). Immediately after creating or
  replacing any `SECURITY DEFINER` function, check
  `information_schema.role_routine_grants` for it live — this project's
  Supabase instance has re-granted `anon`/`authenticated` execute on new
  functions unprompted at least four times before.
- Local verification is `npm run build`, `npm test` (Vitest), `npm run
  lint`. Final verification is against the deployed
  `https://phadincafe.vercel.app`, not `npm run dev` — this project's
  explicit convention.
- Follow the DI'd query-layer convention (`SupabaseClient` as first arg)
  and the guest-safe RPC pattern for anything new a guest calls.
- Add new/changed i18n keys to **both** `messages/vi.json` and
  `messages/en.json`.

---

## Part 1 — Database

### Task 1: Remove the shift-open ordering gate; zero out tax

**Files:**
- Create: `supabase/migrations/0094_remove_shift_gate_and_tax.sql`

**Interfaces:**
- Produces: `place_order_legacy(...)` (same signature, same name — body
  edit only) with the `no_open_shift` exception removed. `shop_settings`
  row `id = 1` has `tax_rate = 0`.

- [ ] **Step 1: Read the live function definition**

  Run via `mcp__supabase__execute_sql`:
  ```sql
  select pg_get_functiondef('public.place_order_legacy'::regprocedure);
  ```
  (If there are multiple overloads, `mcp__supabase__list_migrations` +
  grep `supabase/migrations/*.sql` for `place_order_legacy` to find the
  live signature, or query `pg_proc` filtering `proname =
  'place_order_legacy'` to list all overloads and their `pg_get_functiondef`.)

- [ ] **Step 2: Write the migration**

  Copy the full function body returned by Step 1 into a
  `create or replace function public.place_order_legacy(...)` statement
  in the new migration file, with exactly one change: delete the leading
  guard block that reads

  ```sql
  if not exists (select 1 from public.shifts where closed_at is null) then
    raise exception 'no_open_shift';
  end if;
  ```

  Change nothing else in the function — same parameters, same return
  type, same remaining body (promo/loyalty/redemption/pricing logic
  stays as-is; Promotions/Loyalty are dormant-but-present per the
  design's Decision 1, and nothing calls this function with a promo code
  anymore once Task 7 lands, so the dead branches are harmless).

  Append to the same migration file:
  ```sql
  update public.shop_settings set tax_rate = 0 where id = 1;
  ```

- [ ] **Step 3: Apply the migration**

  Use `mcp__supabase__apply_migration` with the file's contents and name
  `remove_shift_gate_and_tax`.

- [ ] **Step 4: Verify live**

  Via `mcp__supabase__execute_sql`:
  ```sql
  select pg_get_functiondef('public.place_order_legacy'::regprocedure);
  ```
  Confirm the `no_open_shift` block is gone and everything else is
  byte-for-byte identical to Step 1's output. Then:
  ```sql
  select tax_rate from public.shop_settings where id = 1;
  ```
  Confirm it returns `0`.

- [ ] **Step 5: Smoke-test ordering with zero open shifts**

  ```sql
  select count(*) from public.shifts where closed_at is null;
  ```
  Whatever this returns (likely `0` on the live project already, since
  no one can currently close every shift and reopen one without the old
  UI), confirm a round can still be placed: find or create a test table's
  `qr_code_token` (`select qr_code_token from public.tables limit 1;` —
  reading the token via SQL is fine for verification; the anon-facing
  leak this project cares about is a client reading it through a REST
  call, not this direct DB check) and call
  `select public.place_table_round(p_qr_token => '<token>');` after
  first calling `add_cart_item` for that token with a real
  `menu_item_id`. Expect success (a `jsonb` result), not a `no_open_shift`
  error.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/0094_remove_shift_gate_and_tax.sql
  git commit -m "db: remove shift-open gate from ordering, zero out tax rate"
  ```

---

## Part 2 — Untangle shared code before deleting the personal cart

### Task 2: Extract cart item types out of `useCart.tsx`

**Files:**
- Create: `lib/menu-selection-types.ts`
- Modify: `hooks/useCart.tsx`, `components/shared/size-extras-sheet.tsx`,
  `components/customer/quick-add-popup.tsx`, `components/customer/menu-browser.tsx`

**Interfaces:**
- Produces: `lib/menu-selection-types.ts` exports `CartModifier`,
  `CartItem`, `AddToCartInput` (identical shapes to the ones currently
  defined in `hooks/useCart.tsx`, moved verbatim).
- Consumes: nothing new.

This task exists because `MenuBrowser` and `QuickAddPopup` — both
reused by the surviving `TableOrderingSession` — currently import these
*types* from `hooks/useCart.tsx`, a file Task 9 deletes. Move the types
out first so nothing customer-surviving imports from the doomed file.

- [ ] **Step 1: Create the neutral types module**

  ```typescript
  // lib/menu-selection-types.ts
  export type CartModifier = {
    groupId: string
    optionId: string
    labelVi: string
    labelEn: string
    priceDelta: number
  }

  export type CartItem = {
    cartItemId: string
    menuItemId: string
    nameVi: string
    nameEn: string
    size?: { id: string; label: string; priceDelta: number }
    modifiers: CartModifier[]
    note?: string
    unitPrice: number
    quantity: number
    needsConfiguration?: boolean
  }

  export type AddToCartInput = Omit<CartItem, "cartItemId" | "quantity">
  ```

- [ ] **Step 2: Point `hooks/useCart.tsx` at the new module**

  In `hooks/useCart.tsx`, replace the inline `export type CartModifier`,
  `export type CartItem`, `export type AddToCartInput` declarations with:
  ```typescript
  export type { CartModifier, CartItem, AddToCartInput } from "@/lib/menu-selection-types"
  ```
  (Re-exporting keeps every current importer of these types from
  `hooks/useCart` working unchanged until Task 9 deletes the file.)

- [ ] **Step 3: Update `size-extras-sheet.tsx`**

  Change `import type { CartModifier } from "@/hooks/useCart"` to
  `import type { CartModifier } from "@/lib/menu-selection-types"`.

- [ ] **Step 4: Update `quick-add-popup.tsx`'s type import only**

  Change `import { useCart, type AddToCartInput } from "@/hooks/useCart"`
  to:
  ```typescript
  import { useCart } from "@/hooks/useCart"
  import type { AddToCartInput } from "@/lib/menu-selection-types"
  ```
  Keep the `useCart` value import and every line that uses it
  (`const { addItem } = useCart()`, `const add = onAdd ?? addItem`)
  exactly as they are — Task 4 removes them fully once `onAdd` becomes
  required. This step only changes where the *type* comes from.

- [ ] **Step 5: Update `menu-browser.tsx`'s type import only**

  Change `import { useCart, type AddToCartInput } from "@/hooks/useCart"`
  to:
  ```typescript
  import { useCart } from "@/hooks/useCart"
  import type { AddToCartInput } from "@/lib/menu-selection-types"
  ```
  Keep the `useCart` value import and its usage
  (`const { addItem, itemCount, subtotal } = useCart()` and the two
  fallback lines below it) exactly as they are — Task 3 removes them
  fully. This step only changes where the *type* comes from.

- [ ] **Step 6: Build to confirm nothing broke**

  Run: `npm run build`
  Expected: succeeds — this task only moved type re-exports and added a
  second import line to two files; no runtime behavior changed, and both
  files still compile with `useCart` imported as a value exactly as
  before.

- [ ] **Step 7: Commit**

  ```bash
  git add lib/menu-selection-types.ts hooks/useCart.tsx components/shared/size-extras-sheet.tsx components/customer/quick-add-popup.tsx components/customer/menu-browser.tsx
  git commit -m "refactor: extract cart item types out of useCart into a neutral module"
  ```

### Task 3: Make `MenuBrowser` fully prop-driven (no `useCart()` fallback)

**Files:**
- Modify: `components/customer/menu-browser.tsx`

**Interfaces:**
- Produces: `MenuBrowser({ categories, items, onAddItem, cartItemCount,
  cartSubtotal, cartHref, canOrder })` — `onAddItem`, `cartItemCount`,
  `cartSubtotal` become **required** when `canOrder` is `true`; when
  `canOrder` is `false`, add-to-cart controls render disabled with a
  tooltip and `onAddItem`/`cartItemCount`/`cartSubtotal`/`cartHref` are
  all optional and ignored.
- Consumes: `AddToCartInput` from `lib/menu-selection-types` (Task 2).

- [ ] **Step 1: Write the failing test**

  Create `components/customer/menu-browser.component.test.tsx` (or add
  to it if one already exists — check first with
  `find components/customer -name "menu-browser*test*"`; none exists per
  the current file listing, so create it) with:
  ```typescript
  import { describe, it, expect, vi } from "vitest"
  import { render, screen } from "@testing-library/react"
  import userEvent from "@testing-library/user-event"
  import { NextIntlClientProvider } from "next-intl"
  import { MenuBrowser } from "./menu-browser"
  import messages from "@/messages/vi.json"
  import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"

  const categories: MenuCategory[] = []
  const items: MenuItem[] = [
    {
      id: "item-1",
      nameVi: "Cà phê sữa",
      nameEn: "Milk coffee",
      descriptionVi: "",
      descriptionEn: "",
      basePrice: 25000,
      categoryIds: [],
      isAvailable: true,
      isPopular: false,
      hasSizeOptions: false,
      sizes: [],
      modifierGroups: [],
      imageUrl: null,
    } as unknown as MenuItem,
  ]

  function renderWithIntl(ui: React.ReactElement) {
    return render(
      <NextIntlClientProvider locale="vi" messages={messages}>
        {ui}
      </NextIntlClientProvider>
    )
  }

  describe("MenuBrowser — canOrder=false", () => {
    it("disables quick-add and never calls onAddItem", async () => {
      const onAddItem = vi.fn()
      renderWithIntl(
        <MenuBrowser categories={categories} items={items} canOrder={false} onAddItem={onAddItem} />
      )
      const addButton = screen.getByRole("button", { name: /add/i })
      expect(addButton).toBeDisabled()
      await userEvent.click(addButton)
      expect(onAddItem).not.toHaveBeenCalled()
    })
  })

  describe("MenuBrowser — canOrder=true", () => {
    it("calls onAddItem with no size/extras needed", async () => {
      const onAddItem = vi.fn()
      renderWithIntl(
        <MenuBrowser categories={categories} items={items} canOrder onAddItem={onAddItem} cartItemCount={0} cartSubtotal={0} />
      )
      await userEvent.click(screen.getByRole("button", { name: /add/i }))
      expect(onAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ menuItemId: "item-1", unitPrice: 25000 })
      )
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run components/customer/menu-browser.component.test.tsx`
  Expected: FAIL (`canOrder` prop doesn't exist yet / quick-add button
  isn't disabled / `useCart()` throws with no `CartProvider` in the tree).

- [ ] **Step 3: Implement**

  In `components/customer/menu-browser.tsx` (after Task 2's split, this
  file currently has two import lines: `import { useCart } from
  "@/hooks/useCart"` and `import type { AddToCartInput } from
  "@/lib/menu-selection-types"` — only the first is touched here):
  - Remove the `import { useCart } from "@/hooks/useCart"` line entirely.
    Leave the `AddToCartInput` type import from `@/lib/menu-selection-types`
    as-is.
  - Change the props signature to:
    ```typescript
    export function MenuBrowser({
      categories,
      items,
      onAddItem,
      cartItemCount = 0,
      cartSubtotal = 0,
      cartHref = "/cart",
      canOrder = true,
    }: {
      categories: MenuCategory[]
      items: MenuItem[]
      onAddItem?: (item: AddToCartInput, quantity?: number) => void
      cartItemCount?: number
      cartSubtotal?: number
      cartHref?: string
      canOrder?: boolean
    }) {
    ```
  - Delete the line `const { addItem, itemCount, subtotal } = useCart()`
    and the two lines below it that fall back to it
    (`const addToCart = onAddItem ?? addItem`, `const displayItemCount =
    cartItemCount ?? itemCount`, `const displaySubtotal = cartSubtotal ??
    subtotal`). Replace with:
    ```typescript
    const addToCart = onAddItem
    const displayItemCount = cartItemCount
    const displaySubtotal = cartSubtotal
    ```
  - In `quickAdd(item)`, guard on `canOrder`:
    ```typescript
    function quickAdd(item: MenuItem) {
      if (!item.isAvailable || !canOrder) return
      const needsChoice = (item.hasSizeOptions && item.sizes.length > 0) || item.modifierGroups.length > 0
      if (needsChoice) {
        setQuickAddItem(item)
        return
      }
      addToCart?.({
        menuItemId: item.id,
        nameVi: item.nameVi,
        nameEn: item.nameEn,
        modifiers: [],
        unitPrice: item.basePrice,
      })
    }
    ```
  - The quick-add `<motion.button>` gains `disabled={!canOrder}` and a
    `title={canOrder ? undefined : t("scanToOrder")}` (matching this
    project's disabled+tooltip convention) — add
    `role="button" aria-label={t("add")}` stays as-is, just add the
    `disabled`/`title` attributes.
  - The `<AnimatePresence>` block's `<QuickAddPopup onAdd={onAddItem} .../>`
    should now be conditioned on `canOrder` too (`{quickAddItem && canOrder && (...)}`)
    since Step above only intercepts the direct-add path, not the sheet path.
  - Add the `scanToOrder` key to `Menu` namespace in both
    `messages/vi.json` ("Quét mã QR tại bàn để đặt món") and
    `messages/en.json` ("Scan the table's QR code to order").

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run components/customer/menu-browser.component.test.tsx`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add components/customer/menu-browser.tsx components/customer/menu-browser.component.test.tsx messages/vi.json messages/en.json
  git commit -m "refactor: make MenuBrowser fully prop-driven, add canOrder disabled state"
  ```

### Task 4: Make `QuickAddPopup` fully prop-driven

**Files:**
- Modify: `components/customer/quick-add-popup.tsx`

**Interfaces:**
- Produces: `QuickAddPopup({ item, onClose, onAdd })` — `onAdd` becomes
  **required** (`(input: AddToCartInput) => void`), no internal
  `useCart()` fallback.
- Consumes: `AddToCartInput` from `lib/menu-selection-types` (Task 2).

- [ ] **Step 1: Implement (no new test needed — this file has no
  standalone test today, and Task 3's `MenuBrowser` test already covers
  the parent behavior; Task 3 already conditions the popup's render on
  `canOrder`, so a required `onAdd` cannot be reached with no handler)**

  In `components/customer/quick-add-popup.tsx` (after Task 2's split,
  this file currently has two import lines: `import { useCart } from
  "@/hooks/useCart"` and `import type { AddToCartInput } from
  "@/lib/menu-selection-types"` — only the first is touched here):
  - Remove the `import { useCart } from "@/hooks/useCart"` line entirely.
    Leave the `AddToCartInput` type import from `@/lib/menu-selection-types`
    as-is.
  - Change the props type to make `onAdd` required:
    ```typescript
    export function QuickAddPopup({
      item,
      onClose,
      onAdd,
    }: {
      item: MenuItem
      onClose: () => void
      onAdd: (input: AddToCartInput) => void
    }) {
    ```
  - Delete `const { addItem } = useCart()` and `const add = onAdd ??
    addItem`; replace every use of `add(...)` in `handleAdd` with
    `onAdd(...)`.
  - Update the file's doc comment (currently says "onAdd defaults to the
    personal useCart() cart") to reflect that `onAdd` is now always
    supplied by the caller.

- [ ] **Step 2: Build**

  Run: `npm run build`
  Expected: fails only if some other caller still renders
  `<QuickAddPopup>` without `onAdd` — grep first:
  `grep -rn "QuickAddPopup" components/ app/` and fix any such caller (per
  the dossier, `menu-browser.tsx` is the only caller and Task 3 already
  passes `onAddItem` through). Once confirmed, build should succeed.

- [ ] **Step 3: Commit**

  ```bash
  git add components/customer/quick-add-popup.tsx
  git commit -m "refactor: make QuickAddPopup's onAdd required, drop useCart fallback"
  ```

---

## Part 3 — Rebuild the Check Bill flow (cash-only, no picker)

### Task 5: Simplify `checkoutTableSession` into a direct, cash-only RPC call

**Files:**
- Modify: `lib/supabase/table-session-data.ts`

**Interfaces:**
- Produces: `requestTableBill(supabase: SupabaseClient, qrToken: string):
  Promise<void>` replacing `checkoutTableSession`.
- Consumes: Supabase RPC `checkout_table_session(p_qr_token, p_method,
  p_promo_code)` (existing, unchanged signature/behavior — verified in
  Task 1's research to already short-circuit to a no-gateway path for
  `method = 'cash'`).

- [ ] **Step 1: RPC grants already verified — no action needed**

  Already confirmed live (controller ran this exact query during the
  pre-Task-1 migration reconciliation — see the ledger's "Task 1:
  BLOCKED" entry and its follow-up): `checkout_table_session` (both the
  3-arg `(text, payment_method, text)` and 4-arg
  `(text, payment_method, text, uuid)` overloads) already has `EXECUTE`
  granted to both `anon` and `authenticated`. No new grant migration is
  needed for this task. If you want to re-confirm before proceeding:
  ```sql
  select grantee, privilege_type
  from information_schema.role_routine_grants
  where routine_name = 'checkout_table_session';
  ```

- [ ] **Step 2: Replace the function**

  In `lib/supabase/table-session-data.ts`, replace the whole
  `checkoutTableSession` function with:
  ```typescript
  export async function requestTableBill(supabase: SupabaseClient, qrToken: string): Promise<void> {
    const { error } = await supabase.rpc("checkout_table_session", {
      p_qr_token: qrToken,
      p_method: "cash",
      p_promo_code: null,
    })
    if (error) throw error
  }
  ```
  (No `locale`, `promoCode`, or `attemptId` parameters — cash never
  builds a gateway URL, so the idempotency-attempt plumbing that exists
  for Stripe/VNPay retries isn't needed here; a duplicate tap just
  reissues the same cash flag, which is harmless and matches how the
  existing cash branch already behaves.)

- [ ] **Step 3: Update its test**

  Find and update `lib/supabase/table-session-data.test.ts`'s
  `checkoutTableSession` describe block (rename to `requestTableBill`,
  drop the Edge Function invocation mock, assert a plain
  `supabase.rpc("checkout_table_session", { p_qr_token, p_method: "cash",
  p_promo_code: null })` call instead).

- [ ] **Step 4: Run the test**

  Run: `npx vitest run lib/supabase/table-session-data.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add lib/supabase/table-session-data.ts lib/supabase/table-session-data.test.ts
  git commit -m "refactor: replace checkoutTableSession with a direct cash-only RPC call"
  ```

### Task 6: Rewrite `CheckBillSheet` — drop method picker and promo UI

**Files:**
- Modify: `components/customer/check-bill-sheet.tsx`
- Test: `components/customer/check-bill-sheet.component.test.tsx`

**Interfaces:**
- Produces: `CheckBillSheet({ qrToken, unpaidTotal, onClose, onSuccess })`
  — same props as today, but the dialog body is just: total due, a
  loading/error state, and one "Yêu cầu tính tiền" confirm button.
- Consumes: `requestTableBill` from `lib/supabase/table-session-data.ts`
  (Task 5).

- [ ] **Step 1: Update the failing test first**

  Read the current `components/customer/check-bill-sheet.component.test.tsx`
  and rewrite its expectations to match the new UI: no promo input, no
  method buttons, one confirm button that calls `requestTableBill` and
  then `onSuccess`. At minimum keep/adapt:
  - a test asserting the "nothing to pay" (`unpaidTotal === 0`) state
    still renders its own message + close button unchanged,
  - a test asserting tapping confirm calls `requestTableBill(supabase,
    qrToken)` and then `onSuccess()`,
  - a test asserting a thrown error from `requestTableBill` shows the
    existing `checkBillError` message and re-enables the button.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run components/customer/check-bill-sheet.component.test.tsx`
  Expected: FAIL against the current promo/method-picker implementation.

- [ ] **Step 3: Rewrite the component**

  Replace `components/customer/check-bill-sheet.tsx` with:
  ```tsx
  "use client"

  import { useState } from "react"
  import { useTranslations } from "next-intl"
  import { X } from "lucide-react"
  import { Button } from "@/components/ui/button"
  import {
    DialogBackdrop,
    DialogClose,
    DialogDescription,
    DialogPopup,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    DialogViewport,
  } from "@/components/ui/dialog"
  import { formatVND } from "@/lib/format"
  import { createClient } from "@/lib/supabase/client"
  import { requestTableBill } from "@/lib/supabase/table-session-data"

  export function CheckBillSheet({
    qrToken,
    unpaidTotal,
    onClose,
    onSuccess,
  }: {
    qrToken: string
    unpaidTotal: number
    onClose: () => void
    onSuccess: () => void
  }) {
    const t = useTranslations("TableSession")
    const [supabase] = useState(() => createClient())
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleConfirm() {
      setError(null)
      setIsSubmitting(true)
      try {
        await requestTableBill(supabase, qrToken)
        onSuccess()
      } catch {
        setError(t("checkBillError"))
        setIsSubmitting(false)
      }
    }

    return (
      <DialogRoot
        open
        onOpenChange={(nextOpen) => {
          if (isSubmitting && !nextOpen) return
          if (!nextOpen) onClose()
        }}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport align="sheet">
            <DialogPopup variant="sheet" size="sm" className="nb-shadow p-6">
              {unpaidTotal === 0 ? (
                <>
                  <DialogTitle className="sr-only">{t("checkBillTitle")}</DialogTitle>
                  <DialogDescription className="mb-4 text-sm text-muted-foreground">
                    {t("checkBillNothingToPay")}
                  </DialogDescription>
                  <Button variant="neubrutal" className="h-11 w-full" onClick={onClose}>
                    {t("checkBillClose")}
                  </Button>
                </>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <DialogTitle>{t("checkBillTitle")}</DialogTitle>
                    <DialogClose
                      aria-label={t("checkBillClose")}
                      className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-5 w-5" />
                    </DialogClose>
                  </div>

                  <div className="mb-4 flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">{t("checkBillTotal")}</span>
                    <span className="text-xl font-extrabold text-price">{formatVND(unpaidTotal)}</span>
                  </div>

                  <p className="mb-4 text-sm text-muted-foreground">{t("checkBillCashNotice")}</p>

                  {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

                  <Button
                    variant="neubrutal"
                    className="h-11 w-full"
                    disabled={isSubmitting}
                    onClick={handleConfirm}
                  >
                    {isSubmitting ? t("checkBillLoading") : t("checkBillConfirm")}
                  </Button>
                </>
              )}
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </DialogRoot>
    )
  }
  ```

- [ ] **Step 4: Update i18n**

  In `messages/vi.json` and `messages/en.json`'s `TableSession`
  namespace: remove `checkBillPayCash`, `checkBillPayCard`,
  `checkBillPayVNPay`, `checkBillSubtotal`, `checkBillDiscount`,
  `checkBillPromoPlaceholder`, `checkBillApplyPromo`,
  `checkBillPromoNotFound`, `checkBillPromoInactive`,
  `checkBillPromoNotStarted`, `checkBillPromoExpired`,
  `checkBillPromoLimitReached`, `checkBillPromoBelowMinimum`,
  `checkBillPromoCheckError`. Add `checkBillCashNotice`: vi "Nhân viên sẽ
  đến thu tiền mặt tại bàn." / en "A staff member will come collect cash
  payment at your table." Keep `checkBillTitle`, `checkBillTotal`,
  `checkBillNothingToPay`, `checkBillClose`, `checkBillError`,
  `checkBillLoading`, `checkBillConfirm` as-is (still used).

- [ ] **Step 5: Run test to verify it passes**

  Run: `npx vitest run components/customer/check-bill-sheet.component.test.tsx`
  Expected: PASS

- [ ] **Step 6: Delete `lib/supabase/promotions-data.ts`'s use here (already
  gone by construction) and confirm no other customer-facing file still
  imports it**

  Run: `grep -rn "promotions-data" app/ components/ hooks/`
  Expected matches only inside `components/admin/promotions-management.tsx`
  and `app/[locale]/admin/promotions/page.tsx` — both deleted in Task 19.
  If anything else matches, stop and investigate before continuing.

- [ ] **Step 7: Commit**

  ```bash
  git add components/customer/check-bill-sheet.tsx components/customer/check-bill-sheet.component.test.tsx messages/vi.json messages/en.json
  git commit -m "feat: simplify Check Bill to a single cash-only confirm, no method/promo UI"
  ```

### Task 7: Simplify `TableLanding` — drop the cart-transfer bridge and the cleaning block

**Files:**
- Modify: `components/customer/table-landing.tsx`
- Test: check for `components/customer/table-landing.component.test.tsx` (create if absent)

**Interfaces:**
- Produces: `TableLanding({ qrToken, categories, items })` — unchanged
  signature; internal behavior drops the `?cartTransfer=` handling and
  the `status === 'cleaning'` full-screen block (Decision 9/12).
- Consumes: `useTables().setActiveTableByToken` (unchanged).

- [ ] **Step 1: Rewrite the component**

  Replace `components/customer/table-landing.tsx` with:
  ```tsx
  "use client"

  import { useCallback, useEffect, useState } from "react"
  import { useSearchParams } from "next/navigation"
  import { useTranslations } from "next-intl"
  import { AlertCircle } from "lucide-react"
  import { Link } from "@/i18n/navigation"
  import { Button } from "@/components/ui/button"
  import { useTables, type TableRecord } from "@/hooks/useTables"
  import { TableOrderingSession } from "@/components/customer/table-ordering-session"
  import { saveActiveTable } from "@/lib/active-table-storage"
  import type { MenuCategory, MenuItem } from "@/lib/supabase/menu-data"
  import { AsyncRetryError, AsyncSkeleton } from "@/components/shared/async-state"
  import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

  export function TableLanding({
    qrToken,
    categories,
    items,
  }: {
    qrToken: string
    categories: MenuCategory[]
    items: MenuItem[]
  }) {
    const t = useTranslations("TableLanding")
    const searchParams = useSearchParams()
    const { setActiveTableByToken } = useTables()
    const [resolvedTable, setResolvedTable] = useState<TableRecord | null | undefined>(undefined)
    const [resolveError, setResolveError] = useState(false)

    const resolveTable = useCallback(async ({ isStale }: LoadContext) => {
      try {
        const table = await setActiveTableByToken(qrToken)
        if (isStale()) return
        setResolvedTable(table)
        setResolveError(false)
      } catch {
        if (!isStale()) setResolveError(true)
      }
    }, [qrToken, setActiveTableByToken])
    const { run: runTableResolve } = useLatestRefetch(resolveTable, 0)

    useEffect(() => {
      void runTableResolve()
    }, [qrToken, runTableResolve])

    useEffect(() => {
      if (resolvedTable) saveActiveTable(qrToken)
    }, [resolvedTable, qrToken])

    function handleRetryResolve() {
      setResolvedTable(undefined)
      setResolveError(false)
      void runTableResolve()
    }

    if (resolveError) {
      return (
        <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-6">
          <AsyncRetryError onRetry={handleRetryResolve} />
        </div>
      )
    }

    if (resolvedTable === undefined) {
      return <AsyncSkeleton variant="page" />
    }

    if (!resolvedTable) {
      return (
        <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
            <AlertCircle className="h-10 w-10 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-card-foreground">{t("invalidTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("invalidMessage")}</p>
          <Button className="h-11 w-full rounded-xl" render={<Link href="/menu" />} nativeButton={false}>
            {t("backToMenu")}
          </Button>
        </div>
      )
    }

    return (
      <TableOrderingSession
        table={resolvedTable}
        qrToken={qrToken}
        categories={categories}
        items={items}
        initialTab={searchParams.get("view") === "order" ? "order" : "menu"}
      />
    )
  }
  ```

  This drops: the `useCart`/`consumeTransfer` import, the
  `lib/table-cart-transfer` import, `importTableCart` import, the
  `cleaning`-status branch and its `notifyCleaning`/`Sparkles`/"Notify
  Staff" UI, and every `transferStatus`/`transferSnapshot`/`retryNonce`
  state and effect.

- [ ] **Step 2: Update/remove its i18n keys**

  In `messages/vi.json`/`messages/en.json`'s `TableLanding` namespace,
  remove `cleaningTitle`, `cleaningMessage`, `staffNotified`,
  `notifyStaff`, `transferringCart`, `transferFailedTitle`,
  `transferFailedMessage`, `retryTransfer`, `backToCheckout`. Keep
  `invalidTitle`, `invalidMessage`, `backToMenu`.

- [ ] **Step 3: Build**

  Run: `npm run build`
  Expected: succeeds. This will surface (via unused-import/unresolved
  errors elsewhere) if anything else still relied on
  `table-landing.tsx`'s old cleaning-block/transfer behavior — none
  should, per the dossier's dependency scan, but confirm.

- [ ] **Step 4: Commit**

  ```bash
  git add components/customer/table-landing.tsx messages/vi.json messages/en.json
  git commit -m "refactor: drop cart-transfer bridge and cleaning-state block from TableLanding"
  ```

---

## Part 4 — Delete the personal cart, checkout, and customer-account surfaces

### Task 8: Delete the personal cart/checkout routes (not `hooks/useCart.tsx` itself yet)

**Revised during execution:** the original version of this task also
deleted `hooks/useCart.tsx` and removed `CartProvider` from the customer
layout. That's wrong at this point in the sequence — three files that
are only cleaned up in *later* tasks (`components/customer/order-history.tsx`
and `components/customer/home-view.tsx`, both deleted whole in Tasks 9/10;
`components/customer/product-detail.tsx`, whose cart button is removed in
Task 11) still call `useCart()` for real, and all three render somewhere
under `app/[locale]/(customer)/layout.tsx`, so deleting the hook or its
provider now would break them out of order. Task 8 now deletes only the
routes/components that have zero other dependents; **Task 8B** (new,
inserted after Task 11 below) finishes the job once nothing else calls
`useCart()`.

**Files:**
- Delete:
  - `app/[locale]/(customer)/cart/page.tsx`
  - `app/[locale]/(customer)/checkout/page.tsx`
  - `components/customer/cart-view.tsx`
  - `components/customer/cart-view.component.test.tsx`
  - `components/customer/checkout-view.tsx`
  - `components/customer/checkout-view.component.test.tsx`
- Modify: `components/customer/bottom-nav.tsx`, `components/customer/header.tsx`
  (drop cart-link/cart-count UI — grep each first)

**Correction made during execution:** `lib/table-cart-transfer.ts` is
**not** deleted by this task after all — `hooks/useCart.tsx:13` imports
`subtractTransferredQuantities` from it as a real runtime function (used
inside `consumeTransfer()`), not just a type as an earlier draft of this
brief assumed. It stays in place until Task 8B deletes it alongside
`hooks/useCart.tsx` itself (Task 8B's file list already includes it).

- [ ] **Step 1: Confirm nothing outside `hooks/useCart.tsx` depends on
  the doomed cart/checkout files**

  Run:
  ```bash
  grep -rln "cart-view\|checkout-view" app/ components/ hooks/ lib/
  ```
  Expected: only the files in this task's own Delete list. If anything
  else prints, stop and resolve it before deleting.

- [ ] **Step 2: Delete the files**

  ```bash
  git rm app/\[locale\]/\(customer\)/cart/page.tsx
  git rm app/\[locale\]/\(customer\)/checkout/page.tsx
  git rm components/customer/cart-view.tsx components/customer/cart-view.component.test.tsx
  git rm components/customer/checkout-view.tsx components/customer/checkout-view.component.test.tsx
  ```

- [ ] **Step 3: Clean up `bottom-nav.tsx` and `header.tsx`**

  Read both files, remove any cart icon/badge/link that pointed at
  `/cart` (grep `href="/cart"` in both first). **Leave any `useCart()`
  call in these two files alone if it exists for a non-cart-link reason**
  — check carefully; if `header.tsx`'s cart badge reads
  `useCart().itemCount` purely to render the `/cart` link's badge, remove
  that whole badge (its only purpose, `/cart`, is gone); if `useCart()`
  is called for any other still-relevant reason in either file, keep it
  (this task does not remove `hooks/useCart.tsx` itself, so calling it is
  still valid here).

- [ ] **Step 4: Build**

  Run: `npm run build`
  Expected: fails initially with unresolved imports wherever step 3
  missed a `/cart` reference — fix each until it succeeds. A failure
  caused by `order-history.tsx`, `home-view.tsx`, or `product-detail.tsx`
  is NOT this task's responsibility to fix (those are Tasks 9/10/11) —
  if the build fails only because of one of those three files and the
  failure is unrelated to anything this task touched, that means
  something upstream of this task regressed unexpectedly; stop and
  report rather than fixing it, since this task's own changes shouldn't
  be able to affect those files at all.

- [ ] **Step 5: Run the full test suite**

  Run: `npm test`
  Expected: PASS (any test file that referenced the deleted modules was
  itself deleted in Step 2).

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete personal cart/checkout routes (useCart.tsx itself follows in Task 8B)"
  ```

### Task 8A: Fix `MenuBrowser`'s dead `/cart` link inside the table ordering session

**Inserted during execution** — Task 8's implementer found this while
deleting `/cart`: `MenuBrowser`'s floating "view cart" pill (rendered
whenever `cartItemCount > 0`) links to a `cartHref` prop that defaults to
`"/cart"`. `components/customer/table-ordering-session.tsx:141-147` (the
permanent shared-table-cart screen — the ONLY caller that ever has
`cartItemCount > 0`, since the standalone `/menu` page always passes
`canOrder={false}` and thus never shows this pill) never overrides that
prop, so the pill is a live dead link to a route that no longer exists.
Nothing later in this plan touches this. Fix it now rather than let a
real customer-facing screen carry a 404 link for the rest of this
rebuild's execution.

**Files:**
- Modify: `components/customer/menu-browser.tsx`, `components/customer/table-ordering-session.tsx`

- [ ] **Step 1: Replace the `cartHref` prop with an `onViewCart` callback**

  In `menu-browser.tsx`: remove the `cartHref = "/cart"` prop entirely.
  Add `onViewCart?: () => void` to the props type. Where the floating
  pill currently renders as `<Link href={cartHref} ...>`, change it to
  render only when `onViewCart` is provided, as a `<button type="button"
  onClick={onViewCart} ...>` with the same visual classes (drop the
  `Link`/`href` and its `next/navigation`-specific styling concerns, keep
  everything else — text, item count, subtotal — identical). If
  `onViewCart` is not provided, render nothing (no pill) rather than a
  link to a now-nonexistent page.

- [ ] **Step 2: Wire it up in `table-ordering-session.tsx`**

  Pass `onViewCart={() => setTab("order")}` to `<MenuBrowser>` (switches
  to the same screen's "order" tab instead of navigating anywhere).

- [ ] **Step 3: Update `menu-browser.component.test.tsx` if it references `cartHref`**

  Grep the test file for `cartHref`; if present, remove/replace it per
  the new prop (the existing tests from Task 3 didn't test this pill
  directly, so this is likely a no-op check, not a required change).

- [ ] **Step 4: Build**

  Run: `npm run build`
  Expected: succeeds.

- [ ] **Step 5: Run the full test suite**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add components/customer/menu-browser.tsx components/customer/table-ordering-session.tsx
  git commit -m "fix: replace MenuBrowser's dead /cart link with an in-page tab switch"
  ```

### Task 9: Delete customer accounts, profile, loyalty, addresses, reviews, and order tracking

**Files:**
- Delete:
  - `app/[locale]/(auth)/callback/` (Google OAuth callback — customer-only,
    Google sign-in is removed per Decision 3)
  - `app/[locale]/(auth)/signup/` (customer signup — removed)
  - `app/[locale]/(auth)/reset-password/` (self-service reset — removed
    per Decision 19)
  - **Keep** `app/[locale]/(auth)/login/page.tsx` and
    `app/[locale]/(auth)/layout.tsx` untouched — this is the
    staff/manager/admin sign-in page (Decision 3) and the route group's
    shared layout; deleting the whole `(auth)/` directory would remove
    the one login surface the entire staff/admin side of the app still
    needs.
  - `app/[locale]/(customer)/profile/` (entire directory)
  - `app/[locale]/(customer)/loyalty/` (entire directory)
  - `app/[locale]/(customer)/orders/` (entire directory)
  - `components/customer/address-book-view.tsx`
  - `components/customer/loyalty-view.tsx`
  - `components/customer/my-redemptions-view.tsx`
  - `components/customer/order-history.tsx`
  - `components/customer/order-tracking.tsx`
  - `components/customer/profile-settings-view.tsx`
  - `components/customer/profile-view.tsx`
  - `components/customer/review-form.tsx`
  - `components/customer/rewards-catalog-modal.tsx`
  - `components/customer/star-rating.tsx`
  - `lib/supabase/address-data.ts`, `lib/supabase/address-data.test.ts`
  - `lib/supabase/loyalty-data.ts`, `lib/supabase/loyalty-data.test.ts`
  - `lib/supabase/rewards-data.ts`, `lib/supabase/rewards-data.test.ts`
  - `lib/supabase/reviews-data.ts`, `lib/supabase/reviews-data.test.ts`
  - `lib/supabase/profile-data.ts`, `lib/supabase/profile-data.test.ts`
  - `lib/supabase/order-tracking.ts`
  - `hooks/useOrders.tsx`
- Modify: `app/[locale]/(customer)/layout.tsx` (remove `OrdersProvider`),
  `lib/supabase/orders-data.ts` (barrel — see Step 3),
  `components/customer/bottom-nav.tsx`, `components/customer/header.tsx`
  (drop profile/loyalty/orders nav links)

**Correction made during execution:** the original file list above also
had `lib/supabase/order-history.ts`, `hooks/useOrderHistory.tsx`, and
`hooks/useOrderHistory.test.ts` — that was wrong despite the name
similarity to `components/customer/order-history.tsx` (the customer's
own order-history view, correctly deleted here). `lib/supabase/order-history.ts`
is exclusively a **staff** query module (`get_order_history()`), imported
only by `app/[locale]/staff/orders/history/*`, `components/staff/order-history-list.tsx`,
`order-history-detail.tsx`, and `hooks/useOrderHistory.tsx` itself — all
of which survive until **Task 17** ("Delete Staff Order History and
Rewards lookup"). Task 17's own file list has been corrected to include
these three files instead. Task 9 does not touch them.

- [ ] **Step 1: Confirm the product-detail page's review UI is the only
  remaining `reviews-data`/`review-form`/`star-rating` consumer**

  Run: `grep -rln "review-form\|star-rating\|reviews-data" app/ components/`
  Expected matches: `components/customer/product-detail.tsx` (review
  section — remove it there in Step 4), `components/admin/menu-item-reviews-panel.tsx`
  (admin-side reviews panel — deleted in Task 19 alongside the rest of
  `/admin/menu`'s now-irrelevant review moderation UI; if `menu-item-reviews-panel.tsx`
  is otherwise wired into the kept `/admin/menu` page, remove that wiring
  in Task 19's step for `menu-management.tsx`, not here).

- [ ] **Step 2: Delete the files listed above**

  ```bash
  git rm -r "app/[locale]/(auth)/callback"
  git rm -r "app/[locale]/(auth)/signup"
  git rm -r "app/[locale]/(auth)/reset-password"
  git rm -r "app/[locale]/(customer)/profile"
  git rm -r "app/[locale]/(customer)/loyalty"
  git rm -r "app/[locale]/(customer)/orders"
  git rm components/customer/address-book-view.tsx components/customer/loyalty-view.tsx components/customer/my-redemptions-view.tsx
  git rm components/customer/order-history.tsx components/customer/order-tracking.tsx
  git rm components/customer/profile-settings-view.tsx components/customer/profile-view.tsx
  git rm components/customer/review-form.tsx components/customer/rewards-catalog-modal.tsx components/customer/star-rating.tsx
  git rm lib/supabase/address-data.ts lib/supabase/address-data.test.ts
  git rm lib/supabase/loyalty-data.ts lib/supabase/loyalty-data.test.ts
  git rm lib/supabase/rewards-data.ts lib/supabase/rewards-data.test.ts
  git rm lib/supabase/reviews-data.ts lib/supabase/reviews-data.test.ts
  git rm lib/supabase/profile-data.ts lib/supabase/profile-data.test.ts
  git rm lib/supabase/order-tracking.ts
  git rm hooks/useOrders.tsx
  ```

- [ ] **Step 3: Simplify the `orders-data.ts` barrel**

  Read `lib/supabase/orders-data.ts`. It re-exports from `order-tracking.ts`
  (just deleted), `order-kds.ts` (kept — KDS), and `order-history.ts`
  (kept until Task 17 — see the correction note above). Only one of the
  barrel's three re-exports is actually dead here. Prefer deleting
  `lib/supabase/orders-data.ts` entirely anyway (matches this project's
  convention of not using barrel files in this directory) and repoint
  every importer directly at whichever real module it needs:
  `components/staff/kitchen-board.tsx`, `kitchen-display.tsx`,
  `kitchen-pending-payment.tsx` (deleted in Task 13 anyway),
  `payment-method-picker.tsx`, `hooks/useKitchenOrders.tsx` →
  `@/lib/supabase/order-kds`; `app/[locale]/staff/orders/history/*`,
  `components/staff/order-history-list.tsx`, `order-history-detail.tsx`,
  `hooks/useOrderHistory.tsx` → `@/lib/supabase/order-history` (these
  survive until Task 17 either way, so they need a real, working import
  path in the meantime, not a deleted barrel).

- [ ] **Step 4: Remove the review section from `product-detail.tsx`**

  Read `components/customer/product-detail.tsx`, remove its review
  list/`ReviewForm`/`StarRating` rendering and any `getMenuItemReviews`-
  style data fetch tied to it, keeping the read-only item detail
  (name/description/image/price/sizes).

- [ ] **Step 5: Remove `OrdersProvider` from the customer layout**

  In `app/[locale]/(customer)/layout.tsx`, remove the `OrdersProvider`
  import and wrapping JSX. Only `TablesProvider` should remain.

- [ ] **Step 6: Clean up nav links**

  In `components/customer/bottom-nav.tsx` and `components/customer/header.tsx`,
  remove any link to `/profile`, `/loyalty`, `/orders`, `/login`
  (customer-facing sign-in entry point — a staff sign-in link is added
  fresh in Task 11, this is about removing the *customer*-facing one).

- [ ] **Step 7: Build**

  Run: `npm run build`
  Expected: fails on remaining stray imports — resolve each, then
  succeeds.

- [ ] **Step 8: Run the full test suite**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 9: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete customer accounts, profile, loyalty, address book, reviews, order tracking"
  ```

---

## Part 5 — New minimal customer entry points

### Task 10: New root `/` page

**Files:**
- Modify: `app/[locale]/(customer)/page.tsx`
- Delete: `components/customer/home-view.tsx`, `components/customer/best-sellers-arc.tsx`,
  `components/customer/best-sellers-arc.test.ts` (if present — check with
  `find components/customer -name "best-sellers*"`)
- Modify: `messages/vi.json`, `messages/en.json` (`Home` namespace →
  replace with a small new set of keys, see Step 2)

**Interfaces:**
- Produces: `app/[locale]/(customer)/page.tsx` renders a static "scan the
  QR code" screen with a `/login` link labeled for staff.

- [ ] **Step 1: Replace the root page**

  Read the current `app/[locale]/(customer)/page.tsx` first (to see its
  exact current data-fetching, since it currently renders the merged
  Home dashboard). Replace its entire contents with:
  ```tsx
  import { getTranslations } from "next-intl/server"
  import { QrCode } from "lucide-react"
  import { Link } from "@/i18n/navigation"

  export default async function HomePage() {
    const t = await getTranslations("Home")
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
          <QrCode className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("scanTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("scanMessage")}</p>
        <Link href="/login" className="mt-4 text-sm font-semibold text-muted-foreground underline underline-offset-4">
          {t("staffLogin")}
        </Link>
      </div>
    )
  }
  ```

- [ ] **Step 2: Replace the `Home` i18n namespace**

  In both `messages/vi.json` and `messages/en.json`, replace the entire
  `Home` namespace's contents with just:
  - vi: `{"scanTitle": "Quét mã QR tại bàn để gọi món", "scanMessage": "Mỗi bàn có một mã QR riêng — quét mã đó để xem menu và đặt món.", "staffLogin": "Nhân viên đăng nhập"}`
  - en: `{"scanTitle": "Scan the QR code at your table to order", "scanMessage": "Every table has its own QR code — scan it to view the menu and place an order.", "staffLogin": "Staff sign in"}`

- [ ] **Step 3: Delete the now-unused Home components**

  ```bash
  git rm components/customer/home-view.tsx
  git rm components/customer/best-sellers-arc.tsx
  git rm components/customer/best-sellers-arc.test.ts 2>/dev/null || true
  ```
  (The `git status` at the start of this project's work showed
  `best-sellers-arc.tsx` as locally modified/uncommitted — check `git
  log -- components/customer/best-sellers-arc.tsx` and `git diff` before
  deleting to make sure no unrelated in-flight work is silently lost; if
  there are uncommitted changes unrelated to this plan, stash them first
  and flag it rather than deleting over them.)

- [ ] **Step 4: Build**

  Run: `npm run build`
  Expected: succeeds once every `home-view`/`best-sellers-arc` importer
  (should be none besides the old root page) is gone.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: replace Home with a minimal scan-QR entry point"
  ```

### Task 11: Make `/menu` and `/menu/[itemId]` public, read-only, and lock ordering

**Files:**
- Modify: `app/[locale]/(customer)/menu/page.tsx`,
  `app/[locale]/(customer)/menu/[itemId]/page.tsx`,
  `components/customer/product-detail.tsx`

**Interfaces:**
- Consumes: `MenuBrowser({ ..., canOrder: false })` (Task 3).

- [ ] **Step 1: Update the menu list page**

  ```tsx
  // app/[locale]/(customer)/menu/page.tsx
  import { getTranslations } from "next-intl/server"
  import { MenuBrowser } from "@/components/customer/menu-browser"
  import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"

  export default async function MenuPage() {
    const t = await getTranslations("Customer")
    const { categories, items } = await getPublicMenuData()

    return (
      <>
        <h1 className="sr-only">{t("menuTitle")}</h1>
        <MenuBrowser categories={categories} items={items} canOrder={false} />
      </>
    )
  }
  ```

- [ ] **Step 2: Confirm `product-detail.tsx` has no add-to-cart action
  left reachable from this standalone route**

  After Task 9 Step 4 removed its review section, read the remaining
  file: if it still renders an "Add to cart" button wired to `useCart`
  (it shouldn't — that import was never legitimate here since this page
  has no table context — grep to confirm:
  `grep -n "useCart" components/customer/product-detail.tsx`), remove
  that button entirely; this page is view-only (name, description,
  image, price, sizes list shown informationally, no way to add
  anything, since there's no `qrToken` in this route to attach an order
  to). If the grep finds nothing, no change needed here beyond Task 9's
  review-section removal.

- [ ] **Step 3: Build and manually verify**

  Run: `npm run build`. Then, using the Chrome DevTools MCP against a
  local `npm run dev` instance (fast local check; full live verification
  happens in Task 27), open `/vi/menu`, confirm items render with a
  visibly disabled add button, and open `/vi/menu/<any-item-id>` to
  confirm it renders read-only with no console errors.

- [ ] **Step 4: Commit**

  ```bash
  git add app/\[locale\]/\(customer\)/menu components/customer/product-detail.tsx
  git commit -m "feat: make /menu and /menu/[itemId] public read-only pages"
  ```

### Task 8B: Delete `hooks/useCart.tsx` and remove `CartProvider` from the customer layout

**Inserted during execution** (see Task 8's revision note) — this is the
second half of the original Task 8, deferred until every real caller of
`useCart()` is gone. By this point Task 9 deleted
`components/customer/order-history.tsx`, Task 10 deleted
`components/customer/home-view.tsx`, and Task 11 removed
`product-detail.tsx`'s add-to-cart button — the only three files (besides
the already-deleted cart/checkout views) that ever called `useCart()`
for real, per the dossier research this plan was built from.

**Files:**
- Delete: `hooks/useCart.tsx`, `hooks/useCart.test.ts` (if it exists —
  check first: `find hooks -iname "useCart*test*"`), `lib/table-cart-transfer.ts`,
  `lib/table-cart-transfer.test.ts` (Task 8 deferred these here — see its
  revision note; `hooks/useCart.tsx` is their only remaining dependent)
- Modify: `app/[locale]/(customer)/layout.tsx` (remove `CartProvider`)

- [ ] **Step 1: Confirm zero remaining callers**

  Run:
  ```bash
  grep -rln "useCart\|hooks/useCart\|table-cart-transfer" app/ components/ hooks/ lib/ | grep -v -E "^hooks/useCart|^lib/table-cart-transfer"
  ```
  Expected: empty. If anything prints, stop — this means Task 9, 10, or
  11 missed a caller, or a new one was introduced since; do not delete
  `hooks/useCart.tsx` until this is genuinely empty.

- [ ] **Step 2: Delete the hook and its transfer-bridge dependency**

  ```bash
  git rm hooks/useCart.tsx
  git rm hooks/useCart.test.ts 2>/dev/null || true
  git rm lib/table-cart-transfer.ts lib/table-cart-transfer.test.ts
  ```

- [ ] **Step 3: Remove `CartProvider` from the customer layout**

  Read `app/[locale]/(customer)/layout.tsx` in full first. Remove the
  `CartProvider` import and its wrapping JSX. Keep `TablesProvider` and
  `OrdersProvider` (the latter is removed separately in Task 9, which
  runs before this task — if it's already gone by the time you read this
  file, that's expected, just don't reintroduce it).

- [ ] **Step 4: Build**

  Run: `npm run build`
  Expected: succeeds — every real caller was already removed by Tasks
  9-11.

- [ ] **Step 5: Run the full test suite**

  Run: `npm test`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete hooks/useCart.tsx and CartProvider now that nothing calls it"
  ```

---

## Part 6 — Staff area rebuild

### Task 12: Delete POS

**Files:**
- Delete: `app/[locale]/staff/pos/page.tsx`, `components/staff/pos-terminal.tsx`,
  `components/staff/pos-item-picker.tsx`

- [ ] **Step 1: Confirm nothing else imports these**

  Run: `grep -rln "pos-terminal\|pos-item-picker" app/ components/`
  Expected: only the files being deleted, plus `staff-nav.tsx`'s
  `/staff/pos` link (fixed in Task 15) and `admin-nav-items.ts`'s
  `ADMIN_FULFILLMENT_NAV_ITEMS` entry (fixed in Task 21).

- [ ] **Step 2: Delete**

  ```bash
  git rm "app/[locale]/staff/pos/page.tsx"
  git rm components/staff/pos-terminal.tsx components/staff/pos-item-picker.tsx
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete POS — every order now goes through a customer scanning a table QR"
  ```

### Task 13: Simplify `PaymentMethodPicker` to cash-only; delete the dead pending-payment banner

**Files:**
- Modify: `components/staff/payment-method-picker.tsx`, `components/staff/kitchen-board.tsx`,
  `components/staff/kitchen-display.tsx`
- Delete: `components/staff/kitchen-pending-payment.tsx`

**Interfaces:**
- Produces: `PaymentMethodPicker` keeps its existing external props but
  internally only ever renders/returns `"cash"` — read the current file
  first to give an exact diff rather than guessing its full prop
  surface.

- [ ] **Step 1: Read the current `payment-method-picker.tsx`, `kitchen-board.tsx`,
  and `kitchen-display.tsx` in full**

  This file wasn't fully read during planning research (only its call
  sites were identified: `kitchen-board.tsx`, `kitchen-pending-payment.tsx`,
  `kitchen-tables-column.tsx`). Read all three now to see its exact
  props/return shape before editing.

- [ ] **Step 2: Simplify `PaymentMethodPicker`**

  If it currently renders 3 buttons (cash/stripe/vnpay) and calls back
  with the chosen method, change it to either (a) auto-confirm cash
  immediately with a single "Xác nhận đã thu tiền" button and no
  picker UI at all (preferred — there's only one method left, so
  "picking" is meaningless), renaming the component to
  `ConfirmCashPayment` if that better reflects its new job, or (b) if
  time-boxing the rename, keep the file/component name but strip it down
  to a single button that always invokes its callback with `"cash"`.
  Prefer (a) for clarity; update every call site's import/usage to
  match. Update its test file if one exists
  (`find components/staff -iname "payment-method-picker*test*"`).

- [ ] **Step 3: Delete the dead pending-payment banner**

  `kitchen-pending-payment.tsx` shows a banner for orders in the
  `pending_payment` status — a status only ever reached by the old
  non-table Pay-Now checkout flow, which no longer exists (every order
  now starts via `place_table_round`, always landing at `pending`, never
  `pending_payment`). Remove its import/render from `kitchen-display.tsx`,
  then:
  ```bash
  git rm components/staff/kitchen-pending-payment.tsx
  ```

- [ ] **Step 4: Remove any now-dead payment-method UI from `kitchen-board.tsx`**

  Per the dossier, `kitchen-board.tsx` shows `PaymentMethodPicker` "khi
  cần confirm payment" on an individual ticket — since Decision 6
  removes Pickup and every order is a table round settled in aggregate
  via the Tables page (Task 16), confirm whether this per-ticket
  confirm path can still be reached at all. If `kitchen-board.tsx`'s
  payment-confirm branch is keyed on `order.payment_status === 'pending'
  && order.table_id === null` (a non-table order) or similar, it's dead
  and should be deleted along with its handler. If it's reachable for a
  table order too (e.g. a fallback), leave it wired to the simplified
  cash-only picker from Step 2 rather than deleting it — don't remove
  behavior you can't confirm is unreachable; note whichever conclusion
  you reach in the commit message.

- [ ] **Step 5: Build**

  Run: `npm run build`

- [ ] **Step 6: Run tests**

  Run: `npm test`

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "refactor: simplify payment confirmation to cash-only, remove dead pending-payment banner"
  ```

### Task 14: Remove the shift concept from the staff area

**Files:**
- Modify: `app/[locale]/staff/orders/layout.tsx` (removed entirely in
  Task 16's restructure, but strip `ShiftProvider` now as an isolated
  step), `components/staff/staff-orders-layout-client.tsx`,
  `components/staff/kitchen-top-bar.tsx`

**Interfaces:**
- Removes: `ShiftProvider`/`useShift` usage from every staff page.

- [ ] **Step 1: Read `hooks/useShift.tsx`, `staff-orders-layout-client.tsx`,
  and `kitchen-top-bar.tsx` in full**

  Confirm exactly what UI `useShift()`'s `isShiftOpen`/join/leave affordance
  renders in `KitchenTopBar` before removing it.

- [ ] **Step 2: Remove the shift UI**

  In `kitchen-top-bar.tsx`, delete the shift-open/join/leave
  button/indicator, keeping the realtime-connection indicator (still
  backed by `useKitchenOrders()`). In `staff-orders-layout-client.tsx`,
  remove any prop threading that only existed to pass shift state down.
  In `app/[locale]/staff/orders/layout.tsx`, remove the `ShiftProvider`
  import and its wrapping JSX around `KitchenOrdersProvider`.

- [ ] **Step 3: Leave `hooks/useShift.tsx` and `lib/supabase/shift-data.ts`
  in place for now**

  They become unused application code after this task; Task 17 deletes
  them together with the rest of Shift Closing once nothing imports them
  (confirm with `grep -rln "useShift\|shift-data" app/ components/ hooks/`
  before that deletion — it should show nothing outside
  `components/admin/shift-closing.tsx`, `shift-report-detail.tsx`,
  `staff-shift-history.tsx`, `app/[locale]/admin/shift/`, and
  `app/[locale]/staff/orders/shift-history/`, all deleted in Task 17).

- [ ] **Step 4: Build**

  Run: `npm run build`

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "refactor: remove the shift open/close UI from the staff area"
  ```

### Task 15: Simplify table status from 3-state to binary "has an open session"

**Files:**
- Modify: `components/staff/kitchen-tables-column.tsx`, `hooks/useTables.tsx`,
  `lib/supabase/tables-data.ts`

**Interfaces:**
- Produces: `useTables()` keeps `notifyCleaning`/`setStatus` removed if,
  after this task's grep check, nothing else calls them (see Step 3);
  `kitchen-tables-column.tsx` renders each table as either "trống"
  (empty — no open `table_sessions` row) or "đang phục vụ" (in service —
  has one), instead of a 3-way cycle button.

- [ ] **Step 1: Read `kitchen-tables-column.tsx` and `hooks/useTables.tsx`
  in full**

  Confirm the exact current 3-state cycle button implementation and
  every other `useTables()` consumer before changing the hook's public
  surface.

- [ ] **Step 2: Replace the 3-state cycle button with a binary badge**

  In `kitchen-tables-column.tsx`, replace the "cycle through
  available/occupied/cleaning" button with a read-only badge computed
  from whether the table currently has an open `table_sessions` row
  (this data should already be available via the table session
  Realtime/query this component already subscribes to for showing
  active carts/rounds — reuse that, don't add a second query). Remove
  the "cleaning notified" badge/urgent-alert UI (Decision 12 — no more
  cleaning state to be notified about). Keep the "Xác nhận đã thu tiền"
  action (wired to the simplified cash-only confirm from Task 13).

- [ ] **Step 3: Check whether `setStatus`/`notifyCleaning` become fully
  unused**

  Run: `grep -rln "setStatus\|notifyCleaning" app/ components/ hooks/`
  If the only remaining matches are inside `hooks/useTables.tsx` itself
  and `components/admin/tables-management.tsx` (rewritten in Task 16),
  remove `setStatus`/`notifyCleaning` and their backing
  `setTableStatus`/`notifyTableCleaning` calls from `hooks/useTables.tsx`
  and `lib/supabase/tables-data.ts` once Task 16 also stops using them.
  Do this removal as part of Task 16 instead if Task 16 is the last
  remaining caller — don't leave it half-done here.

- [ ] **Step 4: Build**

  Run: `npm run build`

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "refactor: replace 3-state table status UI with a binary open-session indicator"
  ```

### Task 16: Merge KDS + Tables into one staff "Operations" area; absorb table CRUD

**Files:**
- Create: `app/[locale]/staff/tables/page.tsx`, `app/[locale]/staff/tables/layout.tsx` (if a
  dedicated layout is warranted — likely not; reuse `staff/orders/layout.tsx`'s
  shared shell, see Step 2), `components/staff/tables-operations-view.tsx`
- Modify: `app/[locale]/staff/orders/layout.tsx` (rename/repurpose as the
  shared "operations" shell for both `/staff/orders` and `/staff/tables`),
  `components/staff/staff-orders-layout-client.tsx` (add a KDS/Tables tab
  switcher), `components/staff/staff-nav.tsx`, `lib/roles.ts`
- Modify: `components/admin/tables-management.tsx` → merge its CRUD
  (add table, rename, QR view/regen) into the new
  `components/staff/tables-operations-view.tsx`, then delete the admin
  original (this file's deletion is tracked here since it's absorbed,
  not simply removed — Task 19 covers the rest of `/admin/tables`'
  page/layout files)

**Interfaces:**
- Produces: `/staff/tables` route, gated identically to `/staff/orders`
  (staff|manager|admin, per existing `staff/layout.tsx`).

- [ ] **Step 1: Read `components/admin/tables-management.tsx`,
  `components/admin/table-form.tsx`, and `lib/supabase/tables-data.ts` in
  full**

  Note every exported function used for CRUD (`addTable`, `renameTable`,
  `updateLocation`, `getQrTokens`/`get_tables_admin`, `regenerateToken`)
  and every prop `tables-management.tsx` and `table-form.tsx` expose, so
  the merged component reuses them exactly rather than reinventing them.

- [ ] **Step 2: Decide the shared shell**

  Read `app/[locale]/staff/orders/layout.tsx` and
  `staff-orders-layout-client.tsx` in full. Repurpose them as the shell
  for *both* tabs: add a two-item tab/segmented-control ("KDS" /
  "Tables") in `StaffOrdersLayoutClient` that links between
  `/staff/orders` and the new `/staff/tables`, both wrapped by the same
  `ShiftProvider`-free (per Task 14), `KitchenOrdersProvider`-wrapped
  layout. Since `kitchen-tables-column.tsx` (the existing KDS "Tables"
  4th column) already needs `TablesProvider` (per
  `app/[locale]/staff/orders/page.tsx`'s existing comment), move
  `TablesProvider` up into this shared layout so both `/staff/orders`
  (KDS board, which after this task drops its embedded Tables column —
  see Step 3) and `/staff/tables` (the new dedicated page) can use it.

- [ ] **Step 3: Remove the embedded Tables column from the KDS board**

  In `components/staff/kitchen-display.tsx`, remove the
  `KitchenTablesColumn` usage as a 4th board column (it's about to become
  its own full page) — `kitchen-display.tsx` should render only the
  ticket board (New/Preparing/Ready) after this change.

- [ ] **Step 4: Build `components/staff/tables-operations-view.tsx`**

  New component combining: the table list + binary open-session badge +
  "Xác nhận đã thu tiền" action from `kitchen-tables-column.tsx` (moved
  here wholesale, not duplicated — delete it from
  `kitchen-tables-column.tsx`'s old home and have this be its new home;
  rename the file if that's clearer, e.g. keep `kitchen-tables-column.tsx`'s
  logic but rename to `tables-operations-view.tsx` via `git mv` then
  edit), plus the table CRUD (add/rename/QR view/regenerate token) merged
  in from `tables-management.tsx`/`table-form.tsx`.

- [ ] **Step 5: Create the new route**

  ```tsx
  // app/[locale]/staff/tables/page.tsx
  import { getTranslations } from "next-intl/server"
  import { TablesOperationsView } from "@/components/staff/tables-operations-view"

  export default async function StaffTablesPage() {
    const t = await getTranslations("Staff")
    return (
      <div className="h-full">
        <h1 className="sr-only">{t("tablesTitle")}</h1>
        <TablesOperationsView />
      </div>
    )
  }
  ```
  Add `Staff.tablesTitle` to both message files (vi: "Quản lý bàn", en:
  "Tables").

- [ ] **Step 6: Update `staff-nav.tsx`**

  ```typescript
  const NAV_ITEMS = [
    { href: "/staff/orders", labelKey: "kitchenDisplay" },
    { href: "/staff/tables", labelKey: "tables" },
  ] as const
  ```
  Remove the `canAccessAdmin(role) ? [...NAV_ITEMS, {href: "/admin/dashboard", ...}] : NAV_ITEMS`
  branch entirely — `/admin/dashboard` no longer exists (Task 19); admin/
  manager reach `/admin/menu` via a different, already-existing nav
  surface (the admin sidebar, unaffected by this file). Add
  `Nav.tables` to both message files if not already present (check
  first — `Nav` likely already has a generic `tables` key from the old
  admin sidebar; reuse it, don't duplicate).

- [ ] **Step 7: Update `lib/roles.ts`**

  ```typescript
  export const ROLE_HOME: Record<string, string> = {
    staff: "/staff/orders",
    manager: "/staff/orders",
    admin: "/staff/orders",
  }

  export function canAccessAdmin(role: string | null): boolean {
    return role === "manager" || role === "admin"
  }
  ```
  (`customer` is dropped from `ROLE_HOME` — there is no customer-facing
  destination to send a role to anymore; every guest lands wherever they
  navigated, per Decision 3. `manager`/`admin` now land on `/staff/orders`
  too, since `/admin/dashboard` is gone — Task 19 confirms `/admin/menu`
  remains reachable via the admin sidebar directly, not via `ROLE_HOME`.)

- [ ] **Step 8: Delete the absorbed admin Tables files**

  ```bash
  git rm components/admin/tables-management.tsx components/admin/table-form.tsx
  ```
  (The route files `app/[locale]/admin/tables/page.tsx` and `layout.tsx`
  are deleted in Task 19 alongside the rest of the admin trim — don't
  duplicate that deletion here, just the components this task already
  merged elsewhere.)

- [ ] **Step 9: Build**

  Run: `npm run build`

- [ ] **Step 10: Run tests**

  Run: `npm test` — pay particular attention to
  `components/staff/kitchen-tables-column.component.test.tsx`; move/adapt
  it alongside the file's move in Step 4 rather than leaving it stranded
  pointing at a deleted path.

- [ ] **Step 11: Commit**

  ```bash
  git add -A
  git commit -m "feat: merge KDS + Tables into one staff operations area, absorb table CRUD"
  ```

### Task 16B: Fix `/login` — remove Google sign-in, forgot-password, and signup (all three point at deleted routes)

**Inserted during execution — a real, live bug found by Task 16's
reviewer, not anticipated anywhere in the original plan.** `/login`
(`components/auth/login-form.tsx`) is the ONE auth surface that survives
this entire rebuild (staff/manager/admin sign in there — Decision 3).
Nobody in the original planning research ever read this file's actual
contents. It currently has THREE flows that are now broken because their
target routes were deleted back in Task 9:
- A "Sign in with Google" button (`handleGoogleSignIn`) redirecting to
  `/${locale}/callback` — that route (`(auth)/callback/`) is deleted.
  Google sign-in is out of scope entirely per Decision 3.
- A "Forgot password?" flow (`handleSendResetLink`, the
  `requestReset`/`resetSent` view states) redirecting to
  `/${locale}/reset-password` — that route is deleted. Per Decision 19,
  there is no self-service password reset for anyone; a forgotten staff
  password is reset manually via the Supabase Dashboard.
- A "Don't have an account? Sign up" link to `/signup` — that route is
  deleted. Nobody self-registers in this app anymore; staff accounts are
  created via `/admin/staff`.

Additionally, `components/auth/` has 4 files nothing reachable renders
anymore: `signup-form.tsx`, `oauth-callback.tsx`,
`reset-password-view.tsx` (each backed exactly one of the three deleted
routes above), and `google-icon.tsx` (only used by `login-form.tsx`'s
Google button and `signup-form.tsx`, both going away). This is a gap in
Task 9's original file list — it deleted the route *directories* but
never looked at this separate shared-component directory.

**Files:**
- Modify: `components/auth/login-form.tsx`,
  `components/auth/auth-forms.component.test.tsx`, `messages/vi.json`,
  `messages/en.json`
- Delete: `components/auth/signup-form.tsx`,
  `components/auth/oauth-callback.tsx`,
  `components/auth/reset-password-view.tsx`,
  `components/auth/google-icon.tsx`

- [ ] **Step 1: Confirm no other real caller of the 4 files to delete**

  Run:
  ```bash
  grep -rln "signup-form\|oauth-callback\|reset-password-view\|google-icon" app/ components/ hooks/ lib/
  ```
  Expected: only the 4 files themselves and `login-form.tsx` (for
  `google-icon`, removed in Step 2) and `auth-forms.component.test.tsx`
  (for `signup-form`, fixed in Step 4). If anything else prints, stop
  and investigate before deleting.

- [ ] **Step 2: Rewrite `login-form.tsx`**

  Remove entirely: the `GoogleIcon` import, `oauthLoading` state,
  `handleGoogleSignIn`, the "or" divider + "Continue with Google" button
  block. Remove entirely: `view`/`resetEmail`/`resetError`/`isSendingReset`
  state, `handleSendResetLink`, the `requestReset` and `resetSent`
  render branches, and the "Forgot password?" button that switches to
  them (keep the password `<Input>` field itself, just drop the link
  below it). Remove entirely: the closing "Don't have an account? Sign
  up" paragraph and its `Link` to `/signup`. What remains: the
  `AuthLayoutWrapper`, the plain email/password form (`handleSubmit`,
  unchanged — still signs in via `supabase.auth.signInWithPassword` and
  routes to `ROLE_HOME[role]`), and the show/hide password toggle.

- [ ] **Step 3: Delete the 4 orphaned files**

  ```bash
  git rm components/auth/signup-form.tsx
  git rm components/auth/oauth-callback.tsx
  git rm components/auth/reset-password-view.tsx
  git rm components/auth/google-icon.tsx
  ```

- [ ] **Step 4: Fix `auth-forms.component.test.tsx`**

  Read the current file first. Remove the `SignupForm` import and its
  `describe.each` entry entirely (the whole file currently tests ONE
  shared OAuth-initiation scenario across both `LoginForm` and
  `SignupForm` — after Step 2, `LoginForm` has no OAuth path left
  either, so this whole test scenario is gone, not just the signup half).
  Following this project's TDD convention, add a real replacement test
  for `LoginForm`'s surviving behavior instead of leaving the file
  empty: at minimum, a test that submitting valid credentials calls
  `supabase.auth.signInWithPassword` with the entered email/password
  (mock it to resolve successfully), and a test that a sign-in error
  shows the translated error message and re-enables the submit button
  (mirror the existing error-handling test pattern already in this file
  for shape/mocking style).

- [ ] **Step 5: Trim the `Auth` i18n namespace**

  Read the current `Auth` namespace in both `messages/vi.json` and
  `messages/en.json`. Keep only the keys `login-form.tsx` still uses
  after Step 2 (expect: `login`, `welcomeBack`, `emailLabel`,
  `emailPlaceholder`, `passwordLabel`, `passwordPlaceholder`,
  `showPassword`, `hidePassword`, `loginError`, `loggingIn` — verify
  this list against the actual post-Step-2 file rather than assuming it,
  since exact wording may differ). Remove every other key in the
  namespace (signup/OAuth/reset-password related) from both files.

- [ ] **Step 6: Build**

  Run: `npm run build`
  Expected: shows only the 2 known pre-existing errors
  (`menu-item-reviews-panel.tsx`, `reward-lookup.tsx`) — nothing new.

- [ ] **Step 7: Run the full test suite**

  Run: `npm test`
  Expected: PASS (plus the 1 known pre-existing unrelated failure).

- [ ] **Step 8: Commit**

  ```bash
  git add -A
  git commit -m "fix: remove login page's Google sign-in, forgot-password, and signup links (all pointed at deleted routes)"
  ```

**Note for Task 25:** this task already trims the `Auth` namespace down
to its surviving login-only keys — Task 25's own file list (below)
originally said to remove the `Auth` namespace entirely; that's been
corrected there to reflect that it's trimmed here, not deleted outright
(the namespace itself must stay, just smaller).

### Task 17: Delete Staff Order History and Rewards lookup

**Files:**
- Delete:
  - `app/[locale]/staff/orders/history/` (entire directory)
  - `app/[locale]/staff/orders/shift-history/`
  - `app/[locale]/staff/rewards/page.tsx`
  - `components/staff/order-history-detail.tsx`
  - `components/staff/order-history-list.tsx`
  - `components/staff/reward-lookup.tsx`
  - `components/staff/shift-controls-dialog.tsx`
  - `components/staff/staff-shift-history.tsx`
  - `hooks/useShift.tsx`
  - `lib/supabase/shift-data.ts`, `lib/supabase/shift-data.test.ts`
  - `lib/supabase/order-history.ts`, `hooks/useOrderHistory.tsx`,
    `hooks/useOrderHistory.test.ts` (moved here from Task 9's original,
    incorrect file list — this query module/hook is staff-only, backing
    exactly the routes/components this task deletes; see Task 9's
    correction note)

- [ ] **Step 1: Confirm these are safe to delete now**

  Run:
  ```bash
  grep -rln "useShift\|shift-data\|reward-lookup\|order-history-detail\|order-history-list\|useOrderHistory\|order-history\b" app/ components/ hooks/ lib/
  ```
  Expected: only the files listed above, plus (for `shift-data`/`useShift`)
  `components/admin/shift-closing.tsx`/`shift-report-detail.tsx` and
  `app/[locale]/admin/shift/` — all deleted together in Task 19. If Task
  19 hasn't run yet in your execution order, delete this task's files
  first and leave the admin shift files for Task 19 (no circular
  dependency between them).

- [ ] **Step 2: Delete**

  ```bash
  git rm -r "app/[locale]/staff/orders/history"
  git rm -r "app/[locale]/staff/orders/shift-history"
  git rm "app/[locale]/staff/rewards/page.tsx"
  git rm components/staff/order-history-detail.tsx components/staff/order-history-list.tsx
  git rm components/staff/reward-lookup.tsx components/staff/shift-controls-dialog.tsx components/staff/staff-shift-history.tsx
  git rm hooks/useShift.tsx
  git rm lib/supabase/shift-data.ts lib/supabase/shift-data.test.ts
  git rm lib/supabase/order-history.ts hooks/useOrderHistory.tsx hooks/useOrderHistory.test.ts
  ```

- [ ] **Step 3: Build**

  Run: `npm run build`

- [ ] **Step 4: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete Staff Order History and Rewards lookup"
  ```

---

## Part 7 — Admin area trim

### Task 18: Delete Admin Dashboard, Inventory, Shift, Food Cost, Promotions, and the (now-absorbed) Tables route

**Files:**
- Delete:
  - `app/[locale]/admin/dashboard/` (entire directory)
  - `app/[locale]/admin/inventory/` (entire directory)
  - `app/[locale]/admin/shift/` (entire directory)
  - `app/[locale]/admin/food-cost/page.tsx`
  - `app/[locale]/admin/promotions/page.tsx`
  - `app/[locale]/admin/tables/` (entire directory — components already
    absorbed in Task 16)
  - `components/admin/dashboard-view.tsx`
  - `components/admin/food-cost-calculator.tsx`
  - `components/admin/ingredient-form.tsx`
  - `components/admin/inventory-management.tsx`
  - `components/admin/promotions-management.tsx`
  - `components/admin/recipe-checklist.tsx`
  - `components/admin/shift-closing.tsx`
  - `components/admin/shift-report-detail.tsx`
  - `components/admin/stock-adjust-form.tsx`, `components/admin/stock-adjust-form.component.test.tsx`
  - `lib/supabase/dashboard-data.ts`, `lib/supabase/dashboard-data.test.ts`
  - `lib/supabase/inventory-data.ts`, `lib/supabase/inventory-data.test.ts`
  - `lib/supabase/promotions-data.ts`, `lib/supabase/promotions-data.test.ts`
  - `hooks/useDashboardStats.tsx`, `hooks/useInventory.tsx`
  - `lib/export-dashboard-excel.ts`

- [ ] **Step 1: Confirm `menu-item-reviews-panel.tsx` and
  `menu-categories-card.tsx` are/aren't affected**

  `components/admin/menu-item-reviews-panel.tsx` shows review moderation
  for `/admin/menu` — since Reviews is deleted (Task 9), check if
  `menu-management.tsx` still renders this panel:
  `grep -n "menu-item-reviews-panel" components/admin/menu-management.tsx`.
  If it does, remove that usage now (delete
  `components/admin/menu-item-reviews-panel.tsx` too) since `/admin/menu`
  is being kept, not deleted — its review panel specifically must go.

- [ ] **Step 2: Delete the files listed above**

  ```bash
  git rm -r "app/[locale]/admin/dashboard"
  git rm -r "app/[locale]/admin/inventory"
  git rm -r "app/[locale]/admin/shift"
  git rm "app/[locale]/admin/food-cost/page.tsx"
  git rm "app/[locale]/admin/promotions/page.tsx"
  git rm -r "app/[locale]/admin/tables"
  git rm components/admin/dashboard-view.tsx components/admin/food-cost-calculator.tsx
  git rm components/admin/ingredient-form.tsx components/admin/inventory-management.tsx
  git rm components/admin/promotions-management.tsx components/admin/recipe-checklist.tsx
  git rm components/admin/shift-closing.tsx components/admin/shift-report-detail.tsx
  git rm components/admin/stock-adjust-form.tsx components/admin/stock-adjust-form.component.test.tsx
  git rm components/admin/menu-item-reviews-panel.tsx
  git rm lib/supabase/dashboard-data.ts lib/supabase/dashboard-data.test.ts
  git rm lib/supabase/inventory-data.ts lib/supabase/inventory-data.test.ts
  git rm lib/supabase/promotions-data.ts lib/supabase/promotions-data.test.ts
  git rm hooks/useDashboardStats.tsx hooks/useInventory.tsx
  git rm lib/export-dashboard-excel.ts
  ```

- [ ] **Step 3: Check `menu-management.tsx` for a now-broken inventory
  reference**

  Menu items previously showed stock/ingredient info tied to Inventory
  (per Decision 15/`menu-management.tsx` likely reading
  `ingredient_id`/recipe links). Read `components/admin/menu-management.tsx`
  and `components/admin/menu-item-form.tsx` in full; remove any
  recipe/ingredient-linking UI, keeping just the manual
  `is_available` toggle (already exists per the design's Decision 15 —
  confirm the column/toggle exists today via `grep -n "is_available" lib/supabase/menu-admin.ts`;
  if there's no such column/toggle yet, this is new work: add an
  `is_available` boolean toggle to `menu-item-form.tsx` backed by the
  existing `menu_items` table — check first whether an `is_available`
  column already exists via `mcp__supabase__list_tables` before assuming
  it needs adding).

- [ ] **Step 4: Build**

  Run: `npm run build`

- [ ] **Step 5: Run tests**

  Run: `npm test`

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete Admin Dashboard, Inventory, Shift Closing, Food Cost, Promotions, and the standalone Tables route"
  ```

### Task 19: Trim Admin Settings to shop info only

**Files:**
- Modify: `lib/supabase/settings-data.ts`, `components/admin/settings-view.tsx`,
  `app/[locale]/admin/settings/page.tsx`
- Delete: `components/admin/landing-hero-settings-card.tsx`

**Interfaces:**
- Produces: `ShopSettings`/`ShopSettingsInput` types drop
  `taxRatePercent`; `getShopSettings`/`updateShopSettings` drop the
  `tax_rate` column read/write. `getLoyaltySettings`/`updateLoyaltySettings`/
  `getLandingHeroSettings`/`updateLandingHeroSettings` and their types are
  deleted from this file entirely.

- [ ] **Step 1: Write the failing test**

  Read `lib/supabase/settings-data.test.ts` in full first. Update its
  `getShopSettings`/`updateShopSettings` tests to no longer
  reference/assert `taxRatePercent`/`tax_rate`, and delete every test
  describe block for `LoyaltySettings`/`LandingHeroSettings` functions.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run lib/supabase/settings-data.test.ts`
  Expected: FAIL against the current implementation (still reads/writes
  `tax_rate`, still exports the loyalty/hero functions the test file no
  longer calls but the type-check of removed imports would fail first if
  done in the wrong order — do the test edit and implementation edit
  together in one pass here rather than strictly test-then-code, since
  this is a deletion, not new behavior; run the test only after Step 3).

- [ ] **Step 3: Implement**

  In `lib/supabase/settings-data.ts`: remove `taxRatePercent` from
  `ShopSettings`/`ShopSettingsInput`, remove `"taxRatePercent"` from
  `SettingsValidationField`, delete `validateShopSettingsInput`'s
  tax-rate check (or the whole function if shop name/address/phone/hours
  need no validation — check current callers first), remove `tax_rate`
  from the `ShopSettingsRow` type and from both the `select` and
  `update` calls. Delete every `LoyaltySettings*`/`LandingHeroSettings*`
  type, function, and row type in this file (the loyalty settings DB
  table stays untouched per Decision 1 — this is only removing the
  admin-facing query-layer code for it).

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run lib/supabase/settings-data.test.ts`
  Expected: PASS

- [ ] **Step 5: Update `settings-view.tsx` and its page**

  Read `components/admin/settings-view.tsx` in full. Remove the tax-rate
  input field, the entire loyalty-settings form section, and the
  `<LandingHeroSettingsCard>` usage. Delete
  `components/admin/landing-hero-settings-card.tsx`. Confirm
  `app/[locale]/admin/settings/page.tsx` doesn't independently fetch
  loyalty/hero data that would now 404/error (it likely just renders
  `<SettingsView>` with server-fetched props — update those props to
  match the trimmed `ShopSettings` shape).

- [ ] **Step 6: Build**

  Run: `npm run build`

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "refactor: trim Admin Settings to shop info only, drop tax/loyalty/landing-hero"
  ```

### Task 20: Update the admin nav

**Files:**
- Modify: `components/admin/admin-nav-items.ts`, `components/admin/admin-sidebar.tsx`,
  `components/admin/admin-mobile-header.tsx`, `app/[locale]/admin/layout.tsx`

**Interfaces:**
- Produces: `ADMIN_NAV_ITEMS` contains only `menu`, `staff`, `settings`.
  `ADMIN_FULFILLMENT_NAV_ITEMS` is deleted (POS/KDS links no longer
  belong under the admin shell's own nav — staff reach KDS/Tables via
  `staff-nav.tsx`, which admin/manager also see once logged in, per Task
  16's `staff/layout.tsx` gate covering all three roles).

- [ ] **Step 1: Read `admin-sidebar.tsx` and `admin-mobile-header.tsx` in
  full**

  Confirm exactly how they consume `ADMIN_NAV_ITEMS`/
  `ADMIN_FULFILLMENT_NAV_ITEMS` before editing.

- [ ] **Step 2: Trim `admin-nav-items.ts`**

  ```typescript
  import { UtensilsCrossed, Users, Settings } from "lucide-react"

  export const ADMIN_NAV_ITEMS = [
    { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
    { href: "/admin/staff", labelKey: "staff", icon: Users },
    { href: "/admin/settings", labelKey: "settings", icon: Settings },
  ] as const
  ```
  Delete the `ADMIN_FULFILLMENT_NAV_ITEMS` export entirely and remove
  every reference to it in `admin-sidebar.tsx`/`admin-mobile-header.tsx`.
  Add a link to `/staff/orders` (labeled e.g. "Vận hành"/"Operations")
  somewhere reachable from the admin shell instead, since admin/manager
  still need a way to reach KDS+Tables — check whether the sidebar
  already has a natural "external section" slot or just add it as one
  more `ADMIN_NAV_ITEMS`-style entry pointing outside `/admin/*`.

- [ ] **Step 3: Update `app/[locale]/admin/layout.tsx` if it independently
  referenced any deleted route for redirects**

  Read it in full; it should only gate via `canAccessAdmin` (unchanged) —
  no edit expected here beyond confirming that.

- [ ] **Step 4: Build**

  Run: `npm run build`

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "refactor: trim admin nav to menu/staff/settings, link out to staff operations"
  ```

---

## Part 8 — Payments and Edge Functions cleanup

### Task 21: Delete unused Edge Functions and their shared helpers

**Files:**
- Delete: `supabase/functions/place-order/`, `supabase/functions/pay-order/`,
  `supabase/functions/stripe-webhook/`, `supabase/functions/vnpay-ipn/`,
  `supabase/functions/vnpay-return/`, `supabase/functions/checkout-table-session/`
- Modify/delete as needed: `supabase/functions/_shared/` (remove
  Stripe/VNPay-specific helpers no longer imported by anything, e.g.
  `stripe.ts`, `vnpay.ts` — keep `order-status.ts` and anything
  `create-staff-account` still uses)

- [ ] **Step 1: Confirm `create-staff-account` doesn't import anything
  from the functions being deleted**

  Run: `grep -rn "import" supabase/functions/create-staff-account/`
  and check each `_shared/*` import it uses survives this deletion.

- [ ] **Step 2: Delete the function directories**

  ```bash
  git rm -r supabase/functions/place-order
  git rm -r supabase/functions/pay-order
  git rm -r supabase/functions/stripe-webhook
  git rm -r supabase/functions/vnpay-ipn
  git rm -r supabase/functions/vnpay-return
  git rm -r supabase/functions/checkout-table-session
  ```

- [ ] **Step 3: Remove now-dead `_shared` helpers**

  Run: `grep -rln "_shared/stripe\|_shared/vnpay" supabase/functions/`
  If empty (no remaining importer), delete those helper files too:
  ```bash
  git rm supabase/functions/_shared/stripe.ts supabase/functions/_shared/vnpay.ts
  ```
  (Exact filenames per what Step 1's grep across `_shared/` actually
  shows — confirm before deleting.)

- [ ] **Step 4: Undeploy the functions from the live Supabase project**

  Run `mcp__supabase__list_edge_functions` to confirm current deployed
  functions, then remove the deleted ones from the live project (this
  MCP server doesn't expose a delete-function tool per its available
  actions — if none exists, this becomes a manual step: note it in Task
  22's checklist for the user to run via `supabase functions delete
  <name>` with the Supabase CLI, since deleting a deployed function is
  the kind of hard-to-reverse, externally-visible action this project's
  conventions call for confirming with the user first anyway).

- [ ] **Step 5: Build**

  Run: `npm run build` (Edge Functions aren't part of the Next.js build,
  but confirm no `app/`/`lib/` code still references
  `supabase.functions.invoke("place-order" | "pay-order" | "checkout-table-session" | ...)`):
  ```bash
  grep -rn 'functions.invoke(' app/ components/ hooks/ lib/
  ```
  Expected: empty.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "remove: delete Stripe/VNPay/non-table-order Edge Functions and their shared helpers"
  ```

### Task 22: Manual external cleanup checklist (present to the user, don't execute unattended)

This is not a code task — it's a checklist for
dothanhlong166@gmail.com to run by hand, since no MCP tool in this
project manages Vercel env vars or Supabase Edge Function secrets, and
deleting deployed functions/secrets is exactly the kind of hard-to-
reverse, externally-visible action this project's own conventions (and
this session's operating rules) require surfacing rather than doing
silently.

- [ ] **Step 1: Deploy the deleted-function state**

  Run `supabase functions delete place-order pay-order stripe-webhook
  vnpay-ipn vnpay-return checkout-table-session` (Supabase CLI, logged
  in against project `qhiypdqnrnzndxdwqxbx`) to actually remove them from
  the live project (Task 21 only deleted the local source).

- [ ] **Step 2: Remove Supabase Edge Function secrets**

  Via the Supabase Dashboard → Edge Functions → Secrets (or `supabase
  secrets unset`): remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`.

- [ ] **Step 3: Remove Vercel env vars**

  Via the Vercel dashboard for the `phadincafe` project
  (`gnoltd-s-projects` team): remove `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`,
  `VNPAY_RETURN_URL`. Leave `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` alone
  (still needed).

- [ ] **Step 4: Confirm**

  Report back once done so the plan's execution can note these as
  complete in `daily.md` (Task 26).

---

## Part 9 — Routing and roles

### Task 23: Rewrite `middleware-rules.ts` for the new route map

**Files:**
- Modify: `lib/middleware-rules.ts`, `lib/middleware-rules.test.ts`
- Delete: `lib/auth-required-routes.test.ts`

**Correction, tracked since Task 9/19**: `lib/auth-required-routes.test.ts`
has been failing (ENOENT) since Task 9 deleted `app/[locale]/(customer)/profile/`
and `loyalty/` — it dynamically `readdirSync`s those two directories at
test-collection time to assert `AUTH_REQUIRED_EXACT_PATHS` stays in sync
with the real route tree. Once this task empties `AUTH_REQUIRED_EXACT_PATHS`
to `[]` (Step 3), this whole test file's premise (keep a list in sync
with routes that must be exact-match-gated) is moot — there is no list
to keep in sync anymore, and the two directories it walks no longer
exist. Delete the file entirely rather than trying to fix it.

**Interfaces:**
- Produces: `ADMIN_ONLY_PREFIXES = ["/admin/staff", "/admin/settings"]`
  (unchanged — still correct, `/admin/menu` stays manager+admin per
  `ROUTE_GROUP_ROLES`, only `/admin/staff` and `/admin/settings` are
  admin-only per the existing convention, which this plan doesn't
  change). `AUTH_REQUIRED_EXACT_PATHS = []` (every one of the old
  entries — `/profile`, `/profile/settings`, `/profile/addresses`,
  `/orders`, `/loyalty`, `/loyalty/redemptions` — is deleted). Everything
  else in the file (`ROUTE_GROUP_ROLES`, `resolveRedirect`,
  `splitLocaleFromPathname`, `getSupabaseAuthCookieName`,
  `hasSupabaseAuthCookie`) is unchanged.

- [ ] **Step 1: Write the failing test**

  In `lib/middleware-rules.test.ts`, delete the entire `describe("resolveRedirect
  — auth-required exact paths", ...)` block (every one of its assertions
  covers a path that no longer exists) and replace it with:
  ```typescript
  describe("resolveRedirect — no more auth-required exact paths", () => {
    it("never gates any path for an anonymous guest via AUTH_REQUIRED_EXACT_PATHS", () => {
      expect(resolveRedirect("/profile", null)).toBeNull()
      expect(resolveRedirect("/orders", null)).toBeNull()
      expect(resolveRedirect("/loyalty", null)).toBeNull()
    })

    it("does not gate the root home page for an anonymous guest", () => {
      expect(resolveRedirect("/", null)).toBeNull()
    })
  })
  ```
  Leave the `"resolveRedirect — existing /staff and /admin behavior
  unaffected"` describe block as-is (still valid).

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run lib/middleware-rules.test.ts`
  Expected: FAIL (`resolveRedirect("/profile", null)` currently returns
  `"/login"`, not `null`).

- [ ] **Step 3: Implement**

  ```typescript
  export const AUTH_REQUIRED_EXACT_PATHS: string[] = []
  ```
  (Keep the constant — `resolveRedirect`'s logic already handles an
  empty array correctly — rather than deleting it and the `if` branch
  that reads it, since a future guest-only-gated page might need it
  again and the branch is harmless dead weight either way; simplest
  correct change.)

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run lib/middleware-rules.test.ts`
  Expected: PASS

- [ ] **Step 5: Delete the now-moot `auth-required-routes.test.ts`**

  ```bash
  git rm lib/auth-required-routes.test.ts
  ```

- [ ] **Step 6: Run the full test suite**

  Run: `npm test`
  Expected: PASS with no failures at all (this was the one remaining
  known pre-existing failure tracked since Task 9 — after this step,
  the suite should be fully green for the first time since then).

- [ ] **Step 7: Commit**

  ```bash
  git add lib/middleware-rules.ts lib/middleware-rules.test.ts
  git commit -m "refactor: drop auth-required exact paths now that customer accounts are gone (also removes the now-moot auth-required-routes.test.ts)"
  ```

### Task 24: Confirm `ROLE_HOME` change from Task 16 has full test coverage

**Files:**
- Modify: `lib/middleware-rules.test.ts` if any test hardcodes the old
  `ROLE_HOME` targets

- [ ] **Step 1: Grep for stale expectations**

  Run: `grep -n "admin/dashboard\|staff/pos" lib/middleware-rules.test.ts lib/roles.test.ts`

- [ ] **Step 2: Update any matches**

  `lib/roles.test.ts` almost certainly asserts
  `ROLE_HOME.staff === "/staff/pos"` and
  `ROLE_HOME.manager === "/admin/dashboard"` — read it in full and update
  to the new values from Task 16 Step 7 (`/staff/orders` for all three).

- [ ] **Step 3: Run tests**

  Run: `npx vitest run lib/roles.test.ts lib/middleware-rules.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit**

  ```bash
  git add lib/roles.test.ts lib/middleware-rules.test.ts
  git commit -m "test: update role-home expectations for the merged staff operations area"
  ```

---

## Part 10 — i18n cleanup

### Task 25: Remove dead top-level i18n namespaces

**Files:**
- Modify: `messages/vi.json`, `messages/en.json`

**Interfaces:**
- Removes top-level namespaces: `Profile`, `Cart`, `Checkout`,
  `OrderHistory`, `OrderTracking`, `Loyalty`, `ProductDetail` (fold any
  still-needed keys — e.g. a generic "add to cart" label — into `Menu`
  first, then delete the namespace; check usage before deleting each
  key, don't delete blind), `Pos`, `MyRedemptions`, `Addresses`,
  `StaffRewards`, `StaffOrderHistory`, `Dashboard`, `AdminShift`,
  `AdminPromotions`, `AdminInventory`, `FoodCost`.
- **`Auth` is NOT in this list** — Task 16B already trimmed it down to
  its surviving `/login`-only keys (a real, live-used namespace, not a
  dead one); do not touch it here.

- [ ] **Step 1: Run the i18n coverage check first to see the current
  baseline**

  Run: `npx vitest run lib/i18n-coverage.test.ts`
  Expected: PASS (confirms both files are still key-parity-matched before
  this task's edits — if it doesn't already pass, stop and fix that
  first, unrelated to this task).

- [ ] **Step 2: For each namespace slated for removal, grep for any
  lingering `useTranslations("<Namespace>")` / `getTranslations("<Namespace>")`
  usage**

  Run, once per namespace:
  ```bash
  grep -rn '"Profile"\|"Cart"\|"Checkout"\|"OrderHistory"\|"OrderTracking"\|"Loyalty"\|"ProductDetail"\|"Pos"\|"MyRedemptions"\|"Addresses"\|"StaffRewards"\|"StaffOrderHistory"\|"Dashboard"\|"AdminShift"\|"AdminPromotions"\|"AdminInventory"\|"FoodCost"' app/ components/
  ```
  Expected: empty after Tasks 8-19's deletions. If anything remains,
  that file was missed earlier — go fix it there, don't just leave the
  namespace in the message files to paper over a real leftover import.

- [ ] **Step 3: Delete the namespaces**

  Remove each top-level key listed above from both `messages/vi.json`
  and `messages/en.json`.

- [ ] **Step 4: Run the i18n coverage check again**

  Run: `npx vitest run lib/i18n-coverage.test.ts`
  Expected: PASS (both files still have identical key sets — this test
  exists precisely to catch a namespace removed from one file but not
  the other).

- [ ] **Step 5: Build**

  Run: `npm run build`

- [ ] **Step 6: Commit**

  ```bash
  git add messages/vi.json messages/en.json
  git commit -m "i18n: remove message namespaces for deleted features"
  ```

---

## Part 11 — Docs

### Task 26: Update `CLAUDE.md`, component `CLAUDE.md`s, and `daily.md`

**Files:**
- Modify: `CLAUDE.md`, `components/customer/CLAUDE.md`,
  `components/staff/CLAUDE.md`, `components/admin/CLAUDE.md`,
  `daily.md`

- [ ] **Step 1: Read all five files in full**

- [ ] **Step 2: Update `CLAUDE.md`**

  - **Status** section: replace the feature-flood paragraph with an
    accurate summary of the minimal app (menu, QR scan → shared table
    session, KDS+Tables staff operations, admin menu/staff/settings,
    bilingual, cash-only). Note the 2026-09-19 rebuild and link both new
    docs (`docs/superpowers/specs/2026-09-19-minimal-ordering-rebuild-design.md`,
    `docs/superpowers/plans/2026-09-19-minimal-ordering-rebuild.md`).
  - **Route map**: rewrite to the new map — `(customer)`: `/` (scan-QR
    screen), `/menu`, `/menu/[itemId]`, `/table/[qrToken]`. `(auth)`
    group survives as `/login` only (staff/manager/admin sign-in — Task 9
    keeps `(auth)/login/page.tsx` and `(auth)/layout.tsx`, deleting only
    `callback/`/`signup/`/`reset-password/`).
  - `staff`: `/staff/orders` (KDS), `/staff/tables`.
  - `admin`: `/admin/menu`, `/admin/staff`, `/admin/settings`.
  - Remove the "Home (`/`) merge, 2026-09-06" historical section's
    relevance note or leave it as history with a one-line pointer that
    it was superseded by this rebuild (matches this file's own
    convention of keeping dated history rather than deleting it outright
    — follow existing precedent by adding a short note rather than
    deleting the whole historical entry).
  - **Cross-cutting conventions**: remove/update any bullet that no
    longer applies verbatim (e.g. the VNPay-encoding gotcha, the
    Stripe/VNPay secrets gotcha) — mark them as historical ("no longer
    applicable after the 2026-09-19 rebuild removed Stripe/VNPay") rather
    than silently deleting the lesson, matching this file's existing
    style of preserving hard-won gotchas even when their trigger surface
    is gone.
  - **Feature areas**: remove the deleted feature sections (Deferred
    payment, Payments — Cash/Stripe/VNPay → replace with a short "Cash-
    only payment" note, Shift closing, most of Shared table ordering
    session stays since it survives — update its description to drop
    the promo-code-in-Check-Bill and Stripe/VNPay mentions).
  - **Database** table: add a row for `0093`-`0094`.
  - **Edge Functions** section: update to reflect only
    `create-staff-account` remains.
  - **Building the rest**: rewrite to reflect the minimal app's status.

- [ ] **Step 3: Update `components/customer/CLAUDE.md`**

  Rewrite to describe only: menu browsing (read-only vs. table-context
  ordering), QR scan landing, the shared table ordering session, Check
  Bill (cash-only). Remove every section describing deleted features.

- [ ] **Step 4: Update `components/staff/CLAUDE.md`**

  Rewrite to describe the merged KDS+Tables operations area, cash
  confirmation, and the removal of POS/shift/rewards-lookup/order-history.

- [ ] **Step 5: Update `components/admin/CLAUDE.md`**

  Rewrite to describe only menu management (with the manual
  `is_available` toggle replacing inventory-driven availability) and
  staff account creation, plus the trimmed settings page.

- [ ] **Step 6: Update `daily.md`**

  Per this file's own stated convention ("kept short and recap-free by
  design"), add a single current-status entry noting the rebuild is
  complete and what (if anything) is still open (e.g., Task 22's manual
  external cleanup if not yet confirmed done).

- [ ] **Step 7: Commit**

  ```bash
  git add CLAUDE.md components/customer/CLAUDE.md components/staff/CLAUDE.md components/admin/CLAUDE.md daily.md
  git commit -m "docs: update CLAUDE.md and daily.md for the minimal ordering rebuild"
  ```

---

## Part 12 — Final verification and deploy

### Task 27: Full local verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build**

  Run: `npm run build`
  Expected: succeeds with zero errors.

- [ ] **Step 2: Lint**

  Run: `npm run lint`
  Expected: zero errors (warnings acceptable only if pre-existing and
  unrelated — don't introduce new ones).

- [ ] **Step 3: Full test suite**

  Run: `npm test`
  Expected: all tests pass.

- [ ] **Step 4: Grep for any remaining reference to a deleted concept**

  Run each and confirm empty:
  ```bash
  grep -rln "useCart\b" app/ components/ hooks/ lib/
  grep -rln "stripe\|vnpay" app/ components/ hooks/ lib/ --include="*.ts" --include="*.tsx" -i
  grep -rln "loyalty_points_balance\|redeem_reward\|find_redemption_by_code" app/ components/ hooks/ lib/
  grep -rln "no_open_shift" supabase/migrations/
  ```
  (The last one should still find the *original* migrations mentioning
  it historically — that's fine, migrations are an append-only log; it
  should NOT appear in the live function definition anymore, already
  confirmed in Task 1.)

- [ ] **Step 5: Commit anything outstanding**

  If Steps 1-4 required fixes, commit them now with a clear message
  before moving to deploy.

### Task 28: Deploy and live-verify against `https://phadincafe.vercel.app`

**Files:** none (verification only)

- [ ] **Step 1: Push to `main`**

  ```bash
  git push origin main
  ```
  (Confirm with the user before this step specifically — pushing to
  `main` on a project that auto-deploys to production is exactly the
  kind of visible, side-effecting action this session's operating rules
  ask to confirm first, even though the user asked for this whole
  rebuild.)

- [ ] **Step 2: Wait for the Vercel deploy to complete**

  Check deploy status (Vercel dashboard or `vercel` CLI if available in
  this environment; otherwise ask the user to confirm the deploy
  finished).

- [ ] **Step 3: Live-verify the guest flow (Chrome DevTools MCP or
  Playwright MCP against the production URL)**

  - Open `https://phadincafe.vercel.app/vi` — confirm the minimal
    "scan QR" screen renders, no landing/marketing content, a working
    "Nhân viên đăng nhập" link.
  - Open `/vi/menu` — confirm items render, add button is visibly
    disabled with a tooltip.
  - Scan (navigate directly to) a real table's `/vi/table/<qr_token>`
    URL (get a real token via `mcp__supabase__execute_sql`:
    `select qr_code_token from public.tables limit 1;`) — add an item,
    place a round, confirm it appears in the round list, tap "Yêu cầu
    tính tiền", confirm the simplified single-button Check Bill sheet
    appears with no payment-method/promo UI.
  - Confirm the language switcher still works on every page visited
    above.

- [ ] **Step 4: Live-verify the staff flow**

  - Log in as the staff or manager test account (credentials in
    `.env.local`/`test-accounts.md` per `CLAUDE.md`).
  - Confirm landing on `/staff/orders` (KDS board, no Tables column
    embedded, no shift join/leave UI).
  - Switch to `/staff/tables` via the nav — confirm the table placed a
    round on shows as "in service", confirm "Xác nhận đã thu tiền" closes
    out the bill-requested table from the guest flow above.
  - Confirm table creation/QR viewing works from this page.

- [ ] **Step 5: Live-verify the admin flow**

  - Log in as the admin test account.
  - Confirm the admin sidebar shows only Menu/Staff/Settings (+ the
    operations link added in Task 20).
  - Confirm `/admin/settings` shows only shop info, no tax/loyalty/hero
    fields.
  - Confirm `/admin/menu` still allows editing an item's price/
    availability/sizes.

- [ ] **Step 6: Report results**

  Summarize pass/fail for each flow above. Any failure blocks calling
  this plan done — file it as a bug and fix before considering the
  rebuild complete.

---

## Self-Review Notes (from the plan author, before handoff)

- **Spec coverage**: every numbered Decision in the design doc maps to
  at least one task above (Decision 1→ all deletion tasks' "never drop
  DB" framing + Task 1's narrow exception; 2→19,20; 3→9,26 Step 2's login-
  preservation flag; 4→8; 5→13,21,22; 6→ (no Pickup code was found to
  delete beyond what Decision 9 already covers — Pickup's absence is
  structural to Shared Table Session being the only path, not a separate
  deletion); 7→ folded into Task 8/9 by deleting the tracking route; 8→1;
  9→7,8; 10→6; 11→16; 12→15; 13→16; 14→6; 15→12; 16→16 (no explicit UI
  ever asks for a method); 17→16; 18→3; 19→14; 20→8/9 (folded into
  `/orders` deletion); 21→10; 22→11; 23→ unchanged, no task needed
  (explicitly a no-op decision); 24→1; 25→21,22.
- **Placeholder scan**: no "TBD"/"handle appropriately" language above;
  every deletion task names exact files, every new-logic task includes
  real code or an exact instruction to read-then-edit with a stated goal.
- **Type consistency**: `AddToCartInput`/`CartItem`/`CartModifier` are
  defined once (Task 2) and referenced by name consistently in Tasks
  3-4; `requestTableBill` is defined in Task 5 and consumed by name in
  Task 6; `TablesOperationsView` is defined in Task 16 and is the single
  new component name used for the merged Tables page throughout.
- **Gap caught and fixed during self-review**: an earlier draft of Task 9
  deleted the entire `(auth)/` directory, which would have taken
  `/login` down with it — the one sign-in surface staff/manager/admin
  still need (Decision 3). Task 9's file list and delete commands above
  are already corrected to remove only `callback/`, `signup/`, and
  `reset-password/`, explicitly keeping `login/page.tsx` and
  `layout.tsx`. `CLAUDE.md`'s route-map update (Task 26) already
  reflects `(auth)` surviving as a login-only group.
