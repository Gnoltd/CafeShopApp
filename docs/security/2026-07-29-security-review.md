# PhaDinCoffee — Security & Cybersecurity Review

**Date:** 2026-07-29
**Scope:** Full read/analysis pass of the PhaDinCoffee (CoffeeShop) codebase — Next.js (App Router) + Supabase (Postgres/RLS + Auth + Realtime + Edge Functions), deployed on Vercel. All 55 SQL migrations, all 9 Edge Function files, `middleware.ts` / `lib/middleware-rules.ts`, `next.config.ts`, the `app/` / `components/` / `hooks/` / `lib/` tree, `package.json`, and git history for secrets.
**Method:** Static analysis only (Grep/Glob/Read + `npm audit`). No live pentesting, no code modified, no destructive commands. RLS/grant effective-state confirmed by reading migrations at their final state (later `create or replace` / `drop policy` / `revoke` wins); a handful of items are flagged as "verify against the live DB" because grant state can't be queried statically.

---

## Executive summary

**Overall risk posture: good.** This is a security-conscious codebase that has already been through several self-review passes (migrations `0044`–`0055` closed the historically critical holes: anon-callable `set_initial_staff_role`, direct order/order-item forgery, `qr_code_token` read/write exposure, the anonymous-NULL-role bypass of every role check, and direct shift-table financial tampering). RLS is enabled on every `public` table, there are **no hardcoded secrets** anywhere in the tree or git history, no service-role key reaches the client bundle, the app has **no server actions or route handlers** (so classic CSRF does not apply), and `middleware.ts` ships a genuinely strong nonce-based CSP.

