"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import {
  User,
  Pencil,
  Check,
  X,
  ReceiptText,
  Star,
  MapPin,
  Languages,
  Settings,
  LogOut,
  ChevronRight,
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
} from "lucide-react"
import { Link, usePathname, useRouter } from "@/i18n/navigation"
import { formatNumber, formatOrderId } from "@/lib/format"
import { createClient } from "@/lib/supabase/client"
import { getLoyaltyBalance } from "@/lib/supabase/loyalty-data"
import { getProfile, updateProfile } from "@/lib/supabase/profile-data"
import { Button } from "@/components/ui/button"
import { canAccessAdmin } from "@/lib/roles"
import { PressFeedback } from "@/components/motion/press-feedback"

type Field = "name" | "phone"

const EMPTY_PROFILE: Record<Field, string> = { name: "", phone: "" }

const FIELD_LABEL_KEYS: Record<Field, "fullName" | "phoneNumber"> = {
  name: "fullName",
  phone: "phoneNumber",
}

const FIELD_INPUT_PROPS: Record<Field, { type: string; autoComplete: string }> = {
  name: { type: "text", autoComplete: "name" },
  phone: { type: "tel", autoComplete: "tel" },
}

export function ProfileView({ role = null }: { role?: string | null }) {
  const t = useTranslations("Profile")
  const tNav = useTranslations("Nav")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const isStaffRole = role === "staff" || role === "manager" || role === "admin"
  const quickLinks = [
    ...(isStaffRole ? [{ href: "/staff/orders", label: tNav("kitchenDisplay"), Icon: ClipboardList }] : []),
    ...(isStaffRole ? [{ href: "/staff/pos", label: tNav("pos"), Icon: ShoppingCart }] : []),
    ...(canAccessAdmin(role) ? [{ href: "/admin/dashboard", label: tNav("dashboard"), Icon: LayoutDashboard }] : []),
  ]

  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [email, setEmail] = useState("")
  const [userId, setUserId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<Field | null>(null)
  const [draft, setDraft] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pointsBalance, setPointsBalance] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      setEmail(user.email ?? "")
      getLoyaltyBalance(supabase, user.id).then(setPointsBalance)
      getProfile(supabase, user.id).then((p) => setProfile({ name: p.fullName, phone: p.phone }))
    })
  }, [])

  function startEdit(field: Field) {
    setEditingField(field)
    setDraft(profile[field])
    setSaveError(null)
  }

  async function saveEdit() {
    if (!editingField || !userId) return
    const trimmed = draft.trim()
    if (!trimmed) {
      setEditingField(null)
      return
    }
    const supabase = createClient()
    const key = editingField === "name" ? "fullName" : "phone"
    try {
      await updateProfile(supabase, userId, { [key]: trimmed })
      setProfile((prev) => ({ ...prev, [editingField]: trimmed }))
      setEditingField(null)
      setSaveError(null)
    } catch {
      setSaveError(t("saveError"))
    }
  }

  function cancelEdit() {
    setEditingField(null)
    setSaveError(null)
  }

  function toggleLocale() {
    const nextLocale = locale === "vi" ? "en" : "vi"
    router.replace(
      // @ts-expect-error -- pathname/params are dynamic across all routes
      { pathname, params },
      { locale: nextLocale }
    )
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Guest ordering stays available — send them back to the menu, not /login.
    router.push("/menu")
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 md:max-w-5xl md:px-8 md:py-4">
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
        {/* Left Column: Avatar and Info fields */}
        <div className="flex-1 min-w-0 md:flex-[2]">
          <section className="mb-6 flex flex-col items-center gap-3 md:items-start">
            <div className="relative">
              <div className="nb-border flex h-28 w-28 items-center justify-center rounded-full bg-chip">
                <User className="h-12 w-12 text-muted-foreground" />
              </div>
              <button
                type="button"
                disabled
                title="Not implemented yet — no avatar upload backend"
                className="nb-border-sm absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-70"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            <div className="text-center md:text-left">
              <h2 className="text-xl font-bold text-card-foreground">{profile.name}</h2>
              {userId && (
                <p className="text-sm text-muted-foreground">
                  {t("memberIdLabel")}: #PDC-{formatOrderId(userId)}
                </p>
              )}
            </div>
          </section>

          {role && isStaffRole && (
            <section className="nb-border nb-shadow-sm mb-6 rounded-2xl bg-chip p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="nb-border-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary">
                  <LayoutDashboard className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-bold text-card-foreground">
                    {role === "staff" ? t("staffAccessHeadlineStaff") : t("staffAccessHeadlineAdmin")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {role === "staff" ? t("staffAccessSubtextStaff") : t("staffAccessSubtextAdmin")}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {quickLinks.map(({ href, label, Icon }) => (
                  <Button
                    key={href}
                    variant="neubrutal"
                    className="h-11 w-full bg-secondary"
                    render={<Link href={href} />}
                    nativeButton={false}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section className="mb-6 space-y-3">
            {saveError && <p className="px-1 text-sm text-destructive">{saveError}</p>}
            {(["name", "phone"] as Field[]).map((field) => {
              const isEditing = editingField === field
              return (
                <div key={field}>
                  <label className="mb-1 block px-1 text-xs font-medium text-muted-foreground">
                    {t(FIELD_LABEL_KEYS[field])}
                  </label>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        type={FIELD_INPUT_PROPS[field].type}
                        autoComplete={FIELD_INPUT_PROPS[field].autoComplete}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit()
                          if (e.key === "Escape") cancelEdit()
                        }}
                        className="nb-border h-11 flex-1 rounded-xl bg-card px-4 text-card-foreground focus:outline-none"
                      />
                      <PressFeedback
                        type="button"
                        onClick={saveEdit}
                        aria-label={t("save")}
                        title={t("save")}
                        className="nb-border-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                      >
                        <Check className="h-4 w-4" />
                      </PressFeedback>
                      <PressFeedback
                        type="button"
                        onClick={cancelEdit}
                        aria-label={t("cancel")}
                        title={t("cancel")}
                        className="nb-border-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </PressFeedback>
                    </div>
                  ) : (
                    <PressFeedback
                      type="button"
                      onClick={() => startEdit(field)}
                      className="nb-border flex h-11 w-full items-center justify-between rounded-xl bg-card px-4 text-left"
                    >
                      <span className="text-card-foreground">{profile[field]}</span>
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </PressFeedback>
                  )}
                </div>
              )
            })}
            <div>
              <label className="mb-1 block px-1 text-xs font-medium text-muted-foreground">{t("email")}</label>
              <div className="nb-border-sm flex h-11 w-full items-center rounded-xl bg-chip px-4">
                <span className="text-card-foreground">{email}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Menu Options */}
        <div className="w-full md:flex-1 md:max-w-md">
          <section className="nb-border nb-shadow overflow-hidden rounded-2xl bg-card">
            <Link
              href="/orders"
              className="flex items-center justify-between border-b-2 border-ink/15 p-4"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/15 text-secondary">
                  <ReceiptText className="h-5 w-5" />
                </span>
                <span className="font-medium text-card-foreground">{t("menuOrderHistory")}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <Link
              href="/loyalty"
              className="flex items-center justify-between border-b-2 border-ink/15 p-4"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/25 text-accent-foreground">
                  <Star className="h-5 w-5" />
                </span>
                <span className="font-medium text-card-foreground">{t("menuLoyalty")}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-primary">{formatNumber(pointsBalance)} pts</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </Link>

            <Link
              href="/profile/addresses"
              className="flex items-center justify-between border-b-2 border-ink/15 p-4"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MapPin className="h-5 w-5" />
                </span>
                <span className="font-medium text-card-foreground">{t("menuAddresses")}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <button
              type="button"
              onClick={toggleLocale}
              className="flex w-full items-center justify-between border-b-2 border-ink/15 p-4 text-left"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Languages className="h-5 w-5" />
                </span>
                <span className="font-medium text-card-foreground">{t("menuLanguage")}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {locale === "vi" ? t("languageVi") : t("languageEn")}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>

            <Link
              href="/profile/settings"
              className="flex items-center justify-between border-b-2 border-ink/15 p-4"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Settings className="h-5 w-5" />
                </span>
                <span className="font-medium text-card-foreground">{t("menuSettings")}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>

            <PressFeedback
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <LogOut className="h-5 w-5" />
                </span>
                <span className="font-medium text-destructive">{t("menuLogout")}</span>
              </span>
            </PressFeedback>
          </section>
        </div>
      </div>
    </div>
  )
}
