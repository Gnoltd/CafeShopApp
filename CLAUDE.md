# CLAUDE.md

Current-state architectural map for **PhaDinCafe** (synced with [AGENTS.md](AGENTS.md)). Historical design specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Module-level notes live in `components/customer/CLAUDE.md`, `components/staff/CLAUDE.md`, `components/admin/CLAUDE.md`, and `supabase/CLAUDE.md`.

## Language & Communication Rule

- **Always respond to the user in Vietnamese (Tiếng Việt)** regardless of the language used in the user's prompt, unless explicitly asked otherwise for a specific piece of text.

## Read Graph First (`graphify-out/`)

`graphify-out/` holds an up-to-date codebase knowledge graph (`1,711` nodes, `3,386` edges, `131` communities). For architecture, dependency, symbol, or cross-module questions, query `graphify-out/GRAPH_REPORT.md` or `graphify-out/graph.json` before bulk-reading source files. Run `/graphify --update` after large structural edits.

## Code Preservation Rule

- **Never delete existing code without explicit user permission.** If legacy, fallback, or unused code appears obsolete or dead (for example, the unreachable fallback branch in `components/staff/staff-orders-layout-client.tsx` or unused helpers), **hide, disable, or guard it** instead of deleting it unless the user explicitly approves deletion.

## Parallel Orchestration (Orca & Branch Isolation)

- **Isolate parallel work by branch/worktree:** Separate independent tasks onto dedicated branches (Orca / `workspace:"share"` worktrees) with non-overlapping file ownership, verify each branch independently, then merge together and re-verify the integrated workspace.
- **Split model workloads:** Distribute workloads across **Claude Sonnet / Claude Code** (`claude-sonnet-5-5-*` / `claude` CLI), **Gemini 4 Hydrogen** (`gemini-4-hydrogen-*`), and **Gemini 4 Argon** (`gemini-4-argon-*`, including integrated post-merge architectural review and quota failover) based on task fit and live quota availability.

## Current Status & Scope

Since the **2026-09-19 minimal ordering rebuild** (shipped on `main`, commit history through `767ae47`), PhaDinCafe is a single-purpose dine-in QR ordering and cash-settlement app:
- **Customer (guest/anonymous):** scans a table QR code -> shares a live multi-device cart/round session at `/table/[qrToken]`, then requests the cash bill.
- **Staff / Manager / Admin:** login-gated operations at `/staff/orders` (KDS) and `/staff/tables` (binary table occupancy + table CRUD/QR + cash confirmation).
- **Admin:** `/admin/menu` (`manager|admin`), `/admin/staff` (`admin`), `/admin/settings` (`admin`, shop info only).
- **Removed from app code (DB tables kept unused):** customer accounts/signup/Google OAuth/password reset, `/profile`, `/orders`, `/loyalty`, `/rewards`, `/reviews`, promo codes, individual `/cart` + `/checkout`, `Pickup` order creation, Pay Now/Later, Stripe/VNPay, tax calculation, `/staff/pos`, `/staff/orders/history`, `/admin/dashboard`, `/admin/inventory`, `/admin/food-cost`, `/admin/shift` (including the shift-open gate). Do not re-introduce or reference these as live features.
- **Production:** auto-deploys from `main` to `https://phadincafe.vercel.app` (project `phadincafe`, linked to `Gnoltd/CoffeeShop`).
- **Uncommitted / pending external items:**
  - `supabase/migrations/20260922154757_secure_qr_ordering_boundaries.sql` (+ `supabase/tests/qr_security_regression.sql`, `docs/security-audit-2026-09-22.md`, `docs/security-fixes-2026-09-22.md`) is prepared locally and **not applied to production yet**.
  - `daily.md` tracks manual external cleanup (undeploying 6 deleted legacy Edge Functions from Supabase, removing dead Stripe/VNPay secrets, and real-device / accessibility acceptance checks).
  - `docs/bao-cao-thuc-tap/` contains Vietnamese internship report materials.

## Stack & Verification

- **Framework:** Next.js `16.3.5` (App Router), React `19.2.4`, TypeScript 5, Tailwind CSS v4 (`app/globals.css`), shadcn on `@base-ui/react` (no Radix `asChild`), `framer-motion`, `three`, `jsqr`, `qrcode`, `next-intl` `4.13.1`.
- **Backend:** Supabase (`@supabase/supabase-js`, `@supabase/ssr`) with Postgres RLS as the security boundary + narrow `security definer` RPCs. Only **one** Edge Function remains: `supabase/functions/create-staff-account/index.ts`.
- **Scripts (`package.json`):** `npm run dev`, `npm run build`, `npm run lint` (`eslint`), `npm test` (`vitest run`, `vitest` `4.1.11` + `jsdom`). Verify deployed behavior against `https://phadincafe.vercel.app`. Note: `.github/workflows/quality.yml`, `design/stitch-exports/`, `design/redesign-reference/`, and `.codex/config.toml` were removed in `767ae47`.

