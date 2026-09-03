"use client"

// Next.js App Router convention: catches an unhandled render/server error
// anywhere in this route group and renders this instead of the default
// (English, unstyled) Next.js error screen. Must be a Client Component.
import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"

export default function CustomerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("RouteBoundary")

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="nb-border nb-shadow flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
        <AlertTriangle className="h-10 w-10 text-destructive" />
      </div>
      <h1 className="text-xl font-bold text-card-foreground">{t("errorTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("errorMessage")}</p>
      <div className="flex w-full flex-col gap-2">
        <Button variant="neubrutal" className="h-11 w-full" onClick={reset}>
          {t("retryButton")}
        </Button>
        <Button variant="ghost" className="h-11 w-full" render={<Link href="/menu" />} nativeButton={false}>
          {t("homeButton")}
        </Button>
      </div>
    </div>
  )
}
