"use client"

import { useTranslations } from "next-intl"
import { Home, UtensilsCrossed, ReceiptText, User } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { AnimatedTabBar, type TabItem } from "@/components/motion/animated-tab-bar"

const NAV_ITEMS = [
  { href: "/", labelKey: "home", icon: Home } as const,
  { href: "/menu", labelKey: "menu", icon: UtensilsCrossed } as const,
  { href: "/orders", labelKey: "orders", icon: ReceiptText } as const,
  { href: "/profile", labelKey: "profile", icon: User } as const,
]

/** Focused, single-task pages hide the tab bar rather than compete with their own primary action. */
function isFocusedPage(pathname: string): boolean {
  return (
    pathname === "/checkout" ||
    (pathname.startsWith("/orders/") && pathname !== "/orders") ||
    (pathname.startsWith("/menu/") && pathname !== "/menu")
  )
}

export function BottomNav() {
  const t = useTranslations("Nav")
  const pathname = usePathname()

  if (isFocusedPage(pathname)) return null

  const items: TabItem[] = NAV_ITEMS.map(({ href, labelKey, icon }) => ({
    href,
    label: t(labelKey),
    icon,
  }))

  return (
    <AnimatedTabBar
      items={items}
      activeHref={pathname}
      className="md:hidden"
      renderLink={(item, _isActive, content) => (
        <Link key={item.href} href={item.href}>
          {content}
        </Link>
      )}
    />
  )
}
