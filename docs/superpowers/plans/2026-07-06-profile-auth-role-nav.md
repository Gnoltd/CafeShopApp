# Profile Auth-Gate + Role-Based Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `/profile`, `/orders`, and `/loyalty` behind a real login (guest → `/login`), and give a logged-in Staff/Manager/Admin user a role-appropriate "Go to [X]" shortcut back to their own work area, shown as a header badge (all customer-facing layouts) and a card on the Profile page.

**Architecture:** Extend `middleware.ts`'s existing `resolveRedirect` with a new exact-path (not prefix) check reusing the role it already resolves per request. Add a small DI'd `getCurrentRole(supabase)` helper (same pattern as `lib/supabase/menu-data.ts`) called from three layouts and the Profile page to drive the two new UI pieces.

**Tech Stack:** Next.js App Router (Server Components + one Client Component), `@supabase/ssr`, `next-intl`, Vitest, Tailwind v4 / shadcn (Base UI) components.

## Global Constraints

- **Exact-match, not `startsWith`, for the new auth-required paths.** This is
  what lets `/orders` (the list) redirect a guest while `/orders/[orderId]`
  (Order Tracking, reached by guest checkout) stays reachable. Do not
  change `/orders/[orderId]`'s behavior.
- **Fail-open-to-anonymous convention**: any new auth/role lookup returns
  `null` on error (unreachable/misconfigured Supabase) rather than
  throwing — matches `resolveRole()` in `middleware.ts` and every other
  Supabase call site in this app.
- **Bilingual always**: every new user-facing string gets a key in both
  `messages/vi.json` and `messages/en.json`, added in the same commit as
  the code that uses it.
- **Base UI's `render` prop, never `asChild`**, for any polymorphic
  `Button` that navigates — pass `nativeButton={false}` alongside
  `render={<Link .../>}`. Every existing use of `components/ui/button.tsx`'s
  `Button` in this codebase is from a `"use client"` component; do not
  introduce the first server-rendered use of it — see Task 3 for why the
  header badge uses a plain `Link` instead.
- **No changes to `/staff/*` or `/admin/*` middleware rules** — this plan
  only adds new auth-required paths, it doesn't touch `ROUTE_GROUP_ROLES`
  or `ADMIN_ONLY_PREFIXES`.
- Reference mockups (already generated and approved, Stitch project
  `4654820544595168289`): screen `4e4bcae94d9d422f97df6e41e18b6790`
  (Profile staff-access card), screen `1d413b40d2904396862d12674d5863e9`
  (Home header staff badge).

---

### Task 1: Middleware auth gate for `/profile`, `/orders`, `/loyalty`

**Files:**
- Modify: `middleware.ts`
- Test: `middleware.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — reuses existing exported `resolveRedirect(pathname: string, role: string | null): string | null`.
- Produces: `resolveRedirect` now also handles the three new exact paths. No signature change, so no other task depends on new exports from this one.

- [ ] **Step 1: Write the failing tests**

Create `middleware.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { resolveRedirect } from "./middleware"

describe("resolveRedirect — auth-required exact paths", () => {
  it("redirects an anonymous guest away from /profile", () => {
    expect(resolveRedirect("/profile", null)).toBe("/login")
  })

  it("redirects an anonymous guest away from /orders", () => {
    expect(resolveRedirect("/orders", null)).toBe("/login")
  })

  it("redirects an anonymous guest away from /loyalty", () => {
    expect(resolveRedirect("/loyalty", null)).toBe("/login")
  })

  it("allows a logged-in customer to reach /profile", () => {
    expect(resolveRedirect("/profile", "customer")).toBeNull()
  })

  it("allows a logged-in staff user to reach /orders", () => {
    expect(resolveRedirect("/orders", "staff")).toBeNull()
  })

  it("allows a logged-in admin to reach /loyalty", () => {
    expect(resolveRedirect("/loyalty", "admin")).toBeNull()
  })

  it("does not gate an individual order tracking page for a guest", () => {
    expect(resolveRedirect("/orders/abc123", null)).toBeNull()
  })
})

