# Google OAuth Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the "Continue with Google" button on both Login and Signup (currently hardcoded `disabled`, `signInWithOAuth` completely unimplemented) now that the Google Cloud OAuth client and Supabase Auth provider are configured.

**Architecture:** Both buttons call `supabase.auth.signInWithOAuth({ provider: "google" })` with a `redirectTo` pointing at a new `/​<locale>​/auth/callback` page. That page waits for the session via `onAuthStateChange`, resolves the role through the existing `getCurrentRole` helper (reused, not reinvented), and redirects to `ROLE_HOME[role]` — the same destination logic `login-form.tsx` already uses for password login.

**Tech Stack:** Next.js App Router client components, `@supabase/ssr` browser client, next-intl.

## Global Constraints

- `redirectTo` uses `window.location.origin` (not the unused `NEXT_PUBLIC_SITE_URL` env var) so it's always correct for whatever environment is actually running (localhost, preview, or production).
- New strings in **both** `messages/en.json` and `messages/vi.json`, in the `Auth` namespace.
- No new Vitest coverage needed — `getCurrentRole` already has its own tests in `lib/get-current-role.test.ts`, reused as-is.
- Verify against `https://phadincafe.vercel.app` with a real Google account, not just `next build`.

---

### Task 1: i18n keys

**Files:**
- Modify: `messages/en.json`, `messages/vi.json` (`Auth` namespace)

**Interfaces:**
- Produces: `Auth.oauthRedirecting`, `Auth.oauthCallbackError`. Task 2's callback component calls both via `useTranslations("Auth")`.

- [ ] **Step 1: Add keys to `messages/en.json`**

Change:

```json
    "continueWithGoogle": "Continue with Google",
    "or": "or",
```

to:

```json
    "continueWithGoogle": "Continue with Google",
    "oauthRedirecting": "Signing you in…",
    "oauthCallbackError": "Something went wrong signing in with Google.",
    "or": "or",
```

- [ ] **Step 2: Add keys to `messages/vi.json`**

Change:

```json
    "continueWithGoogle": "Tiếp Tục Với Google",
    "or": "hoặc",
```

to:

```json
    "continueWithGoogle": "Tiếp Tục Với Google",
    "oauthRedirecting": "Đang đăng nhập…",
    "oauthCallbackError": "Có lỗi xảy ra khi đăng nhập bằng Google.",
    "or": "hoặc",
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add oauthRedirecting/oauthCallbackError translation keys"
```

---

### Task 2: Callback route + component

**Files:**
- Create: `components/auth/oauth-callback.tsx`
- Create: `app/[locale]/(auth)/callback/page.tsx`

**Interfaces:**
- Consumes: `Auth.oauthRedirecting`/`Auth.oauthCallbackError` (Task 1); `getCurrentRole` (`lib/get-current-role.ts`, existing); `ROLE_HOME` (`lib/roles.ts`, existing).
- Produces: route `/​<locale>​/auth/callback`. Tasks 3 and 4's `redirectTo` values point here.

- [ ] **Step 1: Write the callback component**

Create `components/auth/oauth-callback.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Link, useRouter } from "@/i18n/navigation"
import { createClient } from "@/lib/supabase/client"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"

const TIMEOUT_MS = 6000

export function OAuthCallback() {
  const t = useTranslations("Auth")
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let resolved = false

    async function resolveAndRedirect() {
      if (resolved) return
      resolved = true
      const role = await getCurrentRole(supabase)
      router.push(ROLE_HOME[role ?? "customer"] ?? "/menu")
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) resolveAndRedirect()
    })

    const timeout = setTimeout(() => {
      if (!resolved) setTimedOut(true)
    }, TIMEOUT_MS)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router])

  if (timedOut) {
    return (
      <div className="mx-auto flex min-h-[50vh] w-full max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-destructive">{t("oauthCallbackError")}</p>
        <Link href="/login" className="font-bold text-primary hover:underline">
          {t("login")}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm text-muted-foreground">{t("oauthRedirecting")}</p>
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

Create `app/[locale]/(auth)/callback/page.tsx`:

```tsx
import { OAuthCallback } from "@/components/auth/oauth-callback"

export default function AuthCallbackPage() {
  return <OAuthCallback />
}
```

- [ ] **Step 3: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, and the route list includes `/[locale]/auth/callback` (nested under the `(auth)` route group, so the URL has no `(auth)` segment).

- [ ] **Step 4: Commit**

```bash
git add components/auth/oauth-callback.tsx "app/[locale]/(auth)/callback/page.tsx"
git commit -m "Add Google OAuth callback route"
```

---

### Task 3: Wire `login-form.tsx`

**Files:**
- Modify: `components/auth/login-form.tsx`

**Interfaces:**
- Consumes: callback route (Task 2).
- Produces: no new exports — internal wiring + a de-duplication cleanup.

- [ ] **Step 1: Add `useLocale` and `getCurrentRole` imports**

Change:

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Coffee, Mail, Eye, EyeOff } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GoogleIcon } from "@/components/auth/google-icon"
import { createClient } from "@/lib/supabase/client"
import { ROLE_HOME } from "@/lib/roles"
```

