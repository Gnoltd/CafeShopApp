"use client"

import { useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GoogleIcon } from "@/components/auth/google-icon"
import { createClient } from "@/lib/supabase/client"
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

export function SignupForm() {
  const t = useTranslations("Auth")
  const locale = useLocale()
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmEmailSent, setConfirmEmailSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, phone },
      },
    })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (!data.session) {
      // Project requires email confirmation — no session until the user clicks the link.
      setConfirmEmailSent(true)
      return
    }

    await supabase.from("profiles").update({ full_name: name, phone }).eq("id", data.user!.id)
    router.push(ROLE_HOME.customer)
  }

  async function handleGoogleSignIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/callback` },
    })
  }

  if (confirmEmailSent) {
    return (
      <AuthLayoutWrapper>
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-card-foreground">{t("checkEmailTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("checkEmailBody")}</p>
          <Link href="/login" className="mt-6 inline-block font-bold text-primary hover:underline">
            {t("login")}
          </Link>
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
            <h1 className="text-xl font-bold text-card-foreground">{t("signup")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("signupWelcome")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="signup-name" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("fullNameLabel")}
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("fullNamePlaceholder")}
                className="h-12 rounded-xl pl-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-email" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("emailLabel")}
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="h-12 rounded-xl pl-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-phone" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("phoneLabel")}
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("phonePlaceholder")}
                className="h-12 rounded-xl pl-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-password" className="block px-1 text-xs font-medium text-muted-foreground">
              {t("passwordLabel")}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-xl pl-10 pr-11"
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
          </div>

          <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            {t("termsText")}
          </p>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t("signupError")}: {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full gap-2 rounded-xl text-base font-bold"
          >
            {loading ? t("creatingAccount") : t("createAccount")}
            <ArrowRight className="h-4 w-4" />
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
          {t("haveAccount")}{" "}
          {/* Inline text link — see the matching note in login-form.tsx. */}
          <Link href="/login" className="inline-block px-1 py-3 font-bold text-primary hover:underline">
            {t("login")}
          </Link>
        </p>
      </div>
    </AuthLayoutWrapper>
  )
}
