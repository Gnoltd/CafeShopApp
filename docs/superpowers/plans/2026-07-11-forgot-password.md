# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up Login's "Forgot password?" (currently a static disabled tooltip) into a real password-reset-via-email flow.

**Architecture:** `login-form.tsx` gains a 3-state view swap (`login | requestReset | resetSent`), mirroring Signup's existing `confirmEmailSent` swap pattern, calling `supabase.auth.resetPasswordForEmail`. A new `/reset-password` page combines two patterns already built and verified this session: waiting on `onAuthStateChange` for a session (like the Google OAuth callback page) and a new-password form (like Settings' change-password), then redirects via the existing `getCurrentRole`/`ROLE_HOME`.

**Tech Stack:** Next.js App Router client components, `@supabase/ssr` browser client, next-intl.

## Global Constraints

- **Known, accepted risk**: `resetPasswordForEmail` uses the same shared, rate-limited email sender that already causes signup confirmation emails to frequently fail — ships anyway per explicit decision, not blocking on fixing email delivery.
- New strings in **both** `messages/en.json` and `messages/vi.json`, in the `Auth` namespace — kept separate from `Profile`'s near-identical password-field keys (namespaced per feature area, matching existing convention), even where the English text is similar.
- `/reset-password` resolves to a bare URL (no `/auth/` prefix) since `(auth)` is a route group — the exact lesson already learned fixing Google OAuth's callback 404 earlier this session.
- No new Supabase Dashboard config needed — existing wildcard redirect URLs already cover this path.
- Verify against `https://phadincafe.vercel.app`, not just `next build`.

---

### Task 1: i18n keys

**Files:**
- Modify: `messages/en.json`, `messages/vi.json` (`Auth` namespace)

**Interfaces:**
- Produces: `Auth.{resetPasswordTitle, resetPasswordBody, sendResetLinkButton, sendingResetLink, backToLogin, resetEmailSentBody, verifyingResetLink, newPasswordLabel, confirmPasswordLabel, passwordMismatchError, passwordTooShortError, setNewPasswordButton, passwordResetSuccess, resetLinkExpiredError, passwordUpdateError}`. Tasks 2 and 3 consume these.

- [ ] **Step 1: Add the new keys to `messages/en.json`**

Change:

```json
    "checkEmailTitle": "Check your email",
    "checkEmailBody": "We've sent a confirmation link to your email address. Click it to activate your account, then come back and log in."
  },
```

to:

```json
    "checkEmailTitle": "Check your email",
    "checkEmailBody": "We've sent a confirmation link to your email address. Click it to activate your account, then come back and log in.",
    "resetPasswordTitle": "Reset Password",
    "resetPasswordBody": "Enter your email and we'll send you a link to reset your password.",
    "sendResetLinkButton": "Send Reset Link",
    "sendingResetLink": "Sending…",
    "backToLogin": "Back to Login",
    "resetEmailSentBody": "We've sent a password reset link to your email address. Click it to set a new password.",
    "verifyingResetLink": "Verifying reset link…",
    "newPasswordLabel": "New Password",
    "confirmPasswordLabel": "Confirm Password",
    "passwordMismatchError": "Passwords don't match.",
    "passwordTooShortError": "Password must be at least 6 characters.",
    "setNewPasswordButton": "Set New Password",
    "passwordResetSuccess": "Password reset! Redirecting…",
    "resetLinkExpiredError": "This reset link is invalid or has expired.",
    "passwordUpdateError": "Couldn't update password — please try again."
  },
```

- [ ] **Step 2: Add the new keys to `messages/vi.json`**

Change:

```json
    "checkEmailTitle": "Kiểm tra email của bạn",
    "checkEmailBody": "Chúng tôi đã gửi một liên kết xác nhận đến email của bạn. Nhấp vào đó để kích hoạt tài khoản, sau đó quay lại đăng nhập."
  },
```

to:

