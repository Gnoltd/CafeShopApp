"use client"

import { useState } from "react"
import { QrCode } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"

export function ScanQrButton() {
  const t = useTranslations("Home")
  const [scanning, setScanning] = useState(false)

  return (
    <>
      <Button variant="neubrutal" className="h-12 w-full gap-2 text-base" onClick={() => setScanning(true)}>
        <QrCode className="h-5 w-5" />
        {t("scanQr")}
      </Button>
      {scanning && <QrScannerOverlay onClose={() => setScanning(false)} />}
    </>
  )
}