to:

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, Mail, Eye, EyeOff } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GoogleIcon } from "@/components/auth/google-icon"
import { createClient } from "@/lib/supabase/client"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"
```

- [ ] **Step 2: Add `locale`, de-duplicate role resolution, add `handleGoogleSignIn`**

Change:

```tsx
export function LoginForm() {
  const t = useTranslations("Auth")
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    let role: string | null = null
    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", data.user.id)
        .single()
      role = profile ? (profile.is_active ? profile.role : "customer") : null
    }

    router.push(ROLE_HOME[role ?? "customer"] ?? "/menu")
  }
```

to:

```tsx
export function LoginForm() {
  const t = useTranslations("Auth")
  const locale = useLocale()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    const role = data.user ? await getCurrentRole(supabase) : null
    router.push(ROLE_HOME[role ?? "customer"] ?? "/menu")
  }

  async function handleGoogleSignIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/auth/callback` },
    })
  }
```

- [ ] **Step 3: Enable the button**

Change:

```tsx
      <Button
        variant="outline"
        disabled
        title="Not implemented yet — Google OAuth not wired up"
        className="h-12 w-full gap-3 rounded-xl text-sm font-medium"
      >
        <GoogleIcon />
        {t("continueWithGoogle")}
      </Button>
```

to:

```tsx
      <Button
        variant="outline"
        onClick={handleGoogleSignIn}
        className="h-12 w-full gap-3 rounded-xl text-sm font-medium"
      >
        <GoogleIcon />
        {t("continueWithGoogle")}
      </Button>
```

- [ ] **Step 4: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/auth/login-form.tsx
git commit -m "Wire Google OAuth on Login, de-duplicate role resolution via getCurrentRole"
```

---

### Task 4: Wire `signup-form.tsx`

**Files:**
- Modify: `components/auth/signup-form.tsx`

**Interfaces:**
- Consumes: callback route (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Add `useLocale` import**

Change:

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Coffee, User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight } from "lucide-react"
```

to:

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight } from "lucide-react"
```

- [ ] **Step 2: Add `locale`**

Change:

```tsx
export function SignupForm() {
  const t = useTranslations("Auth")
  const router = useRouter()
  const [name, setName] = useState("")
```

to:

```tsx
export function SignupForm() {
  const t = useTranslations("Auth")
  const locale = useLocale()
  const router = useRouter()
  const [name, setName] = useState("")
```

- [ ] **Step 3: Add `handleGoogleSignIn`**

Change:

```tsx
    await supabase.from("profiles").update({ full_name: name, phone }).eq("id", data.user!.id)
    router.push(ROLE_HOME.customer)
  }

  if (confirmEmailSent) {
```

to:

```tsx
    await supabase.from("profiles").update({ full_name: name, phone }).eq("id", data.user!.id)
    router.push(ROLE_HOME.customer)
  }

  async function handleGoogleSignIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/auth/callback` },
    })
  }

  if (confirmEmailSent) {
```

- [ ] **Step 4: Enable the button**

Change:

```tsx
      <Button
        variant="outline"
        disabled
        title="Not implemented yet — Google OAuth not wired up"
        className="h-12 w-full gap-3 rounded-xl text-sm font-medium"
      >
        <GoogleIcon />
        {t("continueWithGoogle")}
      </Button>
```

to:

```tsx
      <Button
        variant="outline"
        onClick={handleGoogleSignIn}
        className="h-12 w-full gap-3 rounded-xl text-sm font-medium"
      >
        <GoogleIcon />
        {t("continueWithGoogle")}
      </Button>
```

- [ ] **Step 5: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add components/auth/signup-form.tsx
git commit -m "Wire Google OAuth on Signup"
```

---

### Task 5: Full verification, deploy, live-verify

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all pass, unchanged count (no new tests needed per the design).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Live-verify on `https://phadincafe.vercel.app`**

1. On `/login`, click "Continue with Google" — confirm it navigates to Google's real consent screen (not an error).
2. Complete sign-in with a real Google account. Confirm it lands back on the app at `/​<locale>​/auth/callback`, briefly shows the "Signing you in…" message, then redirects to the correct `ROLE_HOME` destination for that account's role (test with the admin test account's Google identity if linkable, or a fresh Google account to confirm it lands on `/menu` as a new customer).
3. On `/signup`, click "Continue with Google" — confirm identical behavior.
4. Deliberately cancel/deny the Google consent screen partway through (or close it) — confirm the callback page shows the error message + "Log In" link after ~6 seconds, not an infinite spinner.
5. Confirm a brand-new Google account (never seen by this app before) gets a real `profiles` row created (via the existing `handle_new_user` trigger) and lands on `/menu` as `customer`.

- [ ] **Step 5: `daily.md` — leave as-is unless verification caught a real bug**

Per this project's current convention (`daily.md` trimmed to open work only), don't add a shipped-feature narrative entry. Do remove the "Google sign-in" item from `daily.md`'s Open list, since it's now done — check that file's current content before editing, since it may have changed since this plan was written.
