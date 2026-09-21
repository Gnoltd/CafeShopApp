import { getTranslations } from "next-intl/server"
import { QrCode } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { ScanQrButton } from "@/components/customer/scan-qr-button"

export default async function HomePage() {
  const t = await getTranslations("Home")
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-14 pb-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
        <QrCode className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-xl font-bold text-card-foreground">{t("scanTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("scanMessage")}</p>
      <div className="mt-3 flex w-full flex-col gap-2">
        <ScanQrButton />
        <Button variant="outline" className="h-11 w-full" render={<Link href="/menu" />} nativeButton={false}>
          {t("viewMenu")}
        </Button>
      </div>
      <Link href="/login" className="mt-4 text-sm font-semibold text-muted-foreground underline underline-offset-4">
        {t("staffLogin")}
      </Link>
    </div>
  )
}