No **Critical** issues were found. The findings that remain are one **High** (an outdated Next.js whose advisories touch the middleware auth boundary — a version bump), five **Medium** items (a Stripe webhook replay window, a non-CSPRNG staff-password generator, two Pay-Later payment-mutation RPCs that lack an ownership check, and the absence of any rate limiting on the guest-callable Edge Functions), and a set of **Low**/**Info** hardening items.

### Findings by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 12 |
| Info | 9 |

---

## Findings table

| ID | Title | Severity | Category | Affected file:line | Impact |
|---|---|---|---|---|---|
| H-1 | Outdated Next.js (16.2.10) with middleware/proxy-bypass + SSRF advisories | High | Infra/CyberSec | `package.json:21` | Advisory class directly touches the middleware auth boundary; fix is a non-major bump to 16.2.12 |
| M-1 | Stripe webhook has no timestamp-tolerance check → signed-payload replay | Medium | AppSec | `supabase/functions/stripe-webhook/index.ts:27-29` | A captured valid webhook replays indefinitely; contained by DB guards but a real gap |
| M-2 | Staff/admin temporary password generated with `Math.random()` (not a CSPRNG) | Medium | AppSec | `supabase/functions/create-staff-account/index.ts:22-28` | Predictable initial credential for privileged accounts |
| M-3 | `pay-order` Edge Function performs no ownership check (order-UUID-only) + TOCTOU on update | Medium | AppSec | `supabase/functions/pay-order/index.ts:45-63` | Anyone holding a served-unpaid order UUID can flip its method and mint unlimited gateway sessions |
| M-4 | `change_order_payment_method` RPC has no ownership check | Medium | AppSec | `supabase/migrations/0032_change_payment_method_fn.sql:26-31` | Anyone with a served-unpaid order UUID can alter/reset its recorded payment method |
| M-5 | No rate limiting on guest-callable Edge Functions (`place-order`, `pay-order`) | Medium | Infra/CyberSec | `supabase/functions/place-order/index.ts`, `pay-order/index.ts` | Unauthenticated mass order creation (straight to kitchen board) + unbounded Stripe/VNPay session creation |
| L-1 | `Strict-Transport-Security` (HSTS) header not set by the app | Low | Infra/CyberSec | `middleware.ts:51-63` | Relies on Vercel platform HSTS; not guaranteed for a future custom domain |
| L-2 | Stripe webhook does not cross-check `amount_total` vs `orders.total` (VNPay does) | Low | AppSec | `supabase/functions/stripe-webhook/index.ts:74-82` | Missing belt-and-suspenders; matters if any amount-editable Stripe feature is enabled |
| L-3 | Raw upstream error messages returned to clients | Low | AppSec | `supabase/functions/place-order/index.ts:91`; `create-staff-account/index.ts:89` | Internal Postgres/Stripe error text can leak in error paths (no secrets) |
| L-4 | Route gating is middleware-only; gated layouts do no server-side role check | Low | AppSec | `app/[locale]/admin/layout.tsx:1-9` | If middleware is bypassed, attacker gets the UI shell (data still RLS-gated) |
| L-5 | `xlsx` 0.18.5 has known prototype-pollution + ReDoS CVEs, no npm-published fix | Low | Infra/CyberSec | `package.json:29`; `lib/export-dashboard-excel.ts` | Export-only usage (no untrusted parsing) → not currently exploitable |
| L-6 | `menu_item_reviews` is directly anon-SELECTable, exposing raw `customer_id` UUIDs | Low | AppSec | `supabase/migrations/0027_menu_item_reviews.sql:28-29` | Any visitor can map review → customer UUID by querying the table directly |
| L-7 | `change_order_payment_method` update lacks a state re-guard (TOCTOU) | Low | AppSec | `supabase/migrations/0032_change_payment_method_fn.sql:26-31` | Record-corruption window only, no money impact |
| L-8 | `profiles_update_admin` (and settings-table UPDATE policies) have USING but no WITH CHECK | Low | AppSec | `supabase/migrations/0001_identity_and_roles.sql:70-71`; `0002_shop_config.sql:26-32` | Asymmetric policy; backstopped by trigger + column grants |
| L-9 | `get_redemption_expiry` has no ownership check | Low | AppSec | `supabase/migrations/0040_reward_redemption_checkout.sql:29` | Existence oracle for redemption UUIDs (returns only a timestamp) |
| L-10 | `increment_table_scan_count` is unauthenticated and unlimited | Low | AppSec | `supabase/migrations/0012_tables_i18n_and_scan_fn.sql:14` | Cosmetic-metric inflation only |
| L-11 | Two INVOKER functions lack `set search_path = public` (inconsistent with the rest) | Low | AppSec | `supabase/migrations/0010_inventory_i18n_and_stock_fn.sql:24`; `0031_shift_closing.sql:14` | Low (both INVOKER, tables `public.`-qualified) |
| L-12 | `error_description` query param echoed into the Settings UI (escaped) | Low | AppSec | `components/customer/profile-settings-view.tsx:35-36` | Attacker-chosen text inside a trusted screen (social-engineering surface) |
| I-1 | `get_order_for_tracking` returns any `customer_id is null` order to any UUID holder (by design) | Info | AppSec | `supabase/migrations/0042_real_shop_and_loyalty_settings.sql:329-333` | Accepted guest-tracking pattern; unguessable UUID is the capability |
| I-2 | `verify_jwt` per-function state exists only in code comments, not committed config | Info | Infra/CyberSec | `supabase/functions/*/index.ts` (headers) | A redeploy without the right flag could silently change auth behavior |
| I-3 | Loyalty/redemption balance check-then-decrement is not row-locked (TOCTOU) | Info | AppSec | `supabase/migrations/0035_rewards_catalog.sql:69-84` | Concurrent redemptions could drive balance negative (single-user, low-value) |
| I-4 | `SUPABASE_SECRET_KEY` present in Vercel env but unused by any Next.js code | Info | Infra/CyberSec | `.env.local.example:3` | Unnecessary high-privilege secret in the runtime = extra blast radius |
| I-5 | Stripe signature parser keeps only the last `v1=` (breaks secret rotation) | Info | AppSec | `supabase/functions/stripe-webhook/index.ts:21-26` | Robustness; can reject valid webhooks mid-rotation |
| I-6 | Non-atomic status read in webhook handlers can briefly regress `served`→`paid` | Info | AppSec | `stripe-webhook/index.ts:75-82`; `vnpay-ipn/index.ts:46-69` | Tiny window, self-heals via staff flow |
| I-7 | `/api` + static paths excluded from the security-header middleware | Info | Infra/CyberSec | `middleware.ts:133-136` | Moot today (no `route.ts` exists); relevant if one is added |
| I-8 | `AUTH_REQUIRED_EXACT_PATHS` is exact-match; new nested pages are unprotected until listed | Info | AppSec | `lib/middleware-rules.ts:5` | Currently complete; needs manual upkeep |
| I-9 | Staff-wide shift cash history readable by plain `staff` — confirm intent | Info | AppSec | `app/[locale]/staff/orders/shift-history/page.tsx`; `0053:32-35` | RLS widened staff→cash reconciliation; confirm this was intended |

---

## Detailed findings

### H-1 — Outdated Next.js (16.2.10) with middleware/proxy-bypass advisories
**Category:** Infra/CyberSec · **Severity:** High · `package.json:21`

`npm audit` flags `next@16.2.10` (a **direct** dependency) with several high-severity advisories, the most relevant being **GHSA-6gpp-xcg3-4w24** ("Middleware / Proxy bypass in App Router applications") and **GHSA-p9j2-gv94-2wf4 / GHSA-89xv-2m56-2m9x** (SSRF in rewrites / Server Actions on custom servers). In this app, `middleware.ts` **is** the route-level authorization boundary (`/staff/*`, `/admin/*`, admin-only prefixes), so any middleware-bypass class of bug is materially more serious here than in an app that gates server-side. The app's specific exposure to GHSA-6gpp-xcg3-4w24 is reduced (it uses two locales, not a single locale, and does not obviously depend on Turbopack in production), and data access is still backstopped by RLS — but the fix is a **non-major** version bump.

```json
// package.json:21
"next": "16.2.10",
```

Fix available: `next@16.2.12` (non-SemVer-major). This bump also clears the transitive `postcss` and `sharp` high-severity advisories (see appendix).

---

### M-1 — Stripe webhook has no timestamp-tolerance check → signed-payload replay
**Category:** AppSec · **Severity:** Medium · `supabase/functions/stripe-webhook/index.ts:27-29`

The handler parses the `t` (timestamp) field out of the `Stripe-Signature` header and includes it in the signed string, but **never compares it to the current time**:

```ts
// stripe-webhook/index.ts:27-29
const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")))
const timestamp = parts["t"]
const expectedSig = parts["v1"]
// ... timestamp is used to build the signed string but never validated for freshness
```

Stripe's own guidance is to reject events whose timestamp is outside a tolerance window (default 5 minutes). Without it, a captured, validly-signed `checkout.session.completed` payload can be replayed at any later time and will pass signature verification. The practical blast radius is contained by the downstream DB guards (`.eq("payment_status", "pending")` at `:82`/`:91` and `handle_order_paid`'s own idempotency), so a replay only affects an order that is *still* pending — but that is a real, reachable state (e.g. a second payment attempt in flight). The signature verification itself is otherwise correct: raw body is captured before parsing and signed exactly (`:38`, `:58`), the compare is constant-time (`:43-48`), and parse/act happen only after verification.

---

### M-2 — Staff/admin temporary password generated with `Math.random()`
**Category:** AppSec · **Severity:** Medium · `supabase/functions/create-staff-account/index.ts:22-28`

```ts
// create-staff-account/index.ts:22-28
let password = ""
for (let i = 0; i < 16; i++) {
  password += chars[Math.floor(Math.random() * chars.length)]
}
```

`Math.random()` is **not** a CSPRNG — V8's `xorshift128+` internal state is recoverable from a sequence of outputs, so a generated password is not cryptographically unpredictable. This function mints the **initial credential for real staff/admin accounts**. Mitigations exist (the value is only returned to an already-authenticated admin over HTTPS and is meant to be changed), but nothing enforces rotation, so a weak initial secret can persist. The surrounding authorization is otherwise correct: the caller's JWT is validated with `getUser()` and their role + `is_active` are re-read server-side from `profiles` via the service client (`:52-68`) — no trust in a client-supplied claim.

**Fix:** use `crypto.getRandomValues()`.

---

### M-3 — `pay-order` Edge Function performs no ownership check (order-UUID-only)
**Category:** AppSec · **Severity:** Medium · `supabase/functions/pay-order/index.ts:45-63`

`pay-order` (verify_jwt disabled per its header comment) looks up the order by the client-supplied `orderId` and proceeds on **state guards only** — order exists, `payment_status === "pending"`, `status === "served"` — with **no ownership check of any kind**:

```ts
// pay-order/index.ts (paraphrased flow, :45-63)
const { data: order } = await service.from("orders").select(...).eq("id", orderId).single()
if (!order) return notFound
if (order.payment_status !== "pending") return ...
if (order.status !== "served") return ...
// ... then builds a Stripe/VNPay session and updates payment_method
```

Anyone who learns a served-but-unpaid order's UUID (shared tracking link, shoulder-surfed URL) can flip its recorded `payment_method` and mint unlimited Stripe/VNPay checkout sessions for it. This follows the project's "unguessable UUID as capability" guest-safe philosophy and cannot mark an order paid or steal money, but two sub-issues compound it:
- **TOCTOU:** the `update` at `:63` is not re-guarded with `.eq("payment_status","pending").eq("status","served")`, so if the order becomes paid between check and write, `payment_method` is overwritten on a paid order (record corruption).
- Unlike every DB-side guest RPC, this logic lives in TypeScript around a bare service client, so the guard set can drift from the equivalent SQL.

**Fix:** for a logged-in caller, verify ownership (mirror `cancel_pending_order`'s `v_customer_id != auth.uid()` raise); add the state `.eq(...)` guards to the update; ideally move the logic behind a `security definer` RPC for parity with the rest of the codebase.

---

### M-4 — `change_order_payment_method` RPC has no ownership check
**Category:** AppSec · **Severity:** Medium · `supabase/migrations/0032_change_payment_method_fn.sql:26-31`

The sibling of M-3 on the DB side. `change_order_payment_method(p_order_id, p_method)` is granted to `anon, authenticated` and updates by `p_order_id` with **only** a status guard (`served` + `pending`), no ownership verification:

```sql
-- 0032_change_payment_method_fn.sql:26-31
update public.orders
   set payment_method = p_method
 where id = p_order_id
   and status = 'served'
   and payment_status = 'pending';
```

Compare `cancel_pending_order` (0018), which correctly raises when `v_customer_id != auth.uid()`. Anyone holding a served-unpaid order's UUID can change or null-out its recorded payment method — griefing / staff confusion (the counter shows the wrong or no method), not theft.

**Fix:** add an ownership branch for logged-in-owned orders (allow the guest/null-customer case, as elsewhere) mirroring `cancel_pending_order`.

---

### M-5 — No rate limiting on guest-callable Edge Functions
**Category:** Infra/CyberSec · **Severity:** Medium · `supabase/functions/place-order/index.ts`, `pay-order/index.ts`

No function implements any rate limiting. The two guest-callable, verify_jwt-disabled functions are abusable:
- **`place-order`** — unlimited anonymous order creation. A `payAt: 'later'` order goes **straight to the kitchen display board with no payment gate** (highest-leverage abuse: kitchen spam / DoS of the staff workflow), plus unlimited Stripe Checkout Session creation and VNPay URL signing at zero cost to the attacker.
- **`pay-order`** — unlimited session creation per known served-unpaid order UUID.

The signature-gated webhook endpoints (`stripe-webhook`, `vnpay-ipn`) only let an attacker burn CPU on HMAC checks, and `create-staff-account` requires a valid admin JWT before any expensive work — so those are fine. Nothing in-repo mitigates mass anonymous order/session creation.

**Fix:** enable Supabase edge rate limiting (or a lightweight per-IP throttle / lightweight bot check) on `place-order` and `pay-order`. This is the single highest-value operational hardening available.

---

### L-1 — HSTS header not set by the app
`middleware.ts:51-63` sets a strong header set (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) but **not** `Strict-Transport-Security`. `upgrade-insecure-requests` in the CSP is not equivalent to HSTS. Vercel typically injects HSTS on `*.vercel.app`, but that is not guaranteed for a future custom domain. Cheap to add in `applySecurityHeaders`.

### L-2 — Stripe webhook does not cross-check the amount
`stripe-webhook/index.ts:74-82` marks the order paid on `metadata.order_id` alone, without comparing `amount_total` to `orders.total`. `vnpay-ipn/index.ts:56-58` **does** perform this cross-check (`vnpAmount / 100 !== order.total`). Sessions are only ever created server-side with the server-computed total, so exploiting this requires the Stripe secret key — but it is a missing defense-in-depth check that its sibling handler performs.

### L-3 — Raw upstream error messages returned to clients
`place-order/index.ts:91` returns PostgREST `error.message` verbatim (intentional for machine-readable codes like `invalid_redemption_code`, but any *unexpected* Postgres text also passes through); `create-staff-account/index.ts:89` returns `createError?.message` (account-existence info, but only to a verified admin); `_shared/stripe.ts:67` returns Stripe's own error text. No secrets leak, and no stack traces reach clients (all catch blocks return generic messages), but `place-order:91` is worth tightening to a mapped allowlist.

### L-4 — Route gating is middleware-only
`app/[locale]/admin/layout.tsx:1-9` is a `"use client"` shell with no role check; the same is true of staff layouts. All data access is RLS/RPC-gated with SQL role checks, so a middleware bypass yields only the UI shell — but a cheap `getCurrentRole()` check in the admin/staff layouts would close the class defensively (especially given H-1).

### L-5 — `xlsx` 0.18.5 known CVEs
`package.json:29` pins `xlsx: ^0.18.5`, whose npm-published build carries prototype-pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) advisories with **no fixed npm release** (fixes ship only via the SheetJS CDN ≥0.19.3/0.20.2). Usage here is **export-only** (`lib/export-dashboard-excel.ts` builds workbooks; it never parses untrusted files), so it is **not currently exploitable**. Track for a future migration to the CDN build or an alternative.

### L-6 — `menu_item_reviews` directly anon-SELECTable
`0027_menu_item_reviews.sql:28-29` uses `using (true)`, so a visitor can query the table directly and read raw `customer_id` UUIDs per review — the `get_menu_item_reviews` RPC deliberately returns only `full_name`, but the underlying table leaks the UUID (enumerate which customer authored which review). Minor privacy exposure; consider restricting direct SELECT and forcing reads through the RPC.

### L-7 — `change_order_payment_method` update lacks a state re-guard (TOCTOU)
Same statement as M-4: the update reads/decides then writes without a re-guard, so a concurrent transition can overwrite state — record corruption only. Fixed together with M-4.

### L-8 — UPDATE policies with USING but no WITH CHECK
`profiles_update_admin` (`0001:70-71`) and the `shop_settings`/`loyalty_settings` UPDATE policies (`0002:26-27`, `0002:31-32`) specify USING but not WITH CHECK, allowing a row to be mutated into a state the USING clause wouldn't re-permit. All three are backstopped (the `prevent_role_self_change` trigger + narrowed column grants for `profiles`; manager/admin-only reach for the config tables), so residual risk is negligible — but the clauses are asymmetric with the correctly-written `profiles_update_own`. Add matching WITH CHECK for consistency.

### L-9 — `get_redemption_expiry` no ownership check
`0040:29` is granted to `authenticated`, takes any redemption UUID, and does no ownership check. It returns only a timestamp, so the exposure is an existence oracle + expiry for a guessed/leaked redemption UUID. Used internally by `place_order`; direct client exposure is minor.

### L-10 — `increment_table_scan_count` unauthenticated and unlimited
`0012:14` is granted to anon with no rate limit; anyone with a table UUID can inflate any table's `scan_count`. Cosmetic metric only.

### L-11 — Two INVOKER functions lack `set search_path`
`adjust_ingredient_stock` (`0010:24`) and the `set_order_paid_at` trigger (`0031:14`) omit `set search_path = public`, inconsistent with every other function in the schema. Both are SECURITY INVOKER and reference `public.`-qualified tables (or only `now()`/`new.*`), so practical risk is low; add the clause for consistency.

### L-12 — `error_description` echoed into the Settings UI
`components/customer/profile-settings-view.tsx:35-36` renders the raw `error_description`/`error` query param as the identity-linking error message. It is React-escaped (text only, not an XSS sink), but a crafted link can display arbitrary attacker-chosen text inside the trusted Settings screen — a social-engineering surface. Map to translated messages keyed off known codes instead of echoing.

### Info items (I-1 … I-9)
- **I-1 `get_order_for_tracking` guest IDOR (by design):** `0042:329-333` returns any `customer_id is null` order to any UUID holder. Accepted guest-tracking pattern; the 128-bit `gen_random_uuid()` is the capability. Noted for completeness.
- **I-2 `verify_jwt` not in committed config:** there is no `supabase/config.toml` / `deno.json` in the repo; each function's verify_jwt on/off state exists only as an in-code comment. A redeploy without the right flag could silently change auth behavior. Commit a `config.toml` with explicit per-function `verify_jwt`.
- **I-3 loyalty/redemption TOCTOU:** `0035:69-84` (and `place_order`'s loyalty branch) read-check-decrement `loyalty_points_balance` without `SELECT ... FOR UPDATE`; concurrent redemptions could drive it negative. Single-user, low-value; add a row lock if abuse is a concern.
- **I-4 unused `SUPABASE_SECRET_KEY` in Vercel:** listed in `.env.local.example:3` / Vercel env but referenced by no Next.js code (service-role logic lives only in Edge Functions, a separate secret store). Remove it from the Vercel runtime to shrink blast radius.
- **I-5 Stripe signature rotation:** `stripe-webhook:21-26` `Object.fromEntries` collapses duplicate `v1=` entries, keeping only the last — can reject valid webhooks during a webhook-secret rotation. Robustness only.
- **I-6 webhook status-read race:** `stripe-webhook:75-82` / `vnpay-ipn:46-69` read status then update non-atomically; a `served→paid` regression is possible in a tiny window and self-heals via the staff flow.
- **I-7 `/api` excluded from header middleware:** `middleware.ts:133-136` matcher excludes `api` and static assets. Moot today (no `app/**/route.ts` exists), relevant if a route handler is ever added.
- **I-8 `AUTH_REQUIRED_EXACT_PATHS` upkeep:** `lib/middleware-rules.ts:5` is exact-match; the list is currently complete, but any future nested page (e.g. `/profile/xyz`) is unprotected until manually added. A route-tree test would prevent regressions.
- **I-9 staff-wide shift cash history:** `app/[locale]/staff/orders/shift-history/page.tsx` exposes cash reconciliation (revenue, over/short) to plain `staff`, backed by the RLS widening in `0053:32-35` (the earlier `0031` design was manager/admin). Intentional and DB-backed — flagged only to confirm it was meant to widen from manager-only.

---

## Fixing plan

### Priority 1 — Fix now

1. **H-1 — Bump Next.js.**
   - File: `package.json:21` → `"next": "16.2.12"` (and `eslint-config-next` to match). Run `npm install`, then `npm run build` + `npm run test` (140 tests) to confirm no regression. Also clears transitive `postcss`/`sharp` highs.
   - Verify: `npm audit` no longer lists `next`/`postcss`/`sharp`; middleware auth still gates `/staff` and `/admin` (existing `lib/middleware-rules.ts` unit tests pass).

2. **M-3 + M-4 + L-7 — Add ownership checks to the Pay-Later payment-mutation surface.**
   - File `supabase/migrations/0032_change_payment_method_fn.sql` → new follow-up migration `0056_change_payment_method_ownership.sql`: `create or replace` the function to raise `not_authorized` when the order has a `customer_id` and it `<> auth.uid()` (allow the guest/`null`-customer case as elsewhere), keeping the `served`+`pending` guard. This is a single UPDATE so the guard already re-checks state; keep it in the `where`.
   - File `supabase/functions/pay-order/index.ts:45-63`: for a JWT-shaped caller, resolve `auth.getUser()` and reject when `order.customer_id` is non-null and `!= user.id`; add `.eq("payment_status","pending").eq("status","served")` to the update at `:63`.
   - Verify: as an unrelated logged-in user, calling the RPC / function with someone else's served-unpaid order UUID returns `not_authorized`; the legitimate owner and the guest (null customer) paths still work end-to-end on the deployed URL.

3. **M-2 — Replace `Math.random()` with a CSPRNG.**
   - File `supabase/functions/create-staff-account/index.ts:22-28`: build the password from `crypto.getRandomValues(new Uint8Array(n))` mapped onto the charset (rejection-sample to avoid modulo bias).
   - Verify: generated passwords still meet the intended length/charset; create a test staff account and confirm first-login + forced change still works.

4. **M-1 — Add Stripe timestamp tolerance.**
   - File `supabase/functions/stripe-webhook/index.ts`: after parsing `timestamp` (`:28`), reject when `abs(nowSeconds - Number(timestamp)) > 300` before trusting the signature/acting.
   - Verify: a live Stripe test event succeeds; a replayed captured payload older than 5 min is now rejected (curl smoke test with a stale `t=`).

5. **M-5 — Rate-limit the guest Edge Functions.**
   - Enable Supabase edge rate limiting for `place-order` and `pay-order` (Dashboard/config), or add a per-IP token-bucket check at function entry keyed on `x-forwarded-for`. Note this is an operational/deploy step, not only code.
   - Verify: a burst of anonymous `place-order` calls is throttled; a normal single checkout is unaffected.

### Priority 2 — Backlog (hardening)

6. **L-1 — Add HSTS.** `middleware.ts` `applySecurityHeaders`: `headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")`. Verify with `curl -I` against the deployed URL.
7. **L-2 — Stripe amount cross-check.** In `stripe-webhook/index.ts`, before marking paid, compare `event.data.object.amount_total` to the order's `total` (mirror `vnpay-ipn:56`); reject on mismatch.
8. **L-4 — In-layout role guard.** Add a `getCurrentRole()` check (redirect on mismatch) to `app/[locale]/admin/layout.tsx` and the staff layout as defense-in-depth behind middleware.
9. **L-3 — Map `place-order` errors.** Replace the verbatim `error.message` passthrough at `place-order:91` with an allowlist of known machine-readable codes; return a generic message otherwise.
10. **L-6 — Restrict `menu_item_reviews` direct SELECT.** New migration: drop the `using(true)` SELECT policy and force reads through `get_menu_item_reviews` (which already omits `customer_id`), or scope direct SELECT to own/staff.
11. **L-8 — Add WITH CHECK.** New migration: add matching WITH CHECK clauses to `profiles_update_admin`, `shop_settings`, and `loyalty_settings` UPDATE policies.
12. **L-9 / L-10 — Tighten guest RPCs.** Add an ownership check to `get_redemption_expiry`; consider a rate/abuse control on `increment_table_scan_count` (or accept as cosmetic).
13. **L-11 — Add `set search_path = public`** to `adjust_ingredient_stock` and `set_order_paid_at` (new migration).
14. **L-12 — Stop echoing `error_description`.** Map identity-linking error codes to translated strings in `profile-settings-view.tsx`.
15. **I-2 — Commit `supabase/config.toml`** with explicit per-function `verify_jwt` values so the auth posture is version-controlled.
16. **I-3 — Row-lock loyalty balance** (`SELECT ... FOR UPDATE`) in `redeem_reward` / `place_order` if concurrent-redemption abuse becomes a concern.
17. **I-4 — Remove unused `SUPABASE_SECRET_KEY`** from Vercel env.
18. **I-5 / I-6 — Webhook robustness:** iterate all `v1=` candidates in the Stripe signature parser; make the paid-update atomic (single guarded UPDATE off the current row rather than read-then-write).
19. **I-8 — Route-tree test** asserting every `(customer)` auth-relevant page is in `AUTH_REQUIRED_EXACT_PATHS`.
20. **Live-DB verification (grant audit):** confirm on the hosted project that no unintended `anon`/`authenticated` EXECUTE grant persists on functions meant to be restricted (the project's Supabase instance re-grants EXECUTE at `CREATE FUNCTION` time — `0045`/`0047` worked around this with follow-up `revoke` migrations). Spot-check e.g. `has_function_privilege('anon','public.get_tables_admin()','execute')` is false. Also fix the docs drift (CLAUDE.md says 43 migrations / omits `0045`–`0055`).

---

## Appendix

### A. `npm audit` summary

Totals: **8 vulnerabilities** — 0 critical, **6 high**, **2 moderate**, 0 low. 811 dependencies (415 prod).

| Severity | Package | Type | Fix |
|---|---|---|---|
| high | `next` | direct | → `next@16.2.12` (non-major) — middleware/proxy bypass, SSRF, cache-confusion, image-opt DoS advisories |
| high | `postcss` | transitive (via next) | → `next@16.2.12` — source-map path traversal / arbitrary `.map` disclosure |
| high | `sharp` | transitive (via next) | → `next@16.2.12` — inherited libvips CVEs |
| high | `brace-expansion` | transitive | `npm audit fix` — ReDoS / OOM DoS |
| high | `fast-uri` | transitive | `npm audit fix` — host confusion via backslash authority |
| high | `xlsx` | direct | **no npm fix** — prototype pollution + ReDoS; export-only usage here (L-5) |
| moderate | `@hono/node-server` | transitive | `npm audit fix` — path traversal on Windows via `%5C` |
| moderate | `@modelcontextprotocol/sdk` | transitive | `npm audit fix` |

Recommended: bump `next` to `16.2.12` (clears 3 of the 6 highs), run `npm audit fix` for the remaining transitives, and track `xlsx` (no clean fix; not currently exploitable).

### B. Security-header checklist (`middleware.ts` `applySecurityHeaders` / `buildCsp`)

| Header | Status | Notes |
|---|---|---|
| Content-Security-Policy | ✅ Present (strong) | Per-request nonce + `'strict-dynamic'` script-src; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` |
| Strict-Transport-Security | ❌ Missing | L-1 — relies on Vercel platform HSTS |
| X-Frame-Options | ✅ Present | `DENY` (legacy fallback alongside `frame-ancestors 'none'`) |
| X-Content-Type-Options | ✅ Present | `nosniff` |
| Referrer-Policy | ✅ Present | `strict-origin-when-cross-origin` |
| Permissions-Policy | ✅ Present | `camera=(self), microphone=(), geolocation=()` |
| X-Powered-By removed | ✅ Yes | `next.config.ts:12` `poweredByHeader: false` |
| CSP `style-src` | ⚠️ `'unsafe-inline'` | Documented, accepted (React inline `style={{}}`; CSS-injection-only risk) |
| CSP `img-src` | ⚠️ allows `images.unsplash.com` | Documented interim allowance for hero photos |

Note: headers are set in `middleware.ts`, not `next.config.ts` `headers()`, because the app needs a per-request CSP nonce that only middleware can mint. They are applied to both normal and redirect responses (`middleware.ts:112,126`) but not to `/api`/static paths excluded by the matcher (I-7, moot today).

### C. Files & areas reviewed

- **Migrations (all 55):** `supabase/migrations/0001`–`0055`, evaluated at final effective state. Per-table RLS, every SECURITY DEFINER/INVOKER function, grants, triggers, storage-bucket policies (`0028`/`0050`/`0051`), Realtime publication (`0015`/`0046`/`0053`).
- **Edge Functions (all 9 files, every line):** `place-order`, `pay-order`, `stripe-webhook`, `vnpay-ipn`, `vnpay-return`, `create-staff-account`, `_shared/{stripe,vnpay,order-status}.ts`.
- **App layer:** `middleware.ts`, `lib/middleware-rules.ts`, `lib/{roles,get-current-role}.ts`, `lib/supabase/{client,server,menu-data-cached}.ts`, `lib/qr-table-token.ts`, `app/[locale]/layout.tsx`, admin/auth layouts, the `(customer)`/`staff`/`admin` page inventory, review/profile/checkout/order-tracking/KDS components, `hooks/{useCart,useTables,useTheme,useRealtimeChannel}`.
- **Config & hygiene:** `next.config.ts`, `package.json`, `.gitignore`, `.env.local.example`, `.mcp.json`, `package.json` scripts. Git history searched for committed secrets (`.env*`, `test-accounts.md`, `sk_`/`whsec_`/JWT patterns) — none found; `.env*` and `test-accounts.md` are correctly gitignored.

### D. Areas confirmed clean (explicit)

- **Secrets:** no hardcoded secret in the tree or git history; no service-role/Stripe/VNPay secret in any client-bundled code; only `NEXT_PUBLIC_*` (public by design) read in app code.
- **RLS:** every `public` table has RLS enabled; no `using(true)` on any *write* policy; customers cannot forge orders/order-items or self-insert loyalty rows; `qr_code_token` is neither directly readable nor writable by anon/authenticated (post `0047`/`0049`); shift financial rows are write-locked behind definer RPCs (post `0054`).
- **SQL injection:** no dynamic SQL (`EXECUTE`/`format`/string-concatenated query text) anywhere; ILIKE wildcards are RLS-bounded, not SQLi.
- **Payments:** client prices/amounts never trusted (only `place_order` computes money); JWT-shape gating correct in `place-order`; no publishable-key forwarding; VNPay hash verify-before-act with amount cross-check and constant-time compare; signed `vnp_TxnRef` used (no substitution); no open redirect in `vnpay-return`; no SSRF.
- **XSS:** the only `dangerouslySetInnerHTML` is the nonce'd static theme-init IIFE with no user data; reviews/notes/profile render as escaped JSX text; QR scanner navigates only to internal `/table/*`.
- **CSRF:** no server actions (`"use server"`) and no route handlers (`app/**/route.ts`) exist; all mutations use bearer-token supabase-js (not ambient cookies).
- **Logging:** no secrets/PII/tokens logged; no stack traces returned to clients.
