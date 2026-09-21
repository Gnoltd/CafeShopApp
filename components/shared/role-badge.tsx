"use client"

import { LogIn, Briefcase, UtensilsCrossed } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ROLE_HOME } from "@/lib/roles"
import { useActiveTableOptional } from "@/hooks/useTables"

export function RoleBadge({ role }: { role: string | null }) {
  const t = useTranslations("RoleNav")
  const activeTable = useActiveTableOptional()

  const { label, href, Icon } =
    role === "staff"
      ? { label: t("badgeStaff"), href: ROLE_HOME.staff, Icon: Briefcase }
      : role === "manager" || role === "admin"
        ? { label: t("badgeAdmin"), href: ROLE_HOME[role], Icon: Briefcase }
        : activeTable?.qrToken
          ? { label: t("badgeTable", { number: activeTable.number }), href: `/table/${activeTable.qrToken}`, Icon: UtensilsCrossed }
          : { label: t("badgeGuest"), href: "/login", Icon: LogIn }

  return (
    <Link
      href={href}
      className="nb-border-sm flex min-h-11 items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-medium text-secondary transition-colors hover:bg-muted"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  )
}
