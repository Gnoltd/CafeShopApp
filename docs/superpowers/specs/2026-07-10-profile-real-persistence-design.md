# Profile: real persistence for name/phone, read-only real email

## Problem

`components/customer/profile-view.tsx`'s inline-editable name/phone/email
fields are local-state only, seeded from a hardcoded `INITIAL_PROFILE`
constant — edits never reach Supabase and reset on reload. This is a
known, documented gap (CLAUDE.md's Landing/Auth/Profile section). User
asked for these to show and persist real data.

## Schema (existing, no migration needed)

`public.profiles` already has `full_name text` and `phone text`
columns, both nullable/updatable, already written at signup
(`components/auth/signup-form.tsx`) and already read elsewhere
(e.g. `getOrderHistoryDetail`'s `customerName`). RLS policy
`profiles_update_own` (migration `0001`) already lets a logged-in user
update their own row (`id = auth.uid()`) — no RPC needed, no new
migration needed.

There is **no `profiles.email` column** — the only email that exists
is Supabase Auth's own `auth.users.email`, i.e. the account's login
credential, not a separate contact field.

## Decision: email is read-only

Editing email through `supabase.auth.updateUser({ email })` would
trigger Supabase's email-confirmation flow on both the old and new
address — and this project's shared hosted email sender already has a
documented, frequently-failing rate limit (CLAUDE.md: "Signup email
confirmation frequently fails"). Given that, and that email here is a
login credential rather than a contact field, Profile displays the
real Auth email but does not offer editing it. Name/phone remain fully
editable and real.

## Data layer

New `lib/supabase/profile-data.ts`, DI'd like every other query module
in this project (`SupabaseClient` as first arg):

```ts
export async function getProfile(supabase: SupabaseClient, userId: string): Promise<{ fullName: string; phone: string }>
export async function updateProfile(supabase: SupabaseClient, userId: string, updates: Partial<{ fullName: string; phone: string }>): Promise<void>
```

`getProfile` selects `full_name, phone` from `profiles` and maps to
camelCase (matching this project's existing row-mapping convention,
e.g. `orders-data.ts`). `updateProfile` does a plain
`.from("profiles").update({...}).eq("id", userId)` — no RPC, since RLS
already authorizes this and there's no cross-table atomicity
requirement (unlike `place_order` or `adjust_ingredient_stock`).

## UI changes (`profile-view.tsx`)

- On mount: fetch the real Auth user, then `getProfile()` for
  name/phone and `user.email` for the email row. Replaces
  `INITIAL_PROFILE`.
- Name/phone keep the exact existing inline edit flow (pencil → input
  → check/✕). `saveEdit` becomes async, calling `updateProfile()`
  inside a try/catch. On success, update local state as today. On
  failure, keep the field in edit mode and show an inline error
  message below it — same pattern `tables-management.tsx`'s
  `saveEditing` already uses for admin table renames (a local `error`
  state string, cleared on next attempt).
- Email row: keeps its value (now the real Auth email) but drops the
  pencil icon / `PressFeedback` wrapper — becomes a plain
  non-interactive display row, consistent with how this project
  already marks other not-yet-editable rows (though this one isn't a
  future gap, it's a deliberate permanent read-only field, so no
  "disabled + tooltip" — that convention is reserved for genuinely
  unbacked actions).

## Out of scope

Avatar upload, Addresses, Settings rows — already correctly
`disabled` + tooltip'd for missing backends; untouched by this change.
Member ID display (`#PDC-8829`) — untouched, not part of this ask.

## Testing

Unit tests for `lib/supabase/profile-data.ts` (mocked `SupabaseClient`,
matching this project's existing query-layer test pattern, e.g.
`orders-data.test.ts`). No component-level test added, consistent with
this project's current gap (documented in `daily.md`'s Known gaps —
component tests were never added project-wide, not a new regression
introduced here). Live-verified manually against
`https://phadincafe.vercel.app` after deploy: edit name, reload,
confirm it persisted; same for phone; confirm email shows the real
logged-in address with no edit affordance; confirm an RLS/network
failure surfaces the inline error instead of failing silently.
