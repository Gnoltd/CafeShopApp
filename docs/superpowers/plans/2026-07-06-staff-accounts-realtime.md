# Real Staff Accounts + Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `components/admin/staff-accounts.tsx`'s local mock
array with real Supabase data and Realtime — the fourth and final
sub-project of the "make all data real-time" initiative. Real staff
account creation (a genuine Supabase Auth user, not just a table row),
a new `is_active` disable mechanism, and a controlled email-read path
all need to be built, since none of them exist in the schema today.

**Architecture:** One migration (`is_active` column, `current_user_role()`
update, `get_staff_members()` read function, Realtime publication). One
new Edge Function (`create-staff-account`) using the Auth Admin API. One
new query module (`lib/supabase/staff-data.ts`). Two existing files that
read role via a raw `profiles.role` column select — `middleware.ts` and
`lib/get-current-role.ts` — need the same `is_active` fix
`current_user_role()` gets, since neither of them actually calls that
function today (found while auditing every role-read call site before
writing this plan, not assumed).

**Tech Stack:** Next.js Client Components, Postgres `plpgsql` (one
`security definer` read function), Supabase Auth Admin API via a new
Edge Function, `@supabase/supabase-js` Realtime, Vitest.

## Global Constraints

- Every new/changed piece of UI text needs keys in **both**
  `messages/en.json` and `messages/vi.json`.
- DI convention: every function in `lib/supabase/staff-data.ts` takes
  `supabase: SupabaseClient` as its first argument, unit-tested with a
  fake/spy client.
- Every SQL migration is applied via `mcp__supabase__apply_migration`
  against the live project `qhiypdqnrnzndxdwqxbx`, then verified with
  `mcp__supabase__execute_sql` before moving on.
- **No RLS policy changes in this plan** — `profiles_select_staff`/
  `profiles_update_admin`/`on_profile_role_change` already correctly
  gate everything this plan touches once `current_user_role()` accounts
  for `is_active`.
- Realtime subscriptions in this plan are **unfiltered** (subscribe to
  all `profiles` changes, refetch via `getStaffMembers()`) — a column
  filter does not reliably combine with RLS-gated `postgres_changes`,
  confirmed the hard way in the Orders sub-project.
- The `create-staff-account` Edge Function deploys with
  **`verify_jwt: true`** (the default) — unlike `place-order`, there is
  no guest use case here; only an already-authenticated admin ever calls
  this, so platform-level JWT verification is the correct, simpler
  first gate.
- Base UI's `Button` has no `asChild` — polymorphic rendering uses
  `render={<Link .../>}` + `nativeButton={false}` (not needed in this
  plan, noted for consistency).

---

### Task 1: Migration `0016` — `is_active`, `current_user_role()`, `get_staff_members()`, Realtime

**Files:**
- Create: `supabase/migrations/0016_staff_active_and_directory_fn.sql`

**Interfaces:**
- Produces: `profiles.is_active`; an updated
  `public.current_user_role()`; `public.get_staff_members() returns
  table (id uuid, full_name text, phone text, role user_role, is_active
  boolean, email text)`; `profiles` added to the `supabase_realtime`
  publication.

- [ ] **Step 1: Verify pre-conditions**

