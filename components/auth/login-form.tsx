"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Coffee, Mail, Eye, EyeOff } from "lucide-react"
import { useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { getCurrentRole } from "@/lib/get-current-role"
import { ROLE_HOME } from "@/lib/roles"

function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
  const tBrand = useTranslations("Brand")
  const t = useTranslations("Auth")
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
              {t("artworkBody")}
            </p>
          </div>
          <div className="text-xs opacity-60">
            &copy; {new Date().getFullYear()} {tBrand("name")}. {t("artworkRights")}
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
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
      </div>
    </AuthLayoutWrapper>
  )
}
