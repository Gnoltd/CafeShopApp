"use client"

// Route-level error boundary for /admin/*. Must be a Client Component.
import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("RouteBoundary")

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-bold text-card-foreground">{t("errorTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("errorMessage")}</p>
      <Button variant="neubrutal" size="sm" onClick={reset}>
        {t("retryButton")}
      </Button>
      <Button variant="ghost" size="sm" render={<Link href="/admin/dashboard" />} nativeButton={false}>
        {t("homeButton")}
      </Button>
    </div>
  )
}