describe("resolveRedirect — existing /staff and /admin behavior unaffected", () => {
  it("still redirects an anonymous guest away from /staff/pos", () => {
    expect(resolveRedirect("/staff/pos", null)).toBe("/login")
  })

  it("still redirects a customer away from /admin/dashboard", () => {
    expect(resolveRedirect("/admin/dashboard", "customer")).toBe("/menu")
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run middleware.test.ts`
Expected: the three "auth-required exact paths" redirect tests (`/profile`, `/orders`, `/loyalty` for a guest) FAIL with the actual value being `null` instead of `"/login"`. The other tests already pass against today's code.

- [ ] **Step 3: Implement the exact-path check**

In `middleware.ts`, add the new constant near `ADMIN_ONLY_PREFIXES`/`ROUTE_GROUP_ROLES`, and check it first inside `resolveRedirect`:

```ts
const ADMIN_ONLY_PREFIXES = ["/admin/staff", "/admin/settings"]

const AUTH_REQUIRED_EXACT_PATHS = ["/profile", "/orders", "/loyalty"]

const ROUTE_GROUP_ROLES: { prefix: string; roles: string[] }[] = [
  { prefix: "/staff", roles: ["staff", "manager", "admin"] },
  { prefix: "/admin", roles: ["manager", "admin"] },
]

export function resolveRedirect(pathname: string, role: string | null): string | null {
  if (AUTH_REQUIRED_EXACT_PATHS.includes(pathname) && !role) {
    return "/login"
  }

  const adminOnlyMatch = ADMIN_ONLY_PREFIXES.find((p) => pathname.startsWith(p))
  if (adminOnlyMatch) {
    if (role !== "admin") {
      return role ? (ROLE_HOME[role] ?? "/menu") : "/login"
    }
    return null
  }

  const match = ROUTE_GROUP_ROLES.find((r) => pathname.startsWith(r.prefix))
  if (!match) return null

  if (!role || !match.roles.includes(role)) {
    return role ? (ROLE_HOME[role] ?? "/menu") : "/login"
  }
  return null
}
```

(Only the two new lines plus the new constant are additions — the rest of the function is unchanged from today.)

- [ ] **Step 4: Run tests to verify they all pass**

Run: `npx vitest run middleware.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "$(cat <<'EOF'
Gate /profile, /orders, /loyalty behind login in middleware

Guests are redirected to /login, matching the existing /staff and
/admin pattern. Exact-path (not prefix) matching so /orders/[orderId]
(reached via guest checkout) stays accessible.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `getCurrentRole()` helper

**Files:**
- Create: `lib/get-current-role.ts`
- Test: `lib/get-current-role.test.ts`

**Interfaces:**
- Consumes: a `SupabaseClient` (from `@supabase/supabase-js`), same DI convention as `lib/supabase/menu-data.ts`.
- Produces: `getCurrentRole(supabase: SupabaseClient): Promise<string | null>` — Tasks 3 and 4's server call sites import and call this with a client built from `lib/supabase/server.ts`'s `createClient()`.

- [ ] **Step 1: Write the failing tests**

Create `lib/get-current-role.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentRole } from "./get-current-role"

function fakeSupabase({ user, role }: { user: { id: string } | null; role?: string | null }) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: user ? { role: role ?? null } : null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe("getCurrentRole", () => {
  it("returns null when there is no logged-in user", async () => {
    const supabase = fakeSupabase({ user: null })
    expect(await getCurrentRole(supabase)).toBeNull()
  })

  it("returns the profile's role for a logged-in user", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, role: "staff" })
    expect(await getCurrentRole(supabase)).toBe("staff")
  })

  it("returns null if the auth/profile lookup throws", async () => {
    const supabase = {
      auth: { getUser: () => Promise.reject(new Error("network down")) },
    } as unknown as SupabaseClient
    expect(await getCurrentRole(supabase)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/get-current-role.test.ts`
Expected: FAIL — `lib/get-current-role.ts` does not exist yet (`Cannot find module './get-current-role'`).

- [ ] **Step 3: Write the implementation**

Create `lib/get-current-role.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export async function getCurrentRole(supabase: SupabaseClient): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return null

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    return profile?.role ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/get-current-role.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/get-current-role.ts lib/get-current-role.test.ts
git commit -m "$(cat <<'EOF'
Add getCurrentRole() server helper

DI'd against a SupabaseClient (same convention as menu-data.ts),
mirrors middleware's resolveRole() but built on the cookie-based
server client so it's safe to call from Server Components. Returns
null on no session or any error, same fail-open convention used
everywhere else in the app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Header role badge

**Files:**
- Modify: `components/customer/header.tsx`
- Modify: `app/[locale]/(marketing)/layout.tsx`
- Modify: `app/[locale]/(auth)/layout.tsx`
- Modify: `app/[locale]/(customer)/layout.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `getCurrentRole` (Task 2), `ROLE_HOME` from `lib/roles.ts` (existing), `Link` from `@/i18n/navigation` (existing).
- Produces: `CustomerHeader` now accepts an optional `role?: string | null` prop. No other task depends on further exports from this one.

**Note on why this uses a plain `Link`, not `Button`:** `CustomerHeader` is
an async Server Component (`getTranslations` from `next-intl/server`).
Every existing use of `components/ui/button.tsx`'s `Button` (with the
`render={<Link .../>}` pattern) in this codebase is from a `"use client"`
component — there's no proven precedent for using it from a plain Server
Component, and Base UI's primitive likely needs a client boundary. A
styled `Link` avoids that question entirely and is simpler for what's
just a navigation pill, not an interactive button.

- [ ] **Step 1: Add the new `RoleNav` namespace to both message files**

In `messages/vi.json`, add a new top-level key (alongside `Profile`, `Customer`, etc.):

```json
"RoleNav": {
  "badgeStaff": "Nhân Viên",
  "badgeAdmin": "Quản Trị"
}
```

In `messages/en.json`:

```json
"RoleNav": {
  "badgeStaff": "Staff",
  "badgeAdmin": "Admin"
}
```

- [ ] **Step 2: Update `CustomerHeader`**

Replace `components/customer/header.tsx` with:

```tsx
import { Coffee, Briefcase } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { BackButton } from "@/components/customer/back-button"
import { Link } from "@/i18n/navigation"
import { ROLE_HOME } from "@/lib/roles"

export async function CustomerHeader({
  showBack = false,
  role = null,
}: {
  showBack?: boolean
  role?: string | null
}) {
  const t = await getTranslations("Brand")
  const tCustomer = await getTranslations("Customer")
  const tRoleNav = await getTranslations("RoleNav")
  const isStaffRole = role === "staff" || role === "manager" || role === "admin"

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-card/95 px-4 backdrop-blur-sm">
      {showBack && <BackButton label={tCustomer("back")} />}
      <Coffee className="h-5 w-5 text-primary" />
      <span className="font-semibold text-primary">{t("name")}</span>
      {role && isStaffRole && (
        <Link
          href={ROLE_HOME[role]}
          className="ml-auto flex items-center gap-1 rounded-full bg-secondary/15 px-3 py-1 text-xs font-medium text-secondary transition-colors hover:bg-secondary/25"
        >
          <Briefcase className="h-3.5 w-3.5" />
          {role === "staff" ? tRoleNav("badgeStaff") : tRoleNav("badgeAdmin")}
        </Link>
      )}
    </header>
  )
}
```

- [ ] **Step 3: Wire `getCurrentRole` into the three layouts**

Replace `app/[locale]/(marketing)/layout.tsx`:

```tsx
import { CustomerHeader } from "@/components/customer/header"
import { BottomNav } from "@/components/customer/bottom-nav"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)
  return (
    <>
      <CustomerHeader role={role} />
      <div className="min-h-screen pb-20">{children}</div>
      <BottomNav />
    </>
  )
}
```

Replace `app/[locale]/(auth)/layout.tsx`:

```tsx
import { CustomerHeader } from "@/components/customer/header"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)
  return (
    <>
      <CustomerHeader role={role} />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center py-8">{children}</div>
    </>
  )
}
```

Replace `app/[locale]/(customer)/layout.tsx`:

```tsx
import { CustomerHeader } from "@/components/customer/header"
import { BottomNav } from "@/components/customer/bottom-nav"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)
  return (
    <>
      <CustomerHeader showBack role={role} />
      <div className="min-h-screen pb-20">{children}</div>
      <BottomNav />
    </>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/customer/header.tsx "app/[locale]/(marketing)/layout.tsx" "app/[locale]/(auth)/layout.tsx" "app/[locale]/(customer)/layout.tsx" messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Add role badge to CustomerHeader for logged-in staff/manager/admin

Shows a small "Staff"/"Admin" pill linking back to that role's home
(POS or Admin Dashboard) when browsing the customer-facing side.
Wired into all three layouts that render CustomerHeader.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Profile staff-access card

**Files:**
- Modify: `components/customer/profile-view.tsx`
- Modify: `app/[locale]/(customer)/profile/page.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `getCurrentRole` (Task 2), `ROLE_HOME` (existing), `Button`/`Link` (existing, safe here since `ProfileView` is already `"use client"`).
- Produces: `ProfileView` now accepts an optional `role?: string | null` prop. Terminal task — nothing downstream depends on further exports.

- [ ] **Step 1: Add the new `Profile` namespace keys to both message files**

In `messages/vi.json`, inside the existing `"Profile"` object, add:

```json
"staffAccessHeadlineStaff": "Tài Khoản Nhân Viên",
"staffAccessSubtextStaff": "Bạn có quyền truy cập nhân viên.",
"staffAccessButtonStaff": "Đến Quầy Order",
"staffAccessHeadlineAdmin": "Tài Khoản Quản Trị",
"staffAccessSubtextAdmin": "Bạn có quyền quản trị hệ thống.",
"staffAccessButtonAdmin": "Đến Bảng Điều Khiển"
```

In `messages/en.json`, inside the existing `"Profile"` object, add:

```json
"staffAccessHeadlineStaff": "Staff Account",
"staffAccessSubtextStaff": "You have staff access.",
"staffAccessButtonStaff": "Go to POS",
"staffAccessHeadlineAdmin": "Admin Account",
"staffAccessSubtextAdmin": "You have administrative access.",
"staffAccessButtonAdmin": "Go to Admin Dashboard"
```

- [ ] **Step 2: Add the `role` prop and staff-access card to `ProfileView`**

In `components/customer/profile-view.tsx`, add imports (alongside the existing ones):

```tsx
import { LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ROLE_HOME } from "@/lib/roles"
```

Change the function signature:

```tsx
export function ProfileView({ role = null }: { role?: string | null }) {
```

Add this line inside the component body, alongside the other derived values (after `const params = useParams()`):

```tsx
  const isStaffRole = role === "staff" || role === "manager" || role === "admin"
```

Insert this new section between the existing avatar/name `<section>` (ends at the line with `</section>` right after the `memberIdLabel` paragraph) and the editable-fields `<section className="mb-6 space-y-3">`:

```tsx
      {role && isStaffRole && (
        <section className="mb-6 rounded-2xl border-2 border-secondary/30 bg-secondary/10 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary">
              <LayoutDashboard className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-card-foreground">
                {role === "staff" ? t("staffAccessHeadlineStaff") : t("staffAccessHeadlineAdmin")}
              </p>
              <p className="text-sm text-muted-foreground">
                {role === "staff" ? t("staffAccessSubtextStaff") : t("staffAccessSubtextAdmin")}
              </p>
            </div>
          </div>
          <Button
            className="h-11 w-full rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80"
            render={<Link href={ROLE_HOME[role]} />}
            nativeButton={false}
          >
            {role === "staff" ? t("staffAccessButtonStaff") : t("staffAccessButtonAdmin")}
          </Button>
        </section>
      )}
```

(`Link` is already imported in this file from `@/i18n/navigation`.)

- [ ] **Step 3: Wire `getCurrentRole` into the Profile page**

Replace `app/[locale]/(customer)/profile/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { ProfileView } from "@/components/customer/profile-view"
import { createClient } from "@/lib/supabase/server"
import { getCurrentRole } from "@/lib/get-current-role"

export default async function ProfilePage() {
  const t = await getTranslations("Customer")
  const supabase = await createClient()
  const role = await getCurrentRole(supabase)
  return (
    <>
      <h1 className="sr-only">{t("profileTitle")}</h1>
      <ProfileView role={role} />
    </>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/customer/profile-view.tsx "app/[locale]/(customer)/profile/page.tsx" messages/vi.json messages/en.json
git commit -m "$(cat <<'EOF'
Add staff-access card to Profile for logged-in staff/manager/admin

Shows a role-labeled card between the avatar and editable fields with
a button back to that role's home (POS or Admin Dashboard). Regular
customers see no change to today's page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full local verification suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`
Expected: all pass. (The 5 pre-existing `react-hooks/set-state-in-effect` ESLint errors noted in `daily.md` predate this plan — confirm the count hasn't grown, don't try to fix them here.)

- [ ] **Step 2: Manual verification on the live Vercel deployment**

Per this project's standing preference, verify against `https://phadincafe.vercel.app`, not localhost, after this branch is pushed/deployed. Check, for each of these states:

- Logged out (guest): visiting `/profile`, `/orders`, `/loyalty` redirects to `/login`; opening an existing order's `/orders/[orderId]` link still loads normally.
- Logged in as `customer` (or any account with that role): all three pages load normally; no header badge; no staff-access card on Profile.
- Logged in as `staff`: header badge reading "Staff" appears on Landing/Login/Signup/Menu/Cart/etc. and links to `/staff/pos`; Profile page shows the staff-access card with a working "Go to POS" button.
- Logged in as `manager` or `admin`: header badge reads "Admin" and links to `/admin/dashboard`; Profile page shows the admin-access card with a working "Go to Admin Dashboard" button.

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Landing, Auth, and remaining customer pages" section, replace the "Known gap, real bug (caught 2026-07-06, fix not yet implemented)" bullet under **Profile** with a short note that the gate and role-nav badge/card are now real, referencing this plan and its spec doc, so a future session doesn't re-discover the same gap.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document Profile auth-gate + role-nav as shipped in CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