Use `mcp__supabase__execute_sql`:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'profiles';
```

Expected: no rows (confirms `profiles` isn't already in the publication).

- [ ] **Step 2: Write the migration SQL**

```sql
-- 0016_staff_active_and_directory_fn.sql
-- Adds a disable mechanism (is_active) that revokes staff/manager/admin
-- powers by downgrading current_user_role() to 'customer' — no separate
-- ban/logout mechanism needed, and a disabled employee keeps ordinary
-- customer access rather than being locked out entirely. Adds
-- get_staff_members(), the only controlled path that reads auth.users
-- (protected schema, not exposed to the client directly) to surface
-- each staff member's email. Adds profiles to the Realtime publication
-- (the step the Orders sub-project's migration forgot, found live).

alter table public.profiles add column is_active boolean not null default true;

create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select case when is_active then role else 'customer' end
  from public.profiles where id = auth.uid();
$$;

create or replace function public.get_staff_members()
returns table (
  id uuid,
  full_name text,
  phone text,
  role user_role,
  is_active boolean,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('staff', 'manager', 'admin') then
    raise exception 'not authorized';
  end if;

  return query
    select p.id, p.full_name, p.phone, p.role, p.is_active, u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role <> 'customer'
    order by p.created_at;
end;
$$;

grant execute on function public.get_staff_members() to authenticated;

alter publication supabase_realtime add table public.profiles;
```

- [ ] **Step 3: Apply the migration**

Use `mcp__supabase__apply_migration` with `name:
"0016_staff_active_and_directory_fn"` and the SQL from Step 2 as `query`.

- [ ] **Step 4: Verify the schema, function, and publication**

Use `mcp__supabase__execute_sql`:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active';

select routine_name, security_type from information_schema.routines
where routine_schema = 'public' and routine_name in ('current_user_role', 'get_staff_members');

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'profiles';
```

Expected: `is_active boolean`; both functions show `security_type =
'DEFINER'`; the publication query returns `profiles`.

- [ ] **Step 5: Verify `current_user_role()`'s new behavior directly**

Using the real admin account's id (confirm via `select id from
auth.users where email = 'admin@phadincoffee.dev'`), verify the
downgrade logic with a throwaway toggle (not left disabled):

```sql
-- capture current state, flip is_active off, check the function, flip back
select is_active from public.profiles where id = '<admin id>';
update public.profiles set is_active = false where id = '<admin id>';
-- as a normal session this would need auth.uid() = that id to test directly;
-- instead confirm the CASE logic is correct by reading it back with a join:
select p.id, p.role, p.is_active, (case when p.is_active then p.role else 'customer' end) as effective_role
from public.profiles p where p.id = '<admin id>';
update public.profiles set is_active = true where id = '<admin id>';
```

Expected: `effective_role = 'customer'` while `is_active = false`,
confirming the CASE expression is correct; admin's `is_active` restored
to `true` at the end — do not leave the real admin account disabled.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0016_staff_active_and_directory_fn.sql
git commit -m "Add is_active disable mechanism and get_staff_members() directory function"
```

---

### Task 2: Fix the two call sites that bypass `current_user_role()`

**Files:**
- Modify: `middleware.ts`
- Modify: `lib/get-current-role.ts`

**Interfaces:**
- Consumes: `profiles.is_active` from Task 1.
- Produces: both role-resolution paths correctly downgrade a disabled
  account to `"customer"`, matching what `current_user_role()` now does
  for every RLS-gated read/write.

- [ ] **Step 1: Fix `middleware.ts`'s `resolveRole`**

Both call sites currently do a raw `.select("role")`, which reads the
raw column directly — **neither actually calls the
`current_user_role()` SQL function**, so Task 1's fix does not
automatically apply to page-level gating or the role badge without this
task. Found by auditing every role-read call site before writing this
plan, not assumed.

```tsx
const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).single()
if (!profile) return null
return profile.is_active ? profile.role : "customer"
```

(Replaces the existing `const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single(); return profile?.role ?? null`.)

- [ ] **Step 2: Fix `lib/get-current-role.ts`'s `getCurrentRole`**

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
      .select("role, is_active")
      .eq("id", user.id)
      .single()

    if (!profile) return null
    return profile.is_active ? profile.role : "customer"
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "middleware|get-current-role"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts lib/get-current-role.ts
git commit -m "Fix middleware and role badge to respect is_active, matching current_user_role()"
```

---

### Task 3: `create-staff-account` Edge Function

**Files:**
- Create: `supabase/functions/create-staff-account/index.ts`

**Interfaces:**
- Consumes: Supabase Auth Admin API (`auth.admin.createUser`);
  `profiles` table (service-role read + update).
- Produces: a deployed `POST /functions/v1/create-staff-account`
  endpoint accepting `{ fullName, email, role }`, returning `{ userId,
  temporaryPassword }` on success.

- [ ] **Step 1: Write the function**

```ts
// create-staff-account: creates a real, login-capable Supabase Auth
// account for a new staff/manager/admin hire — profiles rows can only
// ever be created via the handle_new_user trigger on auth.users insert,
// so this can't be a plain table insert. Uses email_confirm: true to
// skip sending any confirmation email at all (sidesteps this project's
// already-documented shared-email rate limit rather than hitting it
// again), and returns a randomly generated one-time password for the
// admin to relay to the new hire out of band.
//
// verify_jwt stays enabled (the default) for this function — unlike
// place-order, there is no guest use case here.

import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_ROLES = ["staff", "manager", "admin"]

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  let password = ""
  for (let i = 0; i < 16; i++) {
    password += chars[Math.floor(Math.random() * chars.length)]
  }
  return password
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders })
  }

  try {
    const { fullName, email, role } = await req.json()
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders })
    }

    // Resolve who is actually calling — the service-role client below
    // has no session of its own, so the caller's identity must come
    // from their own forwarded JWT via an anon-key client first.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders })
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: callerProfile } = await serviceClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single()

    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only an active admin can create staff accounts" }), {
        status: 403,
        headers: corsHeaders,
      })
    }

    if (!fullName || !email || !VALID_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: corsHeaders })
    }

    const temporaryPassword = randomPassword()

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create account" }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    const { error: roleError } = await serviceClient
      .from("profiles")
      .update({ role, full_name: fullName })
      .eq("id", created.user.id)

    if (roleError) {
      return new Response(JSON.stringify({ error: roleError.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ userId: created.user.id, temporaryPassword }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Unexpected error creating staff account" }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
```

- [ ] **Step 2: Deploy the function**

Use `mcp__supabase__deploy_edge_function` with `name:
"create-staff-account"`, `entrypoint_path: "index.ts"`,
`verify_jwt: true`, and the file content from Step 1.

- [ ] **Step 3: Verify deployment**

Use `mcp__supabase__list_edge_functions` and confirm
`create-staff-account` shows status `ACTIVE`.

- [ ] **Step 4: Verify end-to-end with a real call**

Using the real admin account's credentials, sign in via
`/auth/v1/token?grant_type=password` (same pattern used earlier this
project to verify the bootstrap admin account) to get a real access
token, then call the function directly:

```bash
curl -s -X POST "https://qhiypdqnrnzndxdwqxbx.supabase.co/functions/v1/create-staff-account" \
  -H "Content-Type: application/json" \
  -H "apikey: <publishable key>" \
  -H "Authorization: Bearer <admin access token>" \
  -d '{"fullName": "Test Staffer", "email": "test.staffer.verify@phadincafe.dev", "role": "staff"}'
```

Expected: `{"userId": "...", "temporaryPassword": "..."}`. Then verify
via `execute_sql` that a `profiles` row exists for that user with
`role = 'staff'`, `is_active = true`, and via
`mcp__supabase__execute_sql` on `auth.users` that `email_confirmed_at`
is set (no confirmation email needed). Clean up this verification
account afterward (`delete from auth.users where email =
'test.staffer.verify@phadincafe.dev'` — cascades to `profiles` via
`on delete cascade`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-staff-account/index.ts
git commit -m "Add create-staff-account Edge Function"
```

---

### Task 4: Query layer — `lib/supabase/staff-data.ts`

**Files:**
- Create: `lib/supabase/staff-data.ts`
- Create: `lib/supabase/staff-data.test.ts`

**Interfaces:**
- Consumes: `get_staff_members()` RPC (Task 1); `profiles` table (plain
  update); `create-staff-account` Edge Function (Task 3).
- Produces: `StaffRole`, `StaffMember`, `CreateStaffInput` types and
  `getStaffMembers`, `updateStaffMember`, `createStaffAccount` — used by
  Task 5.

- [ ] **Step 1: Write the failing test for `getStaffMembers`**

```ts
// lib/supabase/staff-data.test.ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getStaffMembers } from "./staff-data"

describe("getStaffMembers", () => {
  it("maps snake_case RPC rows to camelCase StaffMember", async () => {
    const row = {
      id: "staff-1",
      full_name: "Nguyễn Thu Hà",
      phone: "0901234567",
      role: "admin",
      is_active: true,
      email: "thuha.nguyen@phadincafe.vn",
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: [row], error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getStaffMembers(supabase)

    expect(rpcSpy).toHaveBeenCalledWith("get_staff_members")
    expect(result).toEqual([
      {
        id: "staff-1",
        fullName: "Nguyễn Thu Hà",
        phone: "0901234567",
        role: "admin",
        isActive: true,
        email: "thuha.nguyen@phadincafe.vn",
      },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/supabase/staff-data.test.ts`
Expected: FAIL — `Cannot find module './staff-data'`.

- [ ] **Step 3: Write `staff-data.ts` (all functions)**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type StaffRole = "staff" | "manager" | "admin"

export type StaffMember = {
  id: string
  fullName: string
  phone: string | null
  role: StaffRole
  isActive: boolean
  email: string
}

export type CreateStaffInput = {
  fullName: string
  email: string
  role: StaffRole
}

export type UpdateStaffInput = {
  fullName: string
  role: StaffRole
  isActive: boolean
}

type StaffMemberRow = {
  id: string
  full_name: string | null
  phone: string | null
  role: StaffRole
  is_active: boolean
  email: string
}

function mapStaffMemberRow(row: StaffMemberRow): StaffMember {
  return {
    id: row.id,
    fullName: row.full_name ?? "",
    phone: row.phone,
    role: row.role,
    isActive: row.is_active,
    email: row.email,
  }
}

export async function getStaffMembers(supabase: SupabaseClient): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("get_staff_members")
  if (error) throw error
  return ((data ?? []) as StaffMemberRow[]).map(mapStaffMemberRow)
}

export async function updateStaffMember(
  supabase: SupabaseClient,
  id: string,
  input: UpdateStaffInput
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: input.fullName, role: input.role, is_active: input.isActive })
    .eq("id", id)
  if (error) throw error
}

