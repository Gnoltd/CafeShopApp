"use client"

import { useState } from "react"
import { Coffee, Menu as MenuIcon, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link, useRouter } from "@/i18n/navigation"
import { createClient } from "@/lib/supabase/client"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"

const NAV_LINKS = [
  { key: "navMenu", href: "/menu" },
  { key: "navOrders", href: "/orders" },
  { key: "navLoyalty", href: "/loyalty" },
  { key: "navProfile", href: "/profile" },
] as const

export function LandingNav({ userName = null }: { userName?: string | null }) {
  const t = useTranslations("Landing")
  const router = useRouter()
  const signUpClearance = useHeaderActionsClearance()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <nav className="absolute top-0 left-0 right-0 z-[60] flex items-center justify-between p-4 sm:p-5">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-black/55 to-transparent sm:h-28"
        aria-hidden
      />
      <span className="flex shrink-0 items-center gap-2">
        <Coffee className="h-[26px] w-[26px] text-white" aria-hidden />
        <span className="font-playfair text-2xl italic text-white">PhaDinCafe</span>
      </span>
      {/* Centered within the flex-1 middle track (not absolute left-1/2 true-
          viewport centering) so it never overlaps the logo or the right-side
          greeting/logout block when their widths are asymmetric — which is
          exactly what happens at tablet widths once a signed-in user's name
          plus the reserved header-actions-stack clearance eat into the
          available space. */}
      <div className="hidden flex-1 items-center justify-center px-2 md:flex">
        <div className="flex items-center gap-1 rounded-full border border-white/30 bg-white/20 px-2 py-2 backdrop-blur-md">
          {NAV_LINKS.map(({ key, href }) => (
            <Link
              key={key}
              href={href}
              className="whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              {t(key)}
            </Link>
          ))}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-3 md:flex" style={{ marginRight: signUpClearance }}>
        {userName ? (
          <>
            <span className="max-w-[160px] truncate text-sm font-medium text-white/90">
              {t("navGreeting", { name: userName })}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/40 px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              {t("navLogout")}
            </button>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-full border border-white/40 px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              {t("navLogin")}
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100"
            >
              {t("navSignUp")}
            </Link>
          </>
        )}
      </div>

      <div className="relative md:hidden">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-label={t("navMenuLabel")}
          aria-expanded={isMobileMenuOpen}
          className="nb-border-sm flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md"
        >
          {isMobileMenuOpen ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
        {isMobileMenuOpen && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 cursor-default"
            />
            <div className="absolute right-0 top-12 flex w-48 flex-col gap-1 rounded-2xl bg-white p-2 shadow-lg">
              {userName ? (
                <>
                  <p className="truncate px-4 pt-1 pb-2 text-sm font-semibold text-gray-900">
                    {t("navGreeting", { name: userName })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                      handleLogout()
                    }}
                    className="rounded-xl px-4 py-2 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100"
                  >
                    {t("navLogout")}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                  >
                    {t("navLogin")}
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                  >
                    {t("navSignUp")}
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  )
}
