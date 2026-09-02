"use client"

import { useLocale } from "next-intl"
import { useParams } from "next/navigation"
import { usePathname, useRouter } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"
import { cn } from "@/lib/utils"

const LABELS: Record<string, string> = {
  vi: "VI",
  en: "EN",
}

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()

  function switchTo(nextLocale: string) {
    router.replace(
      // @ts-expect-error -- pathname/params are dynamic across all routes
      { pathname, params },
      { locale: nextLocale }
    )
  }

  return (
    <div className="nb-border-sm inline-flex rounded-full bg-card p-0.5">
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          aria-pressed={locale === code}
          className={cn(
            "min-h-11 min-w-11 rounded-full px-3 text-xs font-bold transition-colors",
            locale === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {LABELS[code] ?? code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
