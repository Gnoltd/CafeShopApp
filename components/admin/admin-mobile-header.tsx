"use client"

import { useTranslations } from "next-intl"
import { Coffee, Menu } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"

export function AdminMobileHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const clearance = useHeaderActionsClearance()

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-2 border-b bg-card pl-2 md:hidden"
      style={{ paddingRight: `${clearance}px` } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={tNav("openMenu")}
        className="nb-border-sm shrink-0 rounded-lg bg-card p-1.5 text-card-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/" className="flex min-w-0 items-center gap-1.5 font-bold text-primary">
        <Coffee className="h-5 w-5 shrink-0" />
        <span className="truncate">{tBrand("name")}</span>
      </Link>
    </header>
  )
}
