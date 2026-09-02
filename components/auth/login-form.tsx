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

function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
  const tBrand = useTranslations("Brand")
  return (
    <div className="mx-auto w-full max-w-sm px-4 md:max-w-4xl md:px-0">
      <div className="flex overflow-hidden md:rounded-2xl md:border-2 md:border-ink md:bg-card md:shadow-[4px_4px_0_var(--ink)]">
        {/* Left Column: Brand decorative artwork (desktop only) */}
        <div className="hidden md:flex flex-1 flex-col justify-between bg-gradient-to-br from-primary to-secondary p-8 text-primary-foreground min-h-[500px]">
          <div className="flex items-center gap-2">
            <Coffee className="h-6 w-6" />
            <span className="text-lg font-bold">{tBrand("name")}</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-extrabold tracking-tight leading-tight">
              {tBrand("tagline")}
            </h2>
            <p className="text-sm opacity-80">
              Join us to track orders in real-time, collect loyalty points, and redeem delicious drinks.
            </p>
          </div>
          <div className="text-xs opacity-60">
            &copy; {new Date().getFullYear()} {tBrand("name")}. All rights reserved.
          </div>
        </div>

        {/* Right Column: Active Form content */}
        <div className="flex-1 flex flex-col justify-center px-4 py-8 md:px-12 md:py-12 md:max-w-md w-full">
          {children}
        </div>
      </div>
    </div>
  )
}

export function LoginForm() {
  const t = useTranslations("Auth")
  const locale = useLocale()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"login" | "requestReset" | "resetSent">("login")
  const [resetEmail, setResetEmail] = useState("")
  const [resetError, setResetError] = useState<string | null>(null)
  const [isSendingReset, setIsSendingReset] = useState(false)

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
      <AuthLayoutWrapper>
        <div className="text-center">
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
      </AuthLayoutWrapper>
    )
  }

  if (view === "requestReset") {
    return (
      <AuthLayoutWrapper>
        <div>
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
                  autoComplete="email"
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
      </AuthLayoutWrapper>
    )
  }

  return (
    <AuthLayoutWrapper>
      <div>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
            <Coffee className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-card-foreground">{t("login")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("welcomeBack")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("emailLabel")}
            </label>
            <div className="relative">
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="h-12 rounded-xl pr-10"
              />
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("passwordLabel")}
            </label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="h-12 rounded-xl pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-r-xl text-muted-foreground hover:text-primary"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setView("requestReset")}
                className="flex min-h-11 items-center px-1 text-xs font-medium text-primary hover:underline"
              >
                {t("forgotPassword")}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t("loginError")}: {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl text-base font-bold"
          >
            {loading ? t("loggingIn") : t("login")}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs italic text-muted-foreground">{t("or")}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          variant="outline"
          onClick={handleGoogleSignIn}
          className="h-12 w-full gap-3 rounded-xl text-sm font-medium"
        >
          <GoogleIcon />
          {t("continueWithGoogle")}
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          {/* Inline text link — WCAG 2.5.5's 44x44 target size has a
              built-in exception for links inside a sentence/block of text,
              since forcing a full box here would break the reading flow.
              py-3 still grows the vertical hit area to 44px without
              wrapping the link onto its own line or affecting layout. */}
          <Link href="/signup" className="inline-block px-1 py-3 font-bold text-primary hover:underline">
            {t("signup")}
          </Link>
        </p>
      </div>
    </AuthLayoutWrapper>
  )
}
