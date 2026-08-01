# Payment Method Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a served-but-unpaid Pay Later order's payment method be changed or reset — customer-side ("Change payment method" on the tracking page) and staff-side ("Undo" next to the KDS Confirm Cash action) — so a wrong pick is recoverable.

**Architecture:** One guest-safe `security definer` RPC (`change_order_payment_method`) guarded to `status = 'served' AND payment_status = 'pending'`; a DI'd wrapper in `orders-data.ts`; two small UI additions (tracking page reset buttons, KDS undo button) wired through the existing error-surfacing patterns.

**Tech Stack:** Postgres/Supabase (plpgsql, security definer), Next.js client components, Vitest, next-intl.

## Global Constraints

- Migration file is `supabase/migrations/0032_change_payment_method_fn.sql` AND applied live via `mcp__supabase__apply_migration` (name: `change_payment_method_fn`).
- Guest-safe RPC pattern: order id is a required parameter; granted to `anon` + `authenticated`; never a broad RLS policy.
- New strings in **both** `messages/en.json` and `messages/vi.json`.
- Every UI write surfaces failure (no silent `.catch(() => {})`).
- Verify against `https://phadincafe.vercel.app`.

---

### Task 1: Migration 0032 — `change_order_payment_method` RPC

**Files:**
- Create: `supabase/migrations/0032_change_payment_method_fn.sql`

**Interfaces:**
- Produces: `change_order_payment_method(p_order_id uuid, p_method payment_method default null) returns boolean` — `true` if the order was updated, `false` if the guard rejected it.

- [ ] **Step 1: Write the migration**

```sql
-- 0032_change_payment_method_fn.sql
-- Guest-safe correction of a Pay Later payment-method choice.
-- Design: docs/superpowers/specs/2026-07-10-payment-method-correction-design.md
--
-- Only acts while status='served' AND payment_status='pending' -- the
-- one state where a recorded method is still safely changeable.
-- p_method null = reset to "no method chosen" (tracking page's 3-way
-- picker reappears; KDS card returns to Mark Cash). The UPDATE touches
-- only payment_method, so handle_order_paid /
-- complete_order_when_served_and_paid (gated on payment_status) can
-- never fire from it. Note: null here is a meaningful argument, not a
-- default-relying omission, so the PostgREST explicit-null gotcha
-- doesn't bite -- the function treats null itself.

create or replace function public.change_order_payment_method(
  p_order_id uuid,
  p_method payment_method default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.orders
    set payment_method = p_method
    where id = p_order_id
      and status = 'served'
      and payment_status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.change_order_payment_method(uuid, payment_method) from public;
grant execute on function public.change_order_payment_method(uuid, payment_method) to anon, authenticated;
```

- [ ] **Step 2: Apply live**

Call `mcp__supabase__apply_migration` with name `change_payment_method_fn` and the SQL above. Expected `{"success":true}`.

- [ ] **Step 3: Verify the guard live via SQL**

Via `mcp__supabase__execute_sql`:
1. `select public.change_order_payment_method(id) from orders where payment_status = 'paid' limit 1` → `false` (paid orders untouchable).
2. Confirm no row changed: `select count(*) from orders where payment_status = 'paid' and payment_method is null` → `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0032_change_payment_method_fn.sql
git commit -m "Add guest-safe change_order_payment_method RPC"
```

---

### Task 2: `changeOrderPaymentMethod` in orders-data.ts (TDD)

**Files:**
- Modify: `lib/supabase/orders-data.ts` (add function next to `setOrderPaymentMethodCash`, currently `lib/supabase/orders-data.ts:250`)
- Test: `lib/supabase/orders-data.test.ts` (append describe block)

**Interfaces:**
- Produces: `changeOrderPaymentMethod(supabase: SupabaseClient, orderId: string, method: RealPaymentMethod | null): Promise<boolean>` (`RealPaymentMethod` = `"stripe" | "cash" | "vnpay"`, already exported by this module).

- [ ] **Step 1: Write the failing tests** (append to `lib/supabase/orders-data.test.ts`; add `changeOrderPaymentMethod` to the existing import list from `./orders-data`)

