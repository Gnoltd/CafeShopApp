"use client"

import { useState } from "react"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminMobileHeader } from "@/components/admin/admin-mobile-header"

// Inventory/Shift/Tables data is only needed by specific admin pages
// (Dashboard, Inventory, Tables, Shift) -- each mounts its own provider(s)
// via a route-level layout.tsx instead of every admin page (menu,
// food-cost, promotions, staff, settings included) paying for fetches and
// Realtime subscriptions it never uses. See daily.md Task 4.
export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <AdminMobileHeader onOpenMenu={() => setIsDrawerOpen(true)} />
      <AdminSidebar open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-6 md:pt-16">{children}</main>
    </div>
  )
}
