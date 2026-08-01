# Design: Real Profile Settings — change password, connect Google

Date: 2026-07-11

## Context

Profile's "Settings" row is currently a disabled+tooltip placeholder
(`components/customer/profile-view.tsx:283-296`, `title="Not implemented
yet — no customer settings page"`), same pattern as "Addresses". No
password-change or identity-linking code exists anywhere in this
codebase. The user wants it real: change password, and connect/disconnect
Google to an existing account (the only OAuth provider this app has
configured, per the just-shipped Google sign-in feature).

## Prerequisite (user-side, Dashboard only)

Supabase's manual identity linking (`linkIdentity()`) is **off by
default** and must be enabled in the Supabase Dashboard (Authentication
→ configuration) before this feature can work at all — no MCP tool
exposes this setting, same category of gap as the Google OAuth provider
config and the Auth URL Configuration already documented in CLAUDE.md.
This is a manual step for the user to complete before/alongside this
being built, not something the implementation plan can do.

## Route

New `app/[locale]/(customer)/profile/settings/page.tsx` +
`components/customer/profile-settings-view.tsx` (parallel naming to the
existing `profile-view.tsx`). `components/customer/profile-view.tsx`'s
Settings row switches from the disabled `<button>` to a real `<Link
href="/profile/settings">`, matching the existing chevron-right
navigation pattern already used for Order History/Loyalty.

**Guest-guard gap found and included**: `lib/middleware-rules.ts`'s
`AUTH_REQUIRED_EXACT_PATHS` is `["/profile", "/orders", "/loyalty"]` —
an **exact**-match array, so `/profile/settings` would not inherit
`/profile`'s existing guest gate (unlike `/orders/[id]`, which is
deliberately left open for guest order tracking, there's no legitimate
guest use case for a settings page). Add `"/profile/settings"` to that
same array — a one-line, server-enforced fix consistent with the
existing pattern, rather than a new client-side redirect.

## Change password

A small form: new password + confirm password (both `type="password"`,
`minLength={6}` — matching Signup's own password field convention). On
submit: client-side check that both match and meet the length minimum,
then `supabase.auth.updateUser({ password: newPassword })`. Per your
answer, no "current password" field — the user already has an
authenticated session, so this isn't a security gap, just fewer clicks
(and matches this app's existing lightweight auth UX — Signup's password
field has no extra confirmation flow either). Success clears the fields
and shows a brief inline confirmation; failure shows the Supabase error
message inline, matching every other auth form's existing error-display
pattern in this codebase.

This same call is also the officially documented way (per Supabase's own
docs) to add password-based login to an account that only ever signed up
via Google — nothing extra needed for that direction.

## Connected accounts (Google)

On mount, calls `supabase.auth.getUserIdentities()`. Shows two rows:

- **Email** — always shown as the base identity, read-only (no
  connect/disconnect control on this row; scoped to exactly what was
  asked for — Google — not a fully generic multi-provider manager).
- **Google** — if an identity with `provider === "google"` exists, shows
  a "Connected" badge and an "Unlink" button; otherwise shows a "Connect
  Google" button.

**Connect**: `supabase.auth.linkIdentity({ provider: "google", options:
{ redirectTo: \`${window.location.origin}/${locale}/profile/settings\` }
})`. This is simpler than the sign-in flow built for Google sign-in — the
user is already authenticated for the entire round trip (Google →
Supabase → back), so there's no role-resolution step needed; the
`redirectTo` points straight back at this same settings page, which
re-fetches identities on load and will show Google as newly connected.
If Supabase redirects back with an `error`/`error_description` query
param (e.g. that Google account is already linked to a different user,
or manual linking isn't enabled yet), it's read from the URL on mount
and shown as an inline error, matching the existing query-param-error
pattern already used in `order-tracking.tsx` for payment failures.

**Unlink**: `supabase.auth.unlinkIdentity(googleIdentity)`, then
re-fetches identities. The button is only rendered enabled when
`identities.length > 1` — this is Supabase's own documented requirement
("the user needs to be logged in and have at least 2 linked identities
in order to unlink"), not custom logic invented here. This is what
actually prevents anyone from locking themselves out: you can only ever
unlink down to your last remaining identity, never past it, enforced by
Supabase server-side and mirrored client-side so the button never
promises something the server would reject.

## Out of scope

- No other OAuth providers (only Google is configured today).
- No "forgot password" / reset-via-email flow (separate, pre-existing
  known gap — `login-form.tsx`'s "Forgot password?" is already its own
  disabled+tooltip placeholder, untouched here).
- No re-authentication/MFA step before sensitive changes — matches this
  app's existing lightweight auth conventions throughout.
- No changes to how `getCurrentRole`/`ROLE_HOME` work — a settings
  change never affects role or redirect destination.

## Testing

No new query-layer function is introduced (this is direct
`supabase.auth.*` calls from a client component, same pattern as the
Login/Signup forms — no `lib/supabase/*.ts` module wraps raw Supabase
Auth SDK calls elsewhere in this codebase either), so no new Vitest
coverage. Verified live on `https://phadincafe.vercel.app`, per this
project's convention: change password and confirm the new password
actually logs in (and the old one no longer does); connect Google from
an email/password account and confirm it appears as "Connected" and
that account can subsequently log in via either method; unlink Google
and confirm the button is disabled again once back down to one identity;
attempt to visit `/profile/settings` while logged out and confirm the
middleware redirect to `/login` fires.