## Roles, Auth & Middleware

- `profiles.role`: `customer | staff | manager | admin`. Only staff/manager/admin login exists (`/login` -> `supabase.auth.signInWithPassword`). `ROLE_HOME` (`lib/roles.ts`) routes all three to `/staff/orders`.
- `profiles.is_active = false` downgrades disabled staff to `"customer"` inside `current_user_role()` and RLS without touching Auth. Always prefer `current_user_role()` over raw `.select("role")` queries so `is_active` is never bypassed.
- `lib/supabase/cookie-options.ts` shares `authCookieOptions` (`secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `path: "/"`) across browser (`lib/supabase/client.ts`), server (`lib/supabase/server.ts`), and `middleware.ts`.
- `middleware.ts` + pure `lib/roles.ts` / `lib/middleware-rules.ts` enforce CSP nonces (`camera=(self)` for QR scan), security headers, `next-intl` routing, and unified role gates (`ROUTE_POLICIES`, `canAccessRoute`, `resolveRedirect`: `/staff/*` -> `staff|manager|admin`; `/admin/*` -> `manager|admin`; `/admin/staff` & `/admin/settings` -> `admin`), mirrored by server layout/page gates and nav helpers (`getAdminNavItems`, `getOperationsNavItems`). Skips the auth round-trip when no `sb-<ref>-auth-token` cookie exists and fails open to anonymous on errors. `AUTH_REQUIRED_EXACT_PATHS` is `[]`.

## Bilingual (i18n) & Theme

- `i18n/routing.ts`: `locales: ["vi", "en"]`, `defaultLocale: "vi"`, `localePrefix: "always"`, **`localeDetection: false`** (walk-in guests always start in Vietnamese).
- Keep `messages/vi.json` and `messages/en.json` strictly synchronized (`lib/i18n-coverage.ts`). Use `getTranslations()` on the server, `useTranslations()` on the client, and `i18n/navigation.ts` (`Link`, `usePathname`, `useRouter`).
- `middleware.ts` is required for locale resolution; `app/[locale]/layout.tsx` exports `dynamic = "force-dynamic"` and `viewport.interactiveWidget = "resizes-content"`.
- Root theme (`app/globals.css`, light + `.dark`): `--background: #fff8f2`, `--foreground: #2b2118`, `--primary: #b3341f`, `--secondary: #6f4e37`, `--accent: #c9a66b`, `--destructive: #c1440e`, `--success: #3f7d4e`, `--warn: #c48a1f`, `--radius: 0.75rem`; fonts `Be_Vietnam_Pro` (`--font-sans`) + `Playfair_Display` (`--font-playfair`). Use semantic Tailwind classes (`bg-primary`, etc.), never hardcode hex.
- `HeaderActionsStack` (`components/shared/header-actions-stack.tsx`, `fixed top-1 right-4 z-50 md:top-3`) mounts as a root sibling of `{children}` outside `TablesProvider`; `RoleBadge` reads remembered guest active table state via `useGuestActiveTable()` (`localStorage` + cached `useSyncExternalStore` in `lib/guest-active-table.ts`; `hooks/useTables.tsx` is staff-only). Keep admin headers clear (`pt-16`).

## Route Map (`app/[locale]/`)

- `(auth)` -> `/login` (`components/auth/login-form.tsx`)
- `(customer)` -> `/` (QR scan button + `qr-scanner-overlay.tsx`, `/menu` link, `/login` link), `/menu` (read-only `canOrder={false}`), `/menu/[itemId]` (read-only `ProductDetail`), `/table/[qrToken]` (`TableLanding` -> `TableOrderingSession`)
- `staff/(operations)` -> `/staff/orders` (`KitchenDisplay`), `/staff/tables` (`TablesOperationsView`). Shared layout `components/staff/staff-orders-layout-client.tsx` mounts `OperationsTabSwitcher` driven by `getOperationsNavItems(role)` (`lib/roles.ts`) with KDS, Tables, and role-gated links to `/admin/menu`, `/admin/staff`, `/admin/settings`.
- `admin` -> `/admin/menu` (`MenuManagement`), `/admin/staff` (`StaffAccounts`), `/admin/settings` (`SettingsView`)

## Core Architecture & Gotchas

- **Guest table session (`hooks/useTableSession.tsx`, `lib/supabase/table-session-data.ts`, `lib/guest-active-table.ts`, `lib/menu-selection-types.ts`):** `TableLanding` resolves QR tokens via `resolveGuestTable(createGuestTableLookupAdapter(supabase), qrToken)` without mounting `TablesProvider`. All shared cart/round actions run through `TableSessionPort` (`createSupabaseTableSessionAdapter` calling `get_table_session`, `add_cart_item`, `update_cart_item_quantity_delta`, `remove_cart_item`, `place_table_round` with `PGRST202` 1-arg fallback, `abandon_table_session`, `checkout_table_session` with `p_method: "cash"`, `p_promo_code: null`). `useTableSession` owns per-row `pendingCartItemIds`, `isPlacingRound`, idempotent `submissionId`, mapped `error`, `requestBill()`, and `dismissAndAbandon()` (`clearGuestActiveTable(qrToken)`). Menu selection uses the single `MenuItemSelection` shape. Guests do **not** use public Realtime reads — `useTableSession` polls every `3_000ms` (`GUEST_ORDER_POLL_MS`) while visible, refreshes on focus/visibility/mutation, and coalesces overlapping fetches (`300ms`).
- **KDS & table settlement (`hooks/useKitchenOrders.tsx`, `hooks/useTableSettlement.tsx`, `lib/supabase/order-kds.ts`):** Staff views keep authenticated unfiltered `useRealtimeChannel` (commit-synced handler refs) + safe `useLatestRefetch` (`hooks/useLatestRefetch.ts`, which also exports `nextAsyncLoadFlags`, `createAsyncLoadState`, `useLatestAsyncLoad`). `KitchenOrdersProvider` (`KdsPreparationPort`) progresses tickets item-by-item (`order_items.status`: `preparing` -> `ready`, undo via `PREV_ITEM_STATUS`, ticket-level `handOverOrder` to `served`, plus `recallLastOrder()` -> `recall_last_completed_order()`). `orders.status` is computed server-side (`sync_order_status_from_items`, migration `0082`). `TableSettlementProvider` (`TableSettlementPort`) handles `serveTableReadyOrders`, `settleTableCash`, and `settleOrder` -> `confirm_table_payment(tableId, "cash")` via `ConfirmCashPayment`; `handle_order_paid` only fires when `payment_status` updates to `'paid'`, never on `INSERT`.
- **Menu catalog & persistence (`lib/supabase/menu-data.ts`, `lib/supabase/menu-data-cached.ts`):** Single canonical module owning catalog queries, row mapping, admin CRUD, Storage image helpers (`validateMenuItemImageFile`, `uploadMenuItemImage`), and port-backed unified item saves (`MenuPort`, `createSupabaseMenuAdapter`, `saveMenuItem`).
- **Database & RLS (`supabase/migrations/`, see `supabase/CLAUDE.md` for full range details):** Migrations `0001`–`0094` (including multi-category join table `0090`, universal `confirm_table_payment` `0091`, shift-gate & tax removal `0094`) plus pending `20260922154757_secure_qr_ordering_boundaries.sql`. Never drop legacy DB tables/columns.
  - **Guest-safe RPCs:** Never grant broad anon table access or `return` full `tables` rows (`qr_code_token` leak); scope `SECURITY DEFINER` RPCs with `set search_path = ''`/`public` and verify live `information_schema.role_routine_grants` (Supabase auto-re-grants `EXECUTE` on `CREATE FUNCTION` — always use a follow-up revoke if needed).
  - **Triggers & RLS gotchas:** `AFTER UPDATE OF column_name` triggers miss changes made by an earlier `BEFORE` trigger unless unscoped (migration `0024`); use `current_user_role() is null or ...` (three-valued `NULL` trap for anon); use `coalesce()` because JSON `null` skips Postgres parameter defaults; keep `toRealOrderType`/`fromRealOrderType` (`lib/supabase/order-mapping.ts`) for legacy `pickup` DB rows; pair every UI Supabase write with `.catch()` so RLS denials surface clearly.
- **UI, Storage & Edge Functions:**
  - Base UI `<Button render={<Link href="..." />} nativeButton={false}>` (no `asChild`); explicit `left-0.5` on toggle thumbs; keep `"disabled + tooltip"` for unavailable actions (like standalone `/menu`).
  - Inject `SupabaseClient` into `lib/supabase/*.ts` functions; only `lib/supabase/menu-data-cached.ts` (`getPublicMenuData()`, 20s `unstable_cache`) omits it for public catalog reads.
  - Edge Function env vars (`Deno.env`) are stored separately from Vercel env vars (`supabase secrets set`). For any guest-callable function, only forward an `Authorization` header when JWT-shaped; `create-staff-account` stays admin-only with `verify_jwt` enabled. Supabase Auth redirect URLs are Dashboard-only.

## Agent skills

### Issue tracker

GitHub Issues in `Gnoltd/CafeShopApp` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`GLOSSARY.md` + `docs/adr/` at repo root). See `docs/agents/domain.md` — always use the exact domain terms from `GLOSSARY.md` (`Table`, `Guest Active Table`, `Table Session`, `Draft Cart`, `Round`, `Bill Request`, `KDS Ticket`, `Table Settlement`, `Menu Item`, `Role`) and `/codebase-design` (`module`, `interface`, `implementation`, `depth`, `deep`, `shallow`, `seam`, `adapter`, `leverage`, `locality`, `ports & adapters`, `in-process`).
