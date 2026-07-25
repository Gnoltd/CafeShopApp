"use client"

import { motion } from "framer-motion"
import { Coffee, ChevronLeft, UtensilsCrossed, ShoppingBasket, ReceiptText, Star, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link, usePathname, useRouter } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { useCart } from "@/hooks/useCart"
import { useHeaderActionsClearance } from "@/hooks/useHeaderActionsClearance"

const DESKTOP_NAV = [
  { href: "/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/cart", labelKey: "cart", icon: ShoppingBasket },
  { href: "/orders", labelKey: "orders", icon: ReceiptText },
  { href: "/loyalty", labelKey: "loyalty", icon: Star },
  { href: "/profile", labelKey: "profile", icon: User },
] as const

export function CustomerHeader({ showBack = false }: { showBack?: boolean }) {
  const t = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const tCustomer = useTranslations("Customer")
  const router = useRouter()
  const pathname = usePathname()
  const { itemCount } = useCart()
  // #header-actions-stack (RoleBadge + ThemeToggle + LanguageSwitcher) is
  // fixed top-right and can be wider than a static guess, especially at
  // tablet widths — measure it so nav items never end up hidden behind it.
  const actionsClearance = useHeaderActionsClearance()

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-sm">
      <div
        className="mx-auto flex h-14 max-w-7xl items-center gap-2 pl-4 md:h-16"
        style={{ paddingRight: actionsClearance }}
      >
        {/* Back button — mobile only when showBack */}
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            className="mr-1 shrink-0 md:hidden"
            aria-label={tCustomer("back")}
          >
            <ChevronLeft className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

        {/* Logo */}
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Coffee className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate font-semibold text-primary">{t("name")}</span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Desktop navigation — hidden on mobile */}
        <nav className="hidden items-center gap-1 md:flex">
          {DESKTOP_NAV.map((item) => {
            const isActive =
              item.href === pathname ||
              (item.href !== "/menu" && pathname.startsWith(item.href))
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-card-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tNav(item.labelKey)}</span>
                {/* Cart badge */}
                {item.labelKey === "cart" && itemCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {itemCount}
                  </span>
                )}
                {/* Active indicator underline */}
                {isActive && (
                  <motion.span
                    layoutId="header-nav-active"
                    className="absolute inset-x-1 -bottom-[9px] h-0.5 rounded-full bg-primary md:-bottom-[9px]"
                    transition={{ type: "spring", stiffness: 300, damping: 22 }}
                  />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
