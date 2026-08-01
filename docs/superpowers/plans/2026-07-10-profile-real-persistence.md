# Profile Real Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Profile's hardcoded `INITIAL_PROFILE` mock with real, persisted `full_name`/`phone` from `profiles`, and show the real Supabase Auth email as a read-only field.

**Architecture:** A new DI'd query-layer module (`lib/supabase/profile-data.ts`, matching every other `lib/supabase/*.ts` module) does a plain `select`/`update` against `profiles` — no RPC, no migration, since `profiles.full_name`/`profiles.phone` already exist and RLS policy `profiles_update_own` already authorizes a logged-in user to update their own row. `profile-view.tsx` fetches on mount and wires the existing inline pencil-edit UI to real writes, with inline error display on failure (mirroring `tables-management.tsx`'s `saveEditing` pattern) instead of failing silently.

**Tech Stack:** Next.js client component, Supabase JS client, Vitest for the query-layer unit tests, next-intl for the one new translation key.

## Global Constraints

- DI pattern: every `lib/supabase/*.ts` function takes `SupabaseClient` as its first argument (never a module-level singleton).
- New/changed user-facing strings go in **both** `messages/en.json` and `messages/vi.json`, same key, in the same namespace as neighboring keys.
- No RPC, no new migration — `profiles_update_own` RLS (migration `0001`) already permits this.
- Any Supabase write in the UI must have its failure path surfaced to the user (never a silent `.catch()` no-op) — this project's existing convention, called out explicitly in CLAUDE.md.
- Verify against the deployed Vercel URL (`https://phadincafe.vercel.app`), not just `npm run dev` — this project's explicit convention.

---

### Task 1: `lib/supabase/profile-data.ts` query-layer module

**Files:**
- Create: `lib/supabase/profile-data.ts`
- Test: `lib/supabase/profile-data.test.ts`

**Interfaces:**
- Produces: `getProfile(supabase: SupabaseClient, userId: string): Promise<{ fullName: string; phone: string }>`
- Produces: `updateProfile(supabase: SupabaseClient, userId: string, updates: Partial<{ fullName: string; phone: string }>): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `lib/supabase/profile-data.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getProfile, updateProfile } from "./profile-data"

describe("getProfile", () => {
  it("selects full_name and phone for the given user id, defaulting nulls to empty strings", async () => {
    const singleSpy = vi.fn(() => Promise.resolve({ data: { full_name: "Nguyễn Văn An", phone: null }, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const profile = await getProfile(supabase, "user-1")

    expect(selectSpy).toHaveBeenCalledWith("full_name, phone")
    expect(eqSpy).toHaveBeenCalledWith("id", "user-1")
    expect(profile).toEqual({ fullName: "Nguyễn Văn An", phone: "" })
  })

  it("throws when the query errors", async () => {
    const singleSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error("boom") }))
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: singleSpy }) }) }),
    } as unknown as SupabaseClient

    await expect(getProfile(supabase, "user-1")).rejects.toThrow("boom")
  })
})

