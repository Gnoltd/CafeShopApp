"use client"

import { useState } from "react"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminMobileHeader } from "@/components/admin/admin-mobile-header"
import { InventoryProvider } from "@/hooks/useInventory"
import { ShiftProvider } from "@/hooks/useShift"

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  return (
    <InventoryProvider>
      <ShiftProvider>
        <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
          <AdminMobileHeader onOpenMenu={() => setIsDrawerOpen(true)} />
          <AdminSidebar open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
          <main className="flex-1 overflow-y-auto bg-muted/30 p-6 md:pt-16">{children}</main>
        </div>
      </ShiftProvider>
    </InventoryProvider>
  )
}
