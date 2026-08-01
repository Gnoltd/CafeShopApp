# Design: Real "Forgot password?" — reset via email

Date: 2026-07-11

## Context

Login's "Forgot password?" is currently a plain `<span>` (not even a real
disabled control), styled unclickable with a `title` tooltip
(`components/auth/login-form.tsx:107-114`, `title="Not implemented yet —
no password-reset flow wired up"`). No reset-password page, i18n keys,
or Auth redirect config exist anywhere in the codebase.

**Known, accepted risk**: this hosted project's shared Supabase email
sender already has a documented, real reliability problem — signup
confirmation emails frequently fail to send (very low rate limit, no
MCP tool to configure SMTP; see CLAUDE.md). `resetPasswordForEmail`
sends through the exact same sender, so it carries the identical risk.
Per your decision, this ships anyway — the code path is correct
regardless of whether any specific email actually arrives, matching
this project's existing precedent of shipping signup despite the same
gap rather than blocking on fixing email delivery first.

## Request reset (`login-form.tsx`)

"Forgot password?" becomes a real clickable trigger. Clicking it swaps
the form's content to a small view: an email field + "Send Reset Link"
button + a "Back to Login" link back to the normal form. Submitting
calls:

```ts
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/${locale}/reset-password`,
})
```

Supabase deliberately never reveals whether the email address is
registered (anti-enumeration) — so regardless of the actual outcome,
submitting swaps the form again to a "check your email" screen, reusing
Signup's existing `confirmEmailSent` visual pattern exactly (icon
circle, title, body text, link back to `/login`) with new copy for this
context. Three view states total in this one component
(`"login" | "requestReset" | "resetSent"`), matching Signup's existing
single-boolean-swap style but with one extra state.

## Reset page (`/reset-password`)

New `app/[locale]/(auth)/reset-password/page.tsx` +
`components/auth/reset-password-view.tsx`, alongside the existing
`login`/`signup`/`callback` pages in the same route group — resolves to
the bare URL `/<locale>/reset-password` (route groups don't add a URL
segment, the exact lesson already learned and fixed for Google OAuth's
callback route earlier this session).

This combines two patterns already built and verified this session,
rather than inventing a third:

1. **Like the OAuth callback page**: on mount, subscribes to
   `supabase.auth.onAuthStateChange` and waits for a session — the
   emailed recovery link establishes one automatically when the page
   loads, the same mechanism Google sign-in's callback already relies
   on. If no session appears within the same timeout window, shows an
   "invalid or expired link" error instead of hanging.
2. **Like Settings' change-password form**: once a session exists,
   shows New Password + Confirm Password (same 6-character-minimum,
   must-match validation) and calls
   `supabase.auth.updateUser({ password: newPassword })`.

On success, resolves the now-authenticated user's role via the existing
`getCurrentRole` helper and redirects to `ROLE_HOME[role]` — identical
destination logic to every other post-auth redirect in this codebase
(password login, Google sign-in's callback).

## i18n

New keys in the `Auth` namespace (both `messages/en.json` and
`messages/vi.json`): `resetPasswordTitle`, `resetPasswordBody`,
`sendResetLinkButton`, `sendingResetLink`, `backToLogin`,
`resetEmailSentBody`, `newPasswordLabel`, `confirmPasswordLabel`,
`passwordMismatchError`, `passwordTooShortError`, `setNewPasswordButton`,
`passwordResetSuccess`, `resetLinkExpiredError`. Reuses existing `Auth`
keys where the copy is already exactly right: `forgotPassword` (the
trigger text itself), `checkEmailTitle` (identical "Check your email"
heading Signup already uses), `login` (Signup's existing "back to login"
link text/pattern). New password-field keys are added to `Auth` rather
than reused from `Profile`'s near-identical ones from the just-shipped
Settings feature — kept namespaced per feature area, matching this
project's existing per-section i18n convention, even though the English
copy ends up textually similar.

## Out of scope

- No new Supabase Auth URL Configuration changes — the existing
  wildcard redirect URLs (`https://phadincafe.vercel.app/**`, preview
  wildcard, `http://localhost:3000/**`) already cover `/reset-password`
  without any Dashboard change needed.
- No rate-limiting or resend-cooldown UI on the request-reset form
  beyond whatever Supabase itself enforces server-side.
- No change to Signup's own `confirmEmailSent` screen or copy.

## Testing

No new query-layer function (direct `supabase.auth.*` calls from client
components, same pattern as every other auth form in this codebase) —
no new Vitest coverage needed. Verified live on
`https://phadincafe.vercel.app`: request a reset for the test customer
account, confirm the "check your email" screen appears regardless of
delivery outcome; if the email arrives, click it and confirm it lands on
`/reset-password` with a working new-password form, submit, and confirm
login works with the new password afterward (mirroring the exact
before/after check already used to verify Settings' change-password);
visit `/reset-password` directly with no valid recovery session and
confirm the expired-link error shows instead of a hang.
