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

  // top-1 on mobile / top-3 from md up: the stack's own rendered height
  // (52px, from RoleBadge/LanguageSwitcher's nb-border-sm border + padding)
  // needs to end at-or-before the header's bottom border. Mobile headers
  // are h-14 (56px content): top-1 (4px) + 52 = 56, flush. Desktop headers
  // are h-16 (64px content): top-3 (12px) + 52 = 64, flush — top-3 alone
  // only matched that desktop math and overflowed ~7px past the mobile
  // header's border, visible as the stack spilling below the header frame
  // on phone widths.
  return (
    <div id="header-actions-stack" className="fixed top-1 right-4 z-50 flex items-center gap-2 md:top-3">
      <RoleBadge role={role} />
      <ThemeToggle />
      <LanguageSwitcher />
    </div>
  )
}