```ts
describe("changeOrderPaymentMethod", () => {
  it("calls the RPC with the order id and method", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: true, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await changeOrderPaymentMethod(supabase, "ord-1", null)

    expect(rpcSpy).toHaveBeenCalledWith("change_order_payment_method", { p_order_id: "ord-1", p_method: null })
    expect(result).toBe(true)
  })

  it("returns false when the guard rejects the order", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: false, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    expect(await changeOrderPaymentMethod(supabase, "ord-paid", "vnpay")).toBe(false)
  })

  it("throws on RPC error", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await expect(changeOrderPaymentMethod(supabase, "ord-1", "cash")).rejects.toThrow("boom")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: FAIL — `changeOrderPaymentMethod` is not exported.

- [ ] **Step 3: Implement** (in `lib/supabase/orders-data.ts`, directly below `setOrderPaymentMethodCash`)

```ts
export async function changeOrderPaymentMethod(
  supabase: SupabaseClient,
  orderId: string,
  method: RealPaymentMethod | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc("change_order_payment_method", {
    p_order_id: orderId,
    p_method: method,
  })
  if (error) throw error
  return data as boolean
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "Add changeOrderPaymentMethod wrapper for the correction RPC"
```

---

### Task 3: UI — tracking-page reset buttons + KDS undo + i18n

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`
- Modify: `components/customer/order-tracking.tsx`
- Modify: `hooks/useKitchenOrders.tsx`
- Modify: `components/staff/kitchen-tables-column.tsx`

**Interfaces:**
- Consumes: `changeOrderPaymentMethod` (Task 2).
- Produces: `useKitchenOrders()` gains `undoCashPayment: (orderId: string) => Promise<void>`.

- [ ] **Step 1: i18n keys**

`messages/en.json` — in `OrderTracking`, after `"cashAwaitingStaffNote"` (line ~252):

```json
    "changePaymentMethod": "Change payment method",
    "chooseDifferentMethod": "Choose a different method",
```

In `KitchenDisplay`, after `"markCash"` (line ~334):

```json
    "undoCash": "Undo",
```

`messages/vi.json` — same positions:

```json
    "changePaymentMethod": "Đổi phương thức thanh toán",
    "chooseDifferentMethod": "Chọn phương thức khác",
```

```json
    "undoCash": "Hoàn tác",
```

Validate: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"` → `ok`.

- [ ] **Step 2: Tracking page** (`components/customer/order-tracking.tsx`)

Add `changeOrderPaymentMethod` to the existing import from `@/lib/supabase/orders-data` (line 14). Add a handler next to `handlePayNow`:

```ts
  async function handleChangeMethod() {
    setIsPaying(true)
    try {
      await changeOrderPaymentMethod(supabase, orderId, null)
      setCashConfirmed(false)
      setPaymentNotice(false)
      const refreshed = await getOrder(orderId)
      setOrder(refreshed)
    } catch {
      setPaymentNotice(true)
    } finally {
      setIsPaying(false)
    }
  }
```

In the served-and-unpaid section, replace the cash branch (currently just the note):

```tsx
          ) : paymentMethod === "cash" || cashConfirmed ? (
            <>
              <p className="text-sm text-muted-foreground">{t("cashAwaitingStaffNote")}</p>
              <button
                type="button"
                disabled={isPaying}
                onClick={handleChangeMethod}
                className="mt-3 text-sm font-bold text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                {t("changePaymentMethod")}
              </button>
            </>
          ) : (
```

And in the gateway-retry branch, add a secondary button under the existing Pay Now `Button`:

```tsx
              <Button className="h-11 w-full rounded-xl" disabled={isPaying} onClick={() => paymentMethod && handlePayNow(paymentMethod)}>
                {isPaying ? t("payNowLoading") : t("payNowButton")}
              </Button>
              <button
                type="button"
                disabled={isPaying}
                onClick={handleChangeMethod}
                className="mt-3 text-sm font-bold text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                {t("chooseDifferentMethod")}
              </button>
```

- [ ] **Step 3: `hooks/useKitchenOrders.tsx`**

Add `changeOrderPaymentMethod` to the module's import from `@/lib/supabase/orders-data`. Add to the context type (after `markCashPayment`, line ~39):

```ts
  undoCashPayment: (orderId: string) => Promise<void>
```

Add the implementation next to `markCashPayment` (line ~119):

```ts
  async function undoCashPayment(orderId: string) {
    await changeOrderPaymentMethod(supabase, orderId, null)
  }
```

And include `undoCashPayment,` in the provider value object (next to `markCashPayment,`, line ~137).

- [ ] **Step 4: KDS table card** (`components/staff/kitchen-tables-column.tsx`)

Destructure the new function (line 14):

```ts
  const { orders, serveTable, confirmCashPayment, markCashPayment, undoCashPayment } = useKitchenOrders()
```

In the cash branch (currently only the Confirm Cash button, lines ~111-122), wrap both actions in a row:

```tsx
                {awaitingPaymentOrder?.paymentMethod === "cash" && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        confirmCashPayment(awaitingPaymentOrder.id).catch(() => setError(t("updateError")))
                      }}
                      className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-secondary-foreground hover:brightness-110"
                    >
                      {t("confirmCashReceived")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        undoCashPayment(awaitingPaymentOrder.id).catch(() => setError(t("updateError")))
                      }}
                      className="rounded-lg border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
                    >
                      {t("undoCash")}
                    </button>
                  </div>
                )}
```

- [ ] **Step 5: Typecheck, full tests, build**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → all pass.
Run: `npx next build` → clean.

- [ ] **Step 6: Commit**

```bash
git add messages/en.json messages/vi.json components/customer/order-tracking.tsx hooks/useKitchenOrders.tsx components/staff/kitchen-tables-column.tsx
git commit -m "Payment method correction: tracking-page change buttons + KDS Undo Cash"
```

---

### Task 4: Deploy, live verification, daily.md

**Files:**
- Modify: `daily.md`

- [ ] **Step 1: Push, wait ~60-90s for Vercel**

```bash
git push
```

- [ ] **Step 2: Live-verify on `https://phadincafe.vercel.app`** (test accounts via `.env.local`; delete any temp script after)

1. Place a real **Pay Later** dine-in order (customer side), advance it to `served` via KDS.
2. Tracking page: pick **Cash** → "awaiting staff" note + "Change payment method" appears → tap it → 3-way picker returns.
3. Pick **VNPay** (or Card) → abandon the gateway page (browser back) → tracking shows retry + "Choose a different method" → tap → picker returns.
4. Pick Cash again; on KDS the table card shows Confirm Cash + **Undo** → tap Undo → customer's picker returns (Realtime).
5. Finish: staff Confirm Cash → order completes (auto-completion trigger) — confirms nothing in the normal flow broke.
6. Guard: on a *paid* order, `select public.change_order_payment_method('<id>')` via SQL → `false`.

- [ ] **Step 3: `daily.md` entry + push**

Newest-first entry: the three Pay Later gaps, the guarded guest-safe RPC, both UI surfaces, the documented double-payment edge (manual refund stance), and the verification above.

```bash
git add daily.md
git commit -m "Docs: log payment method correction feature"
git push
```
