"use client"

import { AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  Coffee,
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  Table2,
  Users,
  Calculator,
  Settings,
  ShoppingCart,
  CookingPot,
  Wallet,
  Ticket,
} from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { SideDrawer } from "@/components/motion/side-drawer"
import { DialogTitle } from "@/components/ui/dialog"

const NAV_ITEMS = [
  { href: "/admin/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/admin/menu", labelKey: "menu", icon: UtensilsCrossed },
  { href: "/admin/inventory", labelKey: "inventory", icon: Package },
  { href: "/admin/tables", labelKey: "tables", icon: Table2 },
  { href: "/admin/staff", labelKey: "staff", icon: Users },
  { href: "/admin/food-cost", labelKey: "foodCost", icon: Calculator },
  { href: "/admin/shift", labelKey: "shift", icon: Wallet },
  { href: "/admin/promotions", labelKey: "promotions", icon: Ticket },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const

const FULFILLMENT_NAV_ITEMS = [
  { href: "/staff/pos", labelKey: "pos", icon: ShoppingCart },
  { href: "/staff/orders", labelKey: "kitchenDisplay", icon: CookingPot },
] as const

function AdminNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()

  return (
    <>
      <Link href="/" className="mb-6 flex items-center gap-2 px-4" onClick={onNavigate}>
        <div className="nb-border-sm flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Coffee className="h-5 w-5" />
        </div>
        <span className="font-extrabold text-primary">{tBrand("name")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "nb-border-sm flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-extrabold",
                isActive
                  ? "border-ink bg-primary text-primary-foreground"
                  : "border-transparent text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
      <nav className="space-y-1 border-t px-2 pt-3">
        {FULFILLMENT_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "nb-border-sm flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-extrabold",
                isActive
                  ? "border-ink bg-primary text-primary-foreground"
                  : "border-transparent text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tNav(labelKey)}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tDialog = useTranslations("Dialog")

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-card py-4 md:flex">
        <AdminNavContent />
      </aside>
      <AnimatePresence>
        {open && (
          <SideDrawer key="admin-side-drawer" onClose={onClose}>
            {/* The drawer is a modal dialog and needs an accessible name;
                the visible chrome is the nav list itself, so the title is
                screen-reader only rather than drawn. */}
            <DialogTitle className="sr-only">{tDialog("navigation")}</DialogTitle>
            <div className="flex h-full flex-col overflow-y-auto py-4">
              <AdminNavContent onNavigate={onClose} />
            </div>
          </SideDrawer>
        )}
      </AnimatePresence>
    </>
  )
}
