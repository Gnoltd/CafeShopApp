"use client"

import { useState } from "react"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminMobileHeader } from "@/components/admin/admin-mobile-header"

// Shared shell for /admin/menu, /admin/staff, and /admin/settings.
export function AdminLayoutClient({ children, role }: { children: React.ReactNode; role: string | null }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <AdminMobileHeader onOpenMenu={() => setIsDrawerOpen(true)} role={role} />
      <AdminSidebar open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} role={role} />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-6 md:pt-16">{children}</main>
    </div>
  )
}
