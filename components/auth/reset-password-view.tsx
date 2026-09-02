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
            autoComplete="new-password"
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="nb-border h-12 w-full rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block px-1 text-xs font-medium text-muted-foreground">
            {t("confirmPasswordLabel")}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="nb-border h-12 w-full rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
          />
        </div>
        <Button
          variant="neubrutal"
          onClick={handleSetNewPassword}
          disabled={isSaving}
          className="h-12 w-full text-base"
        >
          {t("setNewPasswordButton")}
        </Button>
      </div>
    </div>
  )
}