describe("updateProfile", () => {
  it("updates only the provided fields, mapped to snake_case columns", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateProfile(supabase, "user-1", { fullName: "New Name" })

    expect(updateSpy).toHaveBeenCalledWith({ full_name: "New Name" })
    expect(eqSpy).toHaveBeenCalledWith("id", "user-1")
  })

  it("maps phone the same way", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateProfile(supabase, "user-1", { phone: "+84 901 234 567" })

    expect(updateSpy).toHaveBeenCalledWith({ phone: "+84 901 234 567" })
  })

  it("throws when the update errors", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: new Error("rls denied") }))
    const supabase = { from: () => ({ update: () => ({ eq: eqSpy }) }) } as unknown as SupabaseClient

    await expect(updateProfile(supabase, "user-1", { fullName: "X" })).rejects.toThrow("rls denied")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/supabase/profile-data.test.ts`
Expected: FAIL — `Cannot find module './profile-data'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/supabase/profile-data.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<{ fullName: string; phone: string }> {
  const { data, error } = await supabase.from("profiles").select("full_name, phone").eq("id", userId).single()
  if (error) throw error
  return { fullName: data.full_name ?? "", phone: data.phone ?? "" }
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<{ fullName: string; phone: string }>
): Promise<void> {
  const payload: Record<string, string> = {}
  if (updates.fullName !== undefined) payload.full_name = updates.fullName
  if (updates.phone !== undefined) payload.phone = updates.phone
  const { error } = await supabase.from("profiles").update(payload).eq("id", userId)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/supabase/profile-data.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/profile-data.ts lib/supabase/profile-data.test.ts
git commit -m "Add profile-data query layer for real name/phone persistence"
```

---

### Task 2: Add the save-error translation key

**Files:**
- Modify: `messages/en.json` (Profile namespace, currently lines 95-116)
- Modify: `messages/vi.json` (Profile namespace, currently lines 95-116)

**Interfaces:**
- Consumes: nothing new
- Produces: `Profile.saveError` — consumed by Task 3's `profile-view.tsx` changes.

- [ ] **Step 1: Add the key to `messages/en.json`**

In the `"Profile"` object, add a new key right after `"cancel": "Cancel",`:

```json
    "save": "Save",
    "cancel": "Cancel",
    "saveError": "Couldn't save — please try again.",
```

- [ ] **Step 2: Add the matching key to `messages/vi.json`**

In the `"Profile"` object, add right after `"cancel": "Hủy",`:

```json
    "save": "Lưu",
    "cancel": "Hủy",
    "saveError": "Không thể lưu — vui lòng thử lại.",
```

- [ ] **Step 3: Verify both files are still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add Profile.saveError translation key"
```

---

### Task 3: Wire `profile-view.tsx` to real data

**Files:**
- Modify: `components/customer/profile-view.tsx`

**Interfaces:**
- Consumes: `getProfile`, `updateProfile` from `@/lib/supabase/profile-data` (Task 1); `Profile.saveError` translation key (Task 2).
- Produces: nothing new for other tasks — this is the leaf UI change.

- [ ] **Step 1: Replace the mock-profile state with real fetched state and an error slot**

Replace this block (current lines 28-34, the `type Field`/`INITIAL_PROFILE` declarations plus the component's state near the top):

```ts
type Field = "name" | "phone" | "email"

const INITIAL_PROFILE: Record<Field, string> = {
  name: "Nguyễn Văn An",
  phone: "+84 901 234 567",
  email: "an.nguyen@email.com",
}
```

with:

```ts
type Field = "name" | "phone"

const EMPTY_PROFILE: Record<Field, string> = { name: "", phone: "" }
```

Then, inside `ProfileView`, replace:

```ts
  const [profile, setProfile] = useState(INITIAL_PROFILE)
  const [editingField, setEditingField] = useState<Field | null>(null)
  const [draft, setDraft] = useState("")
  const [pointsBalance, setPointsBalance] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      getLoyaltyBalance(supabase, user.id).then(setPointsBalance)
    })
  }, [])
```

with:

```ts
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [email, setEmail] = useState("")
  const [userId, setUserId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<Field | null>(null)
  const [draft, setDraft] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pointsBalance, setPointsBalance] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      setEmail(user.email ?? "")
      getLoyaltyBalance(supabase, user.id).then(setPointsBalance)
      getProfile(supabase, user.id).then((p) => setProfile({ name: p.fullName, phone: p.phone }))
    })
  }, [])
```

Add the import (next to the existing `getLoyaltyBalance` import):

```ts
import { getProfile, updateProfile } from "@/lib/supabase/profile-data"
```

- [ ] **Step 2: Make `saveEdit` async and write through to Supabase**

Replace:

```ts
  function startEdit(field: Field) {
    setEditingField(field)
    setDraft(profile[field])
  }

  function saveEdit() {
    if (!editingField) return
    const trimmed = draft.trim()
    if (trimmed) setProfile((prev) => ({ ...prev, [editingField]: trimmed }))
    setEditingField(null)
  }

  function cancelEdit() {
    setEditingField(null)
  }
```

with:

```ts
  function startEdit(field: Field) {
    setEditingField(field)
    setDraft(profile[field])
    setSaveError(null)
  }

  async function saveEdit() {
    if (!editingField || !userId) return
    const trimmed = draft.trim()
    if (!trimmed) {
      setEditingField(null)
      return
    }
    const supabase = createClient()
    const key = editingField === "name" ? "fullName" : "phone"
    try {
      await updateProfile(supabase, userId, { [key]: trimmed })
      setProfile((prev) => ({ ...prev, [editingField]: trimmed }))
      setEditingField(null)
      setSaveError(null)
    } catch {
      setSaveError(t("saveError"))
    }
  }

  function cancelEdit() {
    setEditingField(null)
    setSaveError(null)
  }
```

- [ ] **Step 3: Render the fields loop over `["name", "phone"]` only, show the error, and make email a read-only row**

Replace:

```tsx
      <section className="mb-6 space-y-3">
        {(["name", "phone", "email"] as Field[]).map((field) => {
```

with:

```tsx
      <section className="mb-6 space-y-3">
        {saveError && <p className="px-1 text-sm text-destructive">{saveError}</p>}
        {(["name", "phone"] as Field[]).map((field) => {
```

Then, immediately after that `.map(...)` block's closing `})}` (still inside the same `<section>`), add a static, non-editable email row:

```tsx
        <div>
          <label className="mb-1 block px-1 text-xs font-medium text-muted-foreground">{t("email")}</label>
          <div className="flex h-11 w-full items-center rounded-xl bg-muted px-4">
            <span className="text-card-foreground">{email}</span>
          </div>
        </div>
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (including Task 1's new `profile-data.test.ts`).

- [ ] **Step 5: Production build**

Run: `npx next build`
Expected: builds clean, no new warnings beyond the pre-existing "middleware deprecated" one.

- [ ] **Step 6: Commit**

```bash
git add components/customer/profile-view.tsx
git commit -m "Wire Profile's name/phone to real persisted data, email read-only"
```

---

### Task 4: Live verification and daily.md update

**Files:**
- Modify: `daily.md`

**Interfaces:**
- Consumes: the deployed result of Tasks 1-3 (this task runs after `git push` to `main`, which auto-deploys to Vercel).

- [ ] **Step 1: Push and wait for the Vercel deploy**

```bash
git push
```

Wait ~60-90s for the `main` branch's auto-deploy to finish (this project's Vercel project auto-deploys on push, no manual `vercel deploy` step).

- [ ] **Step 2: Live-verify on `https://phadincafe.vercel.app`**

Using a real logged-in test account (see `test-accounts.md`, credentials pulled from `.env.local` — never hardcode a password into a script file):
1. Go to `/profile`. Confirm the name/phone shown match the real `profiles` row (not the old mock "Nguyễn Văn An" / "+84 901 234 567").
2. Confirm the email row shows the real logged-in email and has no pencil icon / is not clickable into edit mode.
3. Edit the name field to a new value, save, reload the page — confirm the new value persisted (fetched fresh from Supabase, not just local state).
4. Repeat for phone.
5. Confirm `profiles.full_name`/`profiles.phone` actually changed in Supabase (via `mcp__supabase__execute_sql` — a plain read-only `select full_name, phone from profiles where id = '<test user id>'`).

- [ ] **Step 3: Update `daily.md`**

Add a new dated entry at the top of `daily.md` (matching this file's existing convention of newest-first session summaries) describing: what was broken (mock profile data), the fix (real `profiles.full_name`/`phone` persistence via a new `profile-data.ts` module, email intentionally left read-only because it's the Auth login credential and this project's email sender has a documented rate-limit problem), and the live verification steps confirmed above.

- [ ] **Step 4: Commit and push**

```bash
git add daily.md
git commit -m "Docs: log real profile persistence feature"
git push
```
