# Design: Wire up Google OAuth sign-in

Date: 2026-07-11

## Context

"Continue with Google" exists on both `components/auth/login-form.tsx`
(lines 137-145) and `components/auth/signup-form.tsx` (lines 189-197) but
is hardcoded `disabled` with a static tooltip ("Not implemented yet —
Google OAuth not wired up"). There is no `supabase.auth.signInWithOAuth`
call anywhere in the codebase — this is genuinely unimplemented, not just
hidden. The user has now configured a Google Cloud OAuth client and
enabled the Google provider in the Supabase Dashboard (Client ID/Secret
set, redirect URI `https://qhiypdqnrnzndxdwqxbx.supabase.co/auth/v1/callback`
registered in Google Cloud Console), so the app side can be wired up.

## The button (both forms)

Remove the `disabled` prop and static `title` from both buttons. Add an
`onClick`:

```ts
async function handleGoogleSignIn() {
  const supabase = createClient()
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/${locale}/auth/callback` },
  })
}
```

`locale` comes from `useLocale()` (next-intl) — neither form currently
imports it; both need it added. `window.location.origin` is used instead
of the existing-but-unwired `NEXT_PUBLIC_SITE_URL` env var (present in
`.env.local.example` but referenced nowhere in actual source) — it's
always correct for whatever environment the user is actually on
(localhost, a Vercel preview deployment, or production) with zero risk of
drifting out of sync, which this project's own cross-cutting gotchas
document as a repeated real problem for other env vars (Stripe/VNPay
secrets needing separate Vercel/Supabase configuration). Login and
Signup's buttons are identical — Google doesn't distinguish "signing up"
from "logging in"; a first-time Google sign-in auto-creates the profile
via the existing `handle_new_user` trigger on `auth.users`, exactly like
any other new account.

This redirects the whole page to Google's consent screen; there is
nothing further to handle here (the page navigates away).

## New callback route

`app/[locale]/(auth)/callback/page.tsx` (new file, alongside the existing
`login`/`signup` pages in the same route group — keeps the URL
locale-prefixed and consistent, e.g. `/vi/auth/callback`) renders a new
`components/auth/oauth-callback.tsx` client component.

After Google authenticates the user, it redirects to Supabase's own
callback, which then redirects to our `redirectTo` URL with the session
established via the Supabase JS client's automatic URL-based session
detection. The component:

1. Subscribes to `supabase.auth.onAuthStateChange((event, session) => ...)`.
2. The first time a non-null `session` appears, calls the **existing**
   `getCurrentRole(supabase)` helper (`lib/get-current-role.ts`) — it
   already does exactly the `auth.getUser()` + `profiles` `role`/
   `is_active` resolution needed here, previously only ever called from
   server components for the "Go to [X]" shortcut, but it takes a plain
   `SupabaseClient` and has no server-only dependency, so it's directly
   reusable from a client component.
3. Redirects via `ROLE_HOME[role ?? "customer"] ?? "/menu"` — identical
   destination logic to `login-form.tsx`'s existing password-login path.
4. If no session appears within 6 seconds (cancelled/denied consent, or
   any other OAuth failure), shows a short error message with a link
   back to `/login` instead of hanging indefinitely or silently
   redirecting with no explanation — matching this app's existing
   convention of never leaving a silent dead end (e.g. RLS-denial error
   surfacing elsewhere in the codebase).

While waiting, the page shows a simple centered loading message (new
`Auth.oauthRedirecting` key). The timeout error uses a new
`Auth.oauthCallbackError` key plus the existing `Auth.login` label for
the link back.

## Included cleanup: de-duplicate role resolution in `login-form.tsx`

`login-form.tsx` (lines 39-47) currently inlines the same `profiles`
`role`/`is_active` lookup that `getCurrentRole` already encapsulates —
duplicated logic this project's own cross-cutting gotchas explicitly
warn about ("Any code reading `profiles.role` directly... risks ignoring
`is_active`"). Since this file is already being touched for the Google
button, replace the inline block with a call to `getCurrentRole(supabase)`
so there's one source of truth instead of two (soon three, if the new
callback page invented its own copy instead of reusing it).

## Out of scope

- No changes to `middleware.ts`/`lib/middleware-rules.ts` — an
  authenticated Google user hitting a gated route is already handled by
  the existing role-resolution-per-request logic there.
- No "link an existing email/password account to Google" flow — a Google
  sign-in with an email that already has a password account is Supabase
  Auth's own default behavior (out of scope to change here).
- No changes to the Google Cloud Console / Supabase Dashboard
  configuration — already done by the user.

## Testing

No new query-layer function is introduced (`getCurrentRole` already
exists and is reused as-is, with its own existing coverage in
`lib/get-current-role.test.ts`), so this change needs no new Vitest
tests — just confirm the full suite still passes unchanged. This ships
verified live on `https://phadincafe.vercel.app`, per this
project's convention — real OAuth flows can't be meaningfully unit
tested: click "Continue with Google" on both Login and Signup, complete
the Google consent screen with a real Google account, confirm redirect
to the correct `ROLE_HOME` destination for that account's role, and
confirm a new Google account (never seen before) lands on `/menu` as a
customer. Also verify the timeout/error path by deliberately cancelling
the Google consent screen partway through.
