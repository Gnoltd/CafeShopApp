"use client"

import { useEffect, useRef, useState } from "react"
import jsQR from "jsqr"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { useRouter } from "@/i18n/navigation"
import { extractTableToken } from "@/lib/qr-table-token"

type ScannerStatus = "requesting" | "scanning" | "not-a-table-code" | "permission-denied" | "no-camera"

export function QrScannerOverlay({
  onClose,
  onScan,
}: {
  onClose: () => void
  onScan?: (token: string) => void
}) {
  const t = useTranslations("Landing")
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const [status, setStatus] = useState<ScannerStatus>("requesting")

  function stopCamera() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function handleClose() {
    stopCamera()
    onClose()
  }

  useEffect(() => {
    let cancelled = false

    function scanLoop() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(scanLoop)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        frameRef.current = requestAnimationFrame(scanLoop)
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        const token = extractTableToken(code.data)
        if (token) {
          stopCamera()
          onClose()
          if (onScan) {
            onScan(token)
          } else {
            router.push(`/table/${token}`)
          }
          return
        }
        setStatus((prev) => {
          if (prev !== "not-a-table-code") {
            setTimeout(() => setStatus("scanning"), 1500)
          }
          return "not-a-table-code"
        })
      }
      frameRef.current = requestAnimationFrame(scanLoop)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
        setStatus("scanning")
        scanLoop()
      })
      .catch((err: DOMException) => {
        if (cancelled) return
        setStatus(err.name === "NotAllowedError" ? "permission-denied" : "no-camera")
      })

    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-4">
        <span className="text-sm font-medium text-white">{t("scanInstructions")}</span>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label={t("closeScanner")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-56 w-56 rounded-2xl border-4 border-white/80" />
        </div>
      </div>

      {(status === "permission-denied" || status === "no-camera") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center">
          <p className="text-white">
            {status === "permission-denied" ? t("cameraPermissionDenied") : t("noCameraFound")}
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl bg-white px-6 py-3 font-bold text-black"
          >
            {t("closeScanner")}
          </button>
        </div>
      )}

      {status === "not-a-table-code" && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center">
          <span className="rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
            {t("notATableCode")}
          </span>
        </div>
      )}
    </div>
  )
}
