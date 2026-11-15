"use client"

import { AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"
import { Coffee, type LucideIcon } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { SideDrawer } from "@/components/motion/side-drawer"
import { DialogTitle } from "@/components/ui/dialog"
import { getAdminNavItems, getAdminExternalNavItems } from "@/components/admin/admin-nav-items"

function AdminNavLink({
  href,
  label,
  icon: Icon,
  isActive,
  onNavigate,
}: {
  href: string
  label: string
  icon: LucideIcon
  isActive: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "nb-border-sm flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-extrabold",
        isActive ? "border-ink bg-primary text-primary-foreground" : "border-transparent text-muted-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  )
}

function AdminNavContent({ onNavigate, role }: { onNavigate?: () => void; role: string | null }) {
  const tBrand = useTranslations("Brand")
  const tNav = useTranslations("Nav")
  const pathname = usePathname()
  const navItems = getAdminNavItems(role)
  const externalNavItems = getAdminExternalNavItems(role)

  return (
    <>
      <Link href="/" className="mb-6 flex items-center gap-2 px-4" onClick={onNavigate}>
        <div className="nb-border-sm flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Coffee className="h-5 w-5" />
        </div>
        <span className="font-extrabold text-primary">{tBrand("name")}</span>
      </Link>
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map(({ href, labelKey, icon }) => (
          <AdminNavLink
            key={href}
            href={href}
            label={tNav(labelKey)}
            icon={icon}
            isActive={pathname === href}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      {externalNavItems.length > 0 && (
        <nav className="space-y-1 border-t px-2 pt-3">
          {externalNavItems.map(({ href, labelKey, icon }) => (
            <AdminNavLink
              key={href}
              href={href}
              label={tNav(labelKey)}
              icon={icon}
              isActive={pathname === href}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      )}
    </>
  )
}

export function AdminSidebar({
  open,
  onClose,
  role,
}: {
  open: boolean
  onClose: () => void
  role: string | null
}) {
  const tDialog = useTranslations("Dialog")

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-card py-4 md:flex">
        <AdminNavContent role={role} />
      </aside>
      <AnimatePresence>
        {open && (
          <SideDrawer key="admin-side-drawer" onClose={onClose}>
            {/* The drawer is a modal dialog and needs an accessible name;
                the visible chrome is the nav list itself, so the title is
                screen-reader only rather than drawn. */}
            <DialogTitle className="sr-only">{tDialog("navigation")}</DialogTitle>
            <div className="flex h-full flex-col overflow-y-auto py-4">
              <AdminNavContent onNavigate={onClose} role={role} />
            </div>
          </SideDrawer>
        )}
      </AnimatePresence>
    </>
  )
}
