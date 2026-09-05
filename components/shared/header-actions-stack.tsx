"use client"

import { useEffect, useState } from "react"
import { usePathname } from "@/i18n/navigation"
import { RoleBadge } from "@/components/shared/role-badge"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { LanguageSwitcher } from "@/components/shared/language-switcher"
import { cn } from "@/lib/utils"

// The landing page ("/") opens on a full-bleed hero (coffee-cup-hero.tsx,
// id="coffee-cup-hero") that's meant to show only the brand name, 3D cup, and
// CTAs — no admin/theme/language clutter. This stack stays hidden while that
// hero is in view and fades in once the user scrolls past it.
export function HeaderActionsStack({ role }: { role: string | null }) {
  const pathname = usePathname()
  const isLanding = pathname === "/"
  // The live KDS renders the same controls in its framed station header so
  // they remain part of the operator's scan path instead of floating over
  // the board. Other staff routes keep the shared stack.
  const isKitchenDisplay = pathname === "/staff/orders"
  const [hiddenByHero, setHiddenByHero] = useState(isLanding)

  useEffect(() => {
    if (!isLanding) return
    const hero = document.getElementById("coffee-cup-hero")
    if (!hero) return

    const observer = new IntersectionObserver(([entry]) => setHiddenByHero(entry.isIntersecting), {
      threshold: 0,
    })
    observer.observe(hero)
    return () => observer.disconnect()
  }, [isLanding])

  if (isKitchenDisplay) return null

  return (
    <div
      id="header-actions-stack"
      className={cn(
        "fixed top-2 right-2 z-50 flex items-center gap-2 transition-opacity duration-300",
        isLanding && hiddenByHero ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <RoleBadge role={role} />
      <ThemeToggle />
      <LanguageSwitcher />
    </div>
  )
}
