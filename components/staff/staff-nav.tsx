"use client"

import { useTranslations } from "next-intl"
import { Coffee } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"

const NAV_ITEMS = [
  { href: "/staff/orders", labelKey: "kitchenDisplay" },
  { href: "/staff/tables", labelKey: "tables" },
] as const

export function StaffNav() {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()
  const clearance = useHeaderActionsClearance()

  return (
    <header
      className="flex min-h-14 shrink-0 flex-col items-start gap-5 border-b bg-card px-4 pt-14 pb-2 md:flex-row md:items-center md:gap-6 md:py-0 md:pt-0 md:pr-[var(--header-clearance)]"
      style={{ "--header-clearance": `${clearance}px` } as React.CSSProperties}
    >
      <Link href="/" className="flex items-center gap-2 font-semibold text-primary">
        <Coffee className="h-5 w-5" />
        {tBrand("name")}
      </Link>
      <nav
        className="nb-border-sm nb-shadow-sm flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg bg-card p-1 [mask-image:linear-gradient(to_left,transparent,black_24px)] md:w-auto md:[mask-image:none]"
      >
        {NAV_ITEMS.map(({ href, labelKey }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-extrabold",
              pathname === href
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            )}
          >
            {tNav(labelKey)}
          </Link>
        ))}
      </nav>
    </header>
  )
}
