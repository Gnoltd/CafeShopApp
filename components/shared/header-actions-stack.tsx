"use client"

import { usePathname } from "@/i18n/navigation"
import { RoleBadge } from "@/components/shared/role-badge"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { LanguageSwitcher } from "@/components/shared/language-switcher"

export function HeaderActionsStack({ role }: { role: string | null }) {
  // The live KDS renders the same controls in its framed station header so
  // they remain part of the operator's scan path instead of floating over
  // the board. Other staff routes keep the shared stack.
  const isKitchenDisplay = usePathname() === "/staff/orders"
  if (isKitchenDisplay) return null

  return (
    <div id="header-actions-stack" className="fixed top-3 right-4 z-50 flex items-center gap-2">
      <RoleBadge role={role} />
      <ThemeToggle />
      <LanguageSwitcher />
    </div>
  )
}
