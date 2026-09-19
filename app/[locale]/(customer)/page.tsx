import { getTranslations } from "next-intl/server"
import { QrCode } from "lucide-react"
import { Link } from "@/i18n/navigation"

export default async function HomePage() {
  const t = await getTranslations("Home")
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
        <QrCode className="h-10 w-10 text-primary" />
      </div>
      <h1 className="text-xl font-bold text-card-foreground">{t("scanTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("scanMessage")}</p>
      <Link href="/login" className="mt-4 text-sm font-semibold text-muted-foreground underline underline-offset-4">
        {t("staffLogin")}
      </Link>
    </div>
  )
}
