"use client"

import { usePathname } from "@/i18n/navigation"
import { RoleBadge } from "@/components/shared/role-badge"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { LanguageSwitcher } from "@/components/shared/language-switcher"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Settings2 } from "lucide-react"
import { DialogRoot, DialogPortal, DialogBackdrop, DialogViewport, DialogPopup, DialogTitle, DialogClose } from "@/components/ui/dialog"

export function HeaderActionsStack({ role }: { role: string | null }) {
  const [open, setOpen] = useState(false)
  const t = useTranslations("Menu")
  const pathname = usePathname()
  // The live KDS renders the same controls in its framed station header so
  // they remain part of the operator's scan path instead of floating over
  // the board. Other staff routes keep the shared stack.
  const isKitchenDisplay = pathname === "/staff/orders"
  if (isKitchenDisplay) return null
  if (!pathname.startsWith("/staff") && !pathname.startsWith("/admin")) {
    return (
      <div id="header-actions-stack" className="fixed top-1 right-4 z-50 md:top-2">
        <button type="button" aria-label={t("preferences")} onClick={() => setOpen(true)} className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground">
          <Settings2 className="size-5" />
        </button>
        <DialogRoot open={open} onOpenChange={setOpen}>
          <DialogPortal><DialogBackdrop /><DialogViewport><DialogPopup className="p-6">
            <DialogTitle>{t("preferences")}</DialogTitle>
            <div className="mt-6 flex flex-wrap items-center gap-4"><LanguageSwitcher /><ThemeToggle /><RoleBadge role={role} /></div>
            <DialogClose className="mt-6 min-h-11 rounded-lg border border-border px-4" aria-label={t("closePreferences")}>{t("closePreferences")}</DialogClose>
          </DialogPopup></DialogViewport></DialogPortal>
        </DialogRoot>
      </div>
    )
  }

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
