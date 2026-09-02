"use client"

import { Moon, Sun } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "@/hooks/useTheme"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const t = useTranslations("Theme")
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={t("toggleLabel")}
      className="nb-border-sm nb-press-sm size-11 rounded-full border-transparent bg-card"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