```json
    "checkEmailTitle": "Kiểm tra email của bạn",
    "checkEmailBody": "Chúng tôi đã gửi một liên kết xác nhận đến email của bạn. Nhấp vào đó để kích hoạt tài khoản, sau đó quay lại đăng nhập.",
    "resetPasswordTitle": "Đặt Lại Mật Khẩu",
    "resetPasswordBody": "Nhập email của bạn, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.",
    "sendResetLinkButton": "Gửi Liên Kết Đặt Lại",
    "sendingResetLink": "Đang gửi…",
    "backToLogin": "Quay Lại Đăng Nhập",
    "resetEmailSentBody": "Chúng tôi đã gửi liên kết đặt lại mật khẩu đến email của bạn. Nhấp vào đó để đặt mật khẩu mới.",
    "verifyingResetLink": "Đang xác minh liên kết…",
    "newPasswordLabel": "Mật Khẩu Mới",
    "confirmPasswordLabel": "Xác Nhận Mật Khẩu",
    "passwordMismatchError": "Mật khẩu không khớp.",
    "passwordTooShortError": "Mật khẩu phải có ít nhất 6 ký tự.",
    "setNewPasswordButton": "Đặt Mật Khẩu Mới",
    "passwordResetSuccess": "Đã đặt lại mật khẩu! Đang chuyển hướng…",
    "resetLinkExpiredError": "Liên kết đặt lại này không hợp lệ hoặc đã hết hạn.",
    "passwordUpdateError": "Không thể cập nhật mật khẩu — vui lòng thử lại."
  },
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add forgot-password translation keys"
```

---

### Task 2: Request reset — `login-form.tsx`

**Files:**
- Modify: `components/auth/login-form.tsx`

**Interfaces:**
- Consumes: i18n keys from Task 1.
- Produces: no new exports — internal view-state addition.

- [ ] **Step 1: Add view state and reset-request state**

Change:

```tsx
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
```

to:

```tsx
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"login" | "requestReset" | "resetSent">("login")
  const [resetEmail, setResetEmail] = useState("")
  const [resetError, setResetError] = useState<string | null>(null)
  const [isSendingReset, setIsSendingReset] = useState(false)
```

- [ ] **Step 2: Add `handleSendResetLink`**

Change:

```tsx
  async function handleGoogleSignIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/callback` },
    })
  }

  return (
```

to:

```tsx
  async function handleGoogleSignIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/callback` },
    })
  }

  async function handleSendResetLink() {
    setResetError(null)
    setIsSendingReset(true)
    const supabase = createClient()
    const { error: resetSendError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    })
    setIsSendingReset(false)
    if (resetSendError) {
      setResetError(resetSendError.message)
      return
    }
    setView("resetSent")
  }

  if (view === "resetSent") {
    return (
      <div className="mx-auto w-full max-w-sm px-4 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
          <Mail className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-card-foreground">{t("checkEmailTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("resetEmailSentBody")}</p>
        <button
          type="button"
          onClick={() => setView("login")}
          className="mt-6 inline-block font-bold text-primary hover:underline"
        >
          {t("login")}
        </button>
      </div>
    )
  }

  if (view === "requestReset") {
    return (
      <div className="mx-auto w-full max-w-sm px-4">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-card-foreground">{t("resetPasswordTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("resetPasswordBody")}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("emailLabel")}
            </label>
            <div className="relative">
              <Input
                id="reset-email"
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="h-12 rounded-xl pr-10"
              />
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {resetError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{resetError}</p>
          )}

          <Button
            type="button"
            onClick={handleSendResetLink}
            disabled={isSendingReset}
            className="h-12 w-full rounded-xl text-base font-bold"
          >
            {isSendingReset ? t("sendingResetLink") : t("sendResetLinkButton")}
          </Button>

          <button
            type="button"
            onClick={() => setView("login")}
            className="w-full text-center text-sm font-bold text-primary hover:underline"
          >
            {t("backToLogin")}
          </button>
        </div>
      </div>
    )
  }

  return (
```

- [ ] **Step 3: Wire the "Forgot password?" trigger**

Change:

```tsx
          <div className="flex justify-end">
            <span
              className="cursor-not-allowed text-xs text-muted-foreground opacity-60"
              title="Not implemented yet — no password-reset flow wired up"
            >
              {t("forgotPassword")}
            </span>
          </div>
```

to:

```tsx
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setView("requestReset")}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("forgotPassword")}
            </button>
          </div>
```

- [ ] **Step 4: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/auth/login-form.tsx
git commit -m "Wire Login's Forgot Password into a real reset-email request flow"
```

---

### Task 3: `/reset-password` route + `ResetPasswordView`

**Files:**
- Create: `components/auth/reset-password-view.tsx`
- Create: `app/[locale]/(auth)/reset-password/page.tsx`

**Interfaces:**
- Consumes: i18n keys from Task 1; `getCurrentRole` (`lib/get-current-role.ts`, existing); `ROLE_HOME` (`lib/roles.ts`, existing).
- Produces: route `/​<locale>​/reset-password`. Task 2's `redirectTo` in `handleSendResetLink` points here.

- [ ] **Step 1: Write the component**

Create `components/auth/reset-password-view.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Link, useRouter } from "@/i18n/navigation"
import { createClient } from "@/lib/supabase/client"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"
import { Button } from "@/components/ui/button"

