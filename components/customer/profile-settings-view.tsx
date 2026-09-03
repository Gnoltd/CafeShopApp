"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import type { UserIdentity } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useLatestRefetch, type LoadContext } from "@/hooks/useLatestRefetch"

export function ProfileSettingsView() {
  const t = useTranslations("Profile")
  const locale = useLocale()
  const searchParams = useSearchParams()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  const [identities, setIdentities] = useState<UserIdentity[]>([])
  const [identitiesError, setIdentitiesError] = useState<string | null>(() =>
    searchParams.get("error_description") || searchParams.get("error") ? t("connectGoogleError") : null
  )
  const [isLoadingIdentities, setIsLoadingIdentities] = useState(true)

  const loadIdentities = useCallback(async ({ isStale }: LoadContext) => {
    const supabase = createClient()
    const { data, error } = await supabase.auth.getUserIdentities()
    if (isStale()) return
    if (!error && data) setIdentities(data.identities)
    setIsLoadingIdentities(false)
  }, [])
  const { run: runIdentityLoad } = useLatestRefetch(loadIdentities, 0)

  useEffect(() => {
    void runIdentityLoad()
  }, [runIdentityLoad])

  async function handlePasswordUpdate() {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (!currentPassword) {
      setPasswordError(t("currentPasswordRequiredError"))
      return
    }
    if (newPassword.length < 6) {
      setPasswordError(t("passwordTooShortError"))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatchError"))
      return
    }
    setIsSavingPassword(true)
    const supabase = createClient()
    // Requires current_password because this project's Supabase Auth
    // settings have "Require current password when changing password"
    // enabled -- without it, updateUser() is rejected server-side
    // regardless of the caller having a valid session.
    const { error } = await supabase.auth.updateUser({ current_password: currentPassword, password: newPassword })
    setIsSavingPassword(false)
    if (error) {
      if (error.code === "invalid_credentials") {
        setPasswordError(t("currentPasswordIncorrectError"))
      } else if (error.code === "reauthentication_needed") {
        setPasswordError(t("reauthenticationNeededError"))
      } else {
        setPasswordError(t("passwordUpdateError"))
      }
      return
    }
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setPasswordSuccess(true)
  }

  async function handleConnectGoogle() {
    const supabase = createClient()
    await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/profile/settings` },
    })
  }

  async function handleUnlinkGoogle(identity: UserIdentity) {
    setIdentitiesError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.unlinkIdentity(identity)
    if (error) {
      setIdentitiesError(t("unlinkError"))
      return
    }
    void runIdentityLoad()
  }

  const googleIdentity = identities.find((i) => i.provider === "google")

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 md:max-w-5xl md:px-8 md:py-4">
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-8">
        <section className="nb-border nb-shadow-sm rounded-2xl bg-chip p-4">
          <h2 className="mb-4 text-lg font-semibold text-card-foreground">{t("changePasswordTitle")}</h2>
          {passwordError && (
            <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="mb-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{t("passwordUpdateSuccess")}</p>
          )}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block px-1 text-xs font-medium text-muted-foreground">
                {t("currentPasswordLabel")}
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-xs font-medium text-muted-foreground">{t("newPasswordLabel")}</label>
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
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
                className="nb-border-sm h-11 w-full rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
              />
            </div>
            <Button variant="neubrutal" onClick={handlePasswordUpdate} disabled={isSavingPassword} className="h-11 w-full">
              {t("updatePasswordButton")}
            </Button>
          </div>
        </section>

        <section className="nb-border nb-shadow-sm rounded-2xl bg-chip p-4">
          <h2 className="mb-4 text-lg font-semibold text-card-foreground">{t("connectedAccountsTitle")}</h2>
          {identitiesError && (
            <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{identitiesError}</p>
          )}
          {!isLoadingIdentities && (
            <div className="nb-border-sm flex items-center justify-between rounded-xl bg-card p-3">
              <span className="font-medium text-card-foreground">Google</span>
              {googleIdentity ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-primary">{t("connectedLabel")}</span>
                  <Button
                    variant="neubrutal"
                    size="sm"
                    className="bg-card text-foreground"
                    disabled={identities.length <= 1}
                    onClick={() => handleUnlinkGoogle(googleIdentity)}
                  >
                    {t("unlinkButton")}
                  </Button>
                </div>
              ) : (
                <Button variant="neubrutal" size="sm" onClick={handleConnectGoogle}>
                  {t("connectGoogleButton")}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