export async function createStaffAccount(
  supabase: SupabaseClient,
  input: CreateStaffInput
): Promise<{ userId: string; temporaryPassword: string }> {
  const { data, error } = await supabase.functions.invoke("create-staff-account", {
    body: { fullName: input.fullName, email: input.email, role: input.role },
  })
  if (error || data?.error) throw error ?? new Error(data.error)
  return data as { userId: string; temporaryPassword: string }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/supabase/staff-data.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the remaining tests**

Append to `lib/supabase/staff-data.test.ts`:

```ts
import { updateStaffMember, createStaffAccount } from "./staff-data"

describe("updateStaffMember", () => {
  it("updates full_name, role, and is_active in one call", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateStaffMember(supabase, "staff-1", { fullName: "New Name", role: "manager", isActive: false })

    expect(updateSpy).toHaveBeenCalledWith({ full_name: "New Name", role: "manager", is_active: false })
    expect(eqSpy).toHaveBeenCalledWith("id", "staff-1")
  })
})

describe("createStaffAccount", () => {
  it("invokes the Edge Function with the right body and returns its result", async () => {
    const invokeSpy = vi.fn(() =>
      Promise.resolve({ data: { userId: "new-id", temporaryPassword: "Abc123XyZ9" }, error: null })
    )
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    const result = await createStaffAccount(supabase, {
      fullName: "Test Staffer",
      email: "test@phadincafe.dev",
      role: "staff",
    })

    expect(invokeSpy).toHaveBeenCalledWith("create-staff-account", {
      body: { fullName: "Test Staffer", email: "test@phadincafe.dev", role: "staff" },
    })
    expect(result).toEqual({ userId: "new-id", temporaryPassword: "Abc123XyZ9" })
  })

  it("throws when the Edge Function returns a body-level error", async () => {
    const invokeSpy = vi.fn(() => Promise.resolve({ data: { error: "duplicate email" }, error: null }))
    const supabase = { functions: { invoke: invokeSpy } } as unknown as SupabaseClient

    await expect(
      createStaffAccount(supabase, { fullName: "X", email: "x@x.com", role: "staff" })
    ).rejects.toThrow("duplicate email")
  })
})
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run lib/supabase/staff-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/staff-data.ts lib/supabase/staff-data.test.ts
git commit -m "Add staff-data query layer for real staff directory/account creation"
```

---

### Task 5: `staff-accounts.tsx` + `staff-member-form.tsx` — real data, Realtime, Add/Edit

**Files:**
- Modify: `components/admin/staff-accounts.tsx`
- Modify: `components/admin/staff-member-form.tsx`
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `staff-data.ts` from Task 4.
- Produces: real Realtime-backed staff list; a real Add Staff flow
  showing the generated password once; a real Edit Staff flow with the
  logged-in admin's own row's active-toggle disabled.

- [ ] **Step 1: Rewrite `staff-accounts.tsx` to fetch real data + subscribe to Realtime**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { User, Lock, LockOpen, Plus, Pencil, Users, UserCheck, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { getStaffMembers, updateStaffMember, createStaffAccount, type StaffMember, type StaffRole } from "@/lib/supabase/staff-data"
import { StaffMemberForm } from "@/components/admin/staff-member-form"

const ROLE_STYLES: Record<StaffRole, string> = {
  admin: "border-primary/20 bg-primary/10 text-primary",
  manager: "border-secondary/20 bg-secondary/10 text-secondary",
  staff: "border-accent/40 bg-accent/20 text-accent-foreground",
}

const PAGE_SIZE = 5

type FormMode = { type: "add" } | { type: "edit"; member: StaffMember } | null

export function StaffAccounts() {
  const t = useTranslations("AdminStaff")
  const [supabase] = useState(() => createClient())
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  async function refetch() {
    const rows = await getStaffMembers(supabase)
    setStaff(rows)
  }

  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setCurrentUserId(user?.id ?? null)
    })

    refetch()
      .catch(() => {
        if (!cancelled) setError(t("loadError"))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const channel = supabase
      .channel("staff-accounts-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        if (!cancelled) refetch()
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" && status !== "CLOSED") {
          console.warn(`Staff accounts realtime subscription status: ${status}`)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [staff.length])

  const totalPages = Math.max(1, Math.ceil(staff.length / PAGE_SIZE))
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pagedStaff = useMemo(() => staff.slice(pageStart, pageStart + PAGE_SIZE), [staff, pageStart])

  const activeCount = staff.filter((member) => member.isActive).length

  async function toggleActive(member: StaffMember) {
    setError(null)
    try {
      await updateStaffMember(supabase, member.id, {
        fullName: member.fullName,
        role: member.role,
        isActive: !member.isActive,
      })
    } catch {
      setError(t("saveError"))
    }
  }

  async function saveMember(input: { fullName: string; email: string; role: StaffRole; isActive: boolean }) {
    setError(null)
    try {
      if (formMode?.type === "edit") {
        await updateStaffMember(supabase, formMode.member.id, {
          fullName: input.fullName,
          role: input.role,
          isActive: input.isActive,
        })
        setFormMode(null)
      } else {
        const result = await createStaffAccount(supabase, {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
        })
        setFormMode(null)
        // Task 5 Step 2 shows the one-time password panel; wired in staff-member-form.tsx's
        // onSave contract returning to this component, which renders it here.
        setCreatedPassword(result.temporaryPassword)
      }
    } catch {
      setError(t("saveError"))
    }
  }

  const roleLabel = (role: StaffRole) =>
    role === "admin" ? t("roleAdmin") : role === "manager" ? t("roleManager") : t("roleStaff")

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-card-foreground">{t("title")}</h2>
        <Button className="h-10 gap-2" onClick={() => setFormMode({ type: "add" })}>
          <Plus className="h-4 w-4" />
          {t("addStaff")}
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {createdPassword && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-card-foreground">{t("passwordCreatedTitle")}</p>
            <p className="font-mono text-sm text-primary">{createdPassword}</p>
            <p className="text-xs text-muted-foreground">{t("passwordCreatedNote")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(createdPassword)}
          >
            {t("copyPassword")}
          </Button>
        </div>
      )}

      {formMode && (
        <StaffMemberForm
          initialMember={formMode.type === "edit" ? formMode.member : undefined}
          disableActiveToggle={formMode.type === "edit" && formMode.member.id === currentUserId}
          onCancel={() => setFormMode(null)}
          onSave={saveMember}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("totalStaff")}</p>
            <p className="text-xl font-bold text-card-foreground">{staff.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("activeCount")}</p>
            <p className="text-xl font-bold text-card-foreground">{activeCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserX className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("inactiveCount")}</p>
            <p className="text-xl font-bold text-card-foreground">{staff.length - activeCount}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("name")}</th>
              <th className="px-4 py-3 font-medium">{t("email")}</th>
              <th className="px-4 py-3 font-medium">{t("role")}</th>
              <th className="px-4 py-3 font-medium">{t("status")}</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t("status")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t("loading")}
                </td>
              </tr>
            ) : (
              pagedStaff.map((member) => (
                <tr key={member.id} className={cn(!member.isActive && "opacity-60")}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-bold text-card-foreground">{member.fullName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                        ROLE_STYLES[member.role]
                      )}
                    >
                      {roleLabel(member.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", member.isActive ? "bg-green-500" : "bg-muted-foreground")} />
                      <span className="text-card-foreground">{member.isActive ? t("active") : t("disabled")}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setFormMode({ type: "edit", member })}
                        aria-label={t("edit")}
                        title={t("edit")}
                        className="rounded-lg p-2 text-secondary transition-colors hover:bg-secondary/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(member)}
                        disabled={member.id === currentUserId}
                        className={cn(
                          "rounded-lg p-2 transition-colors disabled:pointer-events-none disabled:opacity-30",
                          member.isActive
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-green-600 hover:bg-green-100"
                        )}
                        title={member.id === currentUserId ? t("cannotDisableSelf") : member.isActive ? t("disabled") : t("active")}
                      >
                        {member.isActive ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="flex flex-col items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 sm:flex-row">
          <span className="text-xs text-muted-foreground">
            {t("showingItems", {
              start: staff.length === 0 ? 0 : pageStart + 1,
              end: Math.min(pageStart + PAGE_SIZE, staff.length),
              total: staff.length,
            })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              {t("previous")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "rounded-lg border px-3 py-1 text-xs font-medium transition-colors",
                  page === currentPage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-lg border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `staff-member-form.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { StaffMember, StaffRole } from "@/lib/supabase/staff-data"

export type { StaffMember, StaffRole }

export function StaffMemberForm({
  initialMember,
  disableActiveToggle,
  onCancel,
  onSave,
}: {
  initialMember?: StaffMember
  disableActiveToggle?: boolean
  onCancel: () => void
  onSave: (input: { fullName: string; email: string; role: StaffRole; isActive: boolean }) => Promise<void>
}) {
  const t = useTranslations("AdminStaff")
  const isEditing = Boolean(initialMember)

  const [fullName, setFullName] = useState(initialMember?.fullName ?? "")
  const [email, setEmail] = useState(initialMember?.email ?? "")
  const [role, setRole] = useState<StaffRole>(initialMember?.role ?? "staff")
  const [isActive, setIsActive] = useState(initialMember?.isActive ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    if (!fullName.trim() || !email.trim()) {
      setError(t("requiredFieldsError"))
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await onSave({ fullName: fullName.trim(), email: email.trim(), role, isActive })
    } catch {
      setError(t("saveError"))
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-card-foreground">
            {isEditing ? t("editStaffTitle") : t("addStaff")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label={t("cancel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("name")}</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("email")}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEditing}
              className="h-10 disabled:opacity-60"
              title={isEditing ? t("emailNotEditable") : undefined}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("role")}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="staff">{t("roleStaff")}</option>
              <option value="manager">{t("roleManager")}</option>
              <option value="admin">{t("roleAdmin")}</option>
            </select>
          </div>

          {isEditing && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium text-card-foreground">{t("activeToggle")}</span>
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                disabled={disableActiveToggle}
                onClick={() => setIsActive((prev) => !prev)}
                title={disableActiveToggle ? t("cannotDisableSelf") : undefined}
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors disabled:opacity-40",
                  isActive ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    isActive ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add new translation keys**

`messages/en.json`, inside `"AdminStaff"`:

```json
"loading": "Loading staff…",
"loadError": "Failed to load staff accounts. Try refreshing.",
"saveError": "Failed to save. Try again.",
"passwordCreatedTitle": "Account created — copy this password now",
"passwordCreatedNote": "This won't be shown again. Share it with the new hire securely.",
"copyPassword": "Copy",
"emailNotEditable": "Email can't be changed after an account is created",
"cannotDisableSelf": "You can't disable your own account"
```

`messages/vi.json`, inside `"AdminStaff"`:

```json
"loading": "Đang tải nhân viên…",
"loadError": "Không thể tải danh sách nhân viên. Vui lòng làm mới trang.",
"saveError": "Lưu thất bại. Vui lòng thử lại.",
"passwordCreatedTitle": "Đã tạo tài khoản — sao chép mật khẩu này ngay",
"passwordCreatedNote": "Mật khẩu này sẽ không hiển thị lại. Hãy gửi cho nhân viên mới một cách an toàn.",
"copyPassword": "Sao Chép",
"emailNotEditable": "Không thể thay đổi email sau khi tài khoản đã được tạo",
"cannotDisableSelf": "Bạn không thể khóa tài khoản của chính mình"
```

- [ ] **Step 4: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/admin/staff-accounts.tsx components/admin/staff-member-form.tsx messages/en.json messages/vi.json
git commit -m "Wire Staff Accounts to real data, Realtime, and account creation"
```

---

### Task 6: Live verification, docs, and finishing

**Files:**
- Modify: `CLAUDE.md`
- Modify: `daily.md`

**Interfaces:**
- Consumes: the fully wired feature from Tasks 1-5.
- Produces: updated project docs; confirmation of a green
  build/test/lint pipeline; a decision on merge/PR/discard.

- [ ] **Step 1: Run the full local verification pipeline**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Expected: no type errors; lint clean (same pre-existing baseline
documented in the Orders plan — do not let this task's changes add a
*new* one); all tests pass; build succeeds.

- [ ] **Step 2: Push and wait for the Vercel deployment**

```bash
git push
```

Confirm the resulting deployment on `https://phadincafe.vercel.app`
reaches `Ready`.

- [ ] **Step 3: Live verification with Playwright**

1. As admin: open Admin Staff, click "+ Add Staff", create a real
   account (e.g. "Test Verify", a throwaway email, role "staff").
   Confirm the one-time password panel appears with a real-looking
   generated password.
2. In a **fresh, separate browser context**, log in as that brand-new
   account using the generated password. Confirm login succeeds and it
   lands on the staff home (role-based redirect already existing
   infrastructure).
3. Back in the admin context (a **second** open Admin Staff tab),
   confirm the new account appears live via Realtime, no reload.
4. As admin, click the new account's disable (lock) icon.
5. In the new account's still-open session, navigate to `/staff/pos`.
   Confirm it now redirects away (role re-resolves to `customer` on the
   very next request — no stale-session risk, since role is never
   cached client-side).
6. Confirm the global role badge (`RoleBadge`/`lib/get-current-role.ts`)
   in that same session now shows "Guest"/"Customer" styling instead of
   "Staff" — proving Task 2's fix, not just Task 1's DB-level change.
7. Re-enable the account as admin; confirm the disabled account regains
   staff access on its next request without needing to log out/in.
8. Confirm the admin's own row has no enabled disable button (hover/
   click has no effect, tooltip explains why).

If any check fails, treat it as a real bug per
`superpowers:systematic-debugging` — do not proceed to Step 4 with a
known-broken feature.

- [ ] **Step 4: Clean up test data**

Delete the verification account created in Step 3
(`delete from auth.users where email = '<the throwaway email used>'`
— cascades to `profiles`). Confirm via `execute_sql` that the real admin
account's own `is_active` is still `true` (it should never have been
toggled during this verification — Step 8 only checked the button is
disabled, not that it was clicked).

- [ ] **Step 5: Update `CLAUDE.md`**

Add a section documenting: Staff Accounts is now real (migration
`0016`), the `is_active` disable mechanism and why `current_user_role()`
downgrading to `'customer'` was chosen over actually banning the Auth
account, the `create-staff-account` Edge Function and its one-time
generated-password flow (no email sent), and the real bug found and
fixed in two pre-existing files (`middleware.ts`,
`lib/get-current-role.ts`) that read `profiles.role` directly instead of
through `current_user_role()`. Update "Building the rest" to mark the
"make all data real-time" initiative's four originally-scoped
sub-projects as complete, with Stripe/VNPay as the remaining deferred
follow-up specs.

- [ ] **Step 6: Update `daily.md`**

Summarize this session's Staff Accounts work. Note the "make all data
real-time" initiative's four sub-projects (Inventory, Tables, Orders,
Staff accounts) are now all shipped. Set "Next session starts here" to
ask the user whether to pick up the deferred Stripe or VNPay spec next,
or move on to something else entirely — don't assume.

- [ ] **Step 7: Commit the docs**

```bash
git add CLAUDE.md daily.md
git commit -m "Document real staff accounts + realtime as shipped"
```

- [ ] **Step 8: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to
complete this work." Follow `superpowers:finishing-a-development-branch`
— verify tests, detect environment (normal repo, direct `main` work,
same as every prior feature this session), and since there's nothing to
merge/PR (already on `main`, already pushed), report that directly.
