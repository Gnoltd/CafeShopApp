"use client"

import { useTranslations } from "next-intl"
import { Menu } from "lucide-react"
import { usePathname } from "@/i18n/navigation"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"
import { ADMIN_NAV_ITEMS } from "@/components/admin/admin-nav-items"

export function AdminMobileHeader({ onOpenMenu, role }: { onOpenMenu: () => void; role: string | null }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const tRole = useTranslations("RoleNav")
  const clearance = useHeaderActionsClearance()
  const pathname = usePathname()

  const pageTitleKey = ADMIN_NAV_ITEMS.find((item) => item.href === pathname)?.labelKey
  const roleLabel = role === "staff" ? tRole("badgeStaff") : tRole("badgeAdmin")

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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold leading-tight text-card-foreground">
          {pageTitleKey ? tNav(pageTitleKey) : tBrand("name")}
        </p>
        <p className="truncate text-[10px] font-semibold leading-tight text-muted-foreground">
          {tBrand("name")} · {roleLabel}
        </p>
      </div>
    </header>
  )
}