const TIMEOUT_MS = 6000

export function ResetPasswordView() {
  const t = useTranslations("Auth")
  const router = useRouter()

  const [hasSession, setHasSession] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let resolved = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        resolved = true
        setHasSession(true)
      }
    })

    const timeout = setTimeout(() => {
      if (!resolved) setTimedOut(true)
    }, TIMEOUT_MS)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSetNewPassword() {
    setError(null)
    if (newPassword.length < 6) {
      setError(t("passwordTooShortError"))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatchError"))
      return
    }
    setIsSaving(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) {
      setIsSaving(false)
      setError(t("passwordUpdateError"))
      return
    }
    setSuccess(true)
    const role = await getCurrentRole(supabase)
    router.push(ROLE_HOME[role ?? "customer"] ?? "/menu")
  }

  if (timedOut) {
    return (
      <div className="mx-auto flex min-h-[50vh] w-full max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-destructive">{t("resetLinkExpiredError")}</p>
        <Link href="/login" className="font-bold text-primary hover:underline">
          {t("login")}
        </Link>
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("verifyingResetLink")}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-8">
      <h1 className="mb-6 text-center text-xl font-bold text-card-foreground">{t("resetPasswordTitle")}</h1>
      {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {success && (
        <p className="mb-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{t("passwordResetSuccess")}</p>
      )}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block px-1 text-xs font-medium text-muted-foreground">{t("newPasswordLabel")}</label>
          <input
            type="password"
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-4 text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block px-1 text-xs font-medium text-muted-foreground">
            {t("confirmPasswordLabel")}
          </label>
          <input
            type="password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-4 text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <Button
          onClick={handleSetNewPassword}
          disabled={isSaving}
          className="h-12 w-full rounded-xl text-base font-bold"
        >
          {t("setNewPasswordButton")}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

Create `app/[locale]/(auth)/reset-password/page.tsx` (no sr-only `<h1>` wrapper — matches this route group's existing `callback/page.tsx`, which renders its component directly; `ResetPasswordView` itself owns the page's real `<h1>`, matching Login/Signup's own convention):

```tsx
import { ResetPasswordView } from "@/components/auth/reset-password-view"

export default function ResetPasswordPage() {
  return <ResetPasswordView />
}
```

- [ ] **Step 3: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, and the route list includes `/[locale]/reset-password`.

- [ ] **Step 4: Commit**

```bash
git add components/auth/reset-password-view.tsx "app/[locale]/(auth)/reset-password/page.tsx"
git commit -m "Add /reset-password page: verify recovery link, set new password"
```

---

### Task 4: Full verification, deploy, live-verify

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all pass, unchanged count (no new query-layer code, no new tests).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Live-verify on `https://phadincafe.vercel.app`**

1. On `/login`, click "Forgot password?" — confirm the form swaps to the email-entry screen (not a static tooltip anymore).
2. Enter an email, submit — confirm it swaps to the "check your email" screen regardless of whether the address is registered (Supabase's anti-enumeration behavior).
3. Click "Back to Login" from the email-entry screen — confirm it returns to the normal login form (local state reset, no page reload).
4. Click the "Log In" link on the "check your email" screen — confirm it also returns to the normal login form.
5. If a real reset email arrives for a real test account: click the link, confirm it lands on `/reset-password`, briefly shows "Verifying reset link…", then shows the new-password form. Submit a new password, confirm the success message appears and it redirects to the correct `ROLE_HOME` destination. Log out and confirm login works with the new password (mirroring the exact before/after check already used to verify Settings' change-password).
6. Visit `/reset-password` directly with no valid recovery session (e.g. a fresh incognito context) — confirm the "invalid or expired" error shows after ~6 seconds, not an infinite spinner.

- [ ] **Step 5: `daily.md` — leave as-is unless verification caught a real bug**

Per this project's current convention (`daily.md` trimmed to open work only), don't add a shipped-feature narrative entry unless something is left unresolved. If step 4.5 couldn't be completed due to the known email-delivery risk, add a brief Open item noting the code path is shipped but the real-email round trip is unconfirmed — mirroring how Google sign-in's and Profile Settings' equivalent unverified-round-trip items were phrased earlier this session.
