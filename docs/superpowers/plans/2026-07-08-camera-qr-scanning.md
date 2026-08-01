# Camera-Based QR Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Landing's "Scan QR at Table" button real — tapping it opens the device camera, decodes a table's printed QR code, and navigates to that table's existing `/table/[qrToken]` page.

**Architecture:** A new `jsQR`-powered scanner overlay component owns all camera/decode logic in isolation, built on top of a small pure function (`extractTableToken`) that validates a decoded string looks like this app's own table URL before anything navigates. The existing `/table/[qrToken]` page and `useTables()` resolution logic are untouched — this feature only gets a token in front of that page faster.

**Tech Stack:** `jsQR` (new npm dependency), `getUserMedia`/`<video>`/`<canvas>` (browser APIs, no other new dependency), next-intl, `@/i18n/navigation`'s locale-aware router.

**Reference spec:** `docs/superpowers/specs/2026-07-08-camera-qr-scanning-design.md`

## Global Constraints

- **Library is `jsQR`**, not the native `BarcodeDetector` API (unsupported in Firefox/older Safari) or `html5-qrcode` (heavier, brings its own UI).
- **Token validation matches the pathname only**, ignoring hostname — `/(?:vi\/|en\/)?table\/([^/?#]+)/` — so scanning works against preview-deployment URLs too, not just the exact production domain.
- **A single shared close/cleanup path** (Close button, successful scan, and component unmount) must stop every `MediaStreamTrack` — never leave the camera running after the overlay closes.
- `getUserMedia` requires a secure context — already satisfied on the deployed HTTPS URL and on `localhost`; no special-casing needed.
- Every new user-facing string is added to **both** `messages/vi.json` and `messages/en.json`.
- No automated test exists for camera/`getUserMedia` behavior in this project (same limitation as every other browser-only feature) — verify manually on the deployed Vercel URL with a real phone, per this project's established convention.

---

### Task 1: `extractTableToken` pure function

**Files:**
- Create: `lib/qr-table-token.ts`
- Test: `lib/qr-table-token.test.ts`

**Interfaces:**
- Produces: `extractTableToken(decodedText: string): string | null` — the only function `qr-scanner-overlay.tsx` (Task 2) will import from this file.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { extractTableToken } from "./qr-table-token"

describe("extractTableToken", () => {
  it("extracts the token from a production table URL", () => {
    expect(extractTableToken("https://phadincafe.vercel.app/table/abc123")).toBe("abc123")
  })

  it("extracts the token ignoring a locale prefix", () => {
    expect(extractTableToken("https://phadincafe.vercel.app/vi/table/abc123")).toBe("abc123")
    expect(extractTableToken("https://phadincafe.vercel.app/en/table/abc123")).toBe("abc123")
  })

  it("extracts the token ignoring the hostname (preview deployments)", () => {
    expect(extractTableToken("https://phadincafe-preview-xyz.vercel.app/table/abc123")).toBe("abc123")
  })

  it("extracts the token ignoring a trailing query string", () => {
    expect(extractTableToken("https://phadincafe.vercel.app/table/abc123?foo=bar")).toBe("abc123")
  })

  it("returns null for a URL with no /table/ path", () => {
    expect(extractTableToken("https://example.com/not-a-table-path")).toBeNull()
  })

  it("returns null for a non-URL string", () => {
    expect(extractTableToken("hello world")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- qr-table-token`
Expected: FAIL — `./qr-table-token` has no exported member `extractTableToken` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Validates a QR-decoded string looks like this app's own table URL
 * before anything is allowed to navigate — matches the pathname only,
 * deliberately ignoring the hostname so scanning still works against a
 * preview deployment's URL, not just the exact production domain. Safe
 * to be this lenient because only an opaque token substring is ever
 * extracted; the real validation (does this token resolve to a real
 * table) happens where it always has, in table-landing.tsx.
 */
export function extractTableToken(decodedText: string): string | null {
  const match = decodedText.match(/\/(?:vi\/|en\/)?table\/([^/?#]+)/)
  return match ? match[1] : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- qr-table-token`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/qr-table-token.ts lib/qr-table-token.test.ts
git commit -m "feat: add extractTableToken for validating scanned QR codes"
```

---

### Task 2: `QrScannerOverlay` component

**Files:**
- Create: `components/customer/qr-scanner-overlay.tsx`
- Modify: `package.json` (add `jsqr` dependency)

**Interfaces:**
- Consumes: `extractTableToken` from `@/lib/qr-table-token` (Task 1).
- Produces: `QrScannerOverlay({ onClose: () => void })` — a client component with no other props. Navigation is a side effect (via `@/i18n/navigation`'s `useRouter`), not a callback prop.

**No automated test** — camera/`getUserMedia` isn't something this project's Vitest setup can exercise. Verified manually in Task 4.

- [ ] **Step 1: Install `jsQR`**

Run: `npm install jsqr`

`jsqr` ships its own TypeScript types (`dist/index.d.ts`) — no separate `@types/jsqr` package exists or is needed.

- [ ] **Step 2: Write the component**

Create `components/customer/qr-scanner-overlay.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import jsQR from "jsqr"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { useRouter } from "@/i18n/navigation"
import { extractTableToken } from "@/lib/qr-table-token"

type ScannerStatus = "requesting" | "scanning" | "not-a-table-code" | "permission-denied" | "no-camera"

export function QrScannerOverlay({ onClose }: { onClose: () => void }) {
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
          router.push(`/table/${token}`)
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
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
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
```

- [ ] **Step 3: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/customer/qr-scanner-overlay.tsx
git commit -m "feat: add QrScannerOverlay camera-based QR scanner component"
```

---

### Task 3: Wire the scanner into Landing

**Files:**
- Modify: `components/marketing/landing-view.tsx`
- Modify: `messages/vi.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `QrScannerOverlay` from `@/components/customer/qr-scanner-overlay` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Add the new translation keys**

In `messages/en.json`, inside the `Landing` namespace, add (after `"scanQr"`):

```json
    "scanQr": "Scan QR at Table",
    "scanInstructions": "Point your camera at the table's QR code",
    "closeScanner": "Close",
    "cameraPermissionDenied": "Camera access is needed to scan a QR code.",
    "noCameraFound": "No camera found on this device.",
    "notATableCode": "That's not a table code — try again.",
```

In `messages/vi.json`, inside the `Landing` namespace, add (after `"scanQr"`):

```json
    "scanQr": "Quét QR Tại Bàn",
    "scanInstructions": "Hướng camera vào mã QR trên bàn",
    "closeScanner": "Đóng",
    "cameraPermissionDenied": "Cần quyền truy cập camera để quét mã QR.",
    "noCameraFound": "Không tìm thấy camera trên thiết bị này.",
    "notATableCode": "Đây không phải mã bàn — vui lòng thử lại.",
```

- [ ] **Step 2: Enable the button and wire the overlay**

In `components/marketing/landing-view.tsx`, change:

```tsx
"use client"

import { useLocale, useTranslations } from "next-intl"
import { Coffee, CupSoda, Cookie, Milk, QrCode, Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { formatVND } from "@/lib/format"
import type { MenuItem, MenuIcon } from "@/lib/supabase/menu-data"
```

to:

```tsx
"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Coffee, CupSoda, Cookie, Milk, QrCode, Sparkles, ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { formatVND } from "@/lib/format"
import { QrScannerOverlay } from "@/components/customer/qr-scanner-overlay"
import type { MenuItem, MenuIcon } from "@/lib/supabase/menu-data"
```

Change:

```tsx
export function LandingView({ bestSellers }: { bestSellers: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Landing")

  return (
```

to:

```tsx
export function LandingView({ bestSellers }: { bestSellers: MenuItem[] }) {
  const locale = useLocale()
  const t = useTranslations("Landing")
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  return (
```

Change:

```tsx
            <Button
              variant="outline"
              className="h-14 rounded-xl border-2 border-white/70 bg-transparent text-base font-bold text-white hover:bg-white/10"
              disabled
              title="Not implemented yet — no camera-based QR scanning built"
            >
              <QrCode className="h-5 w-5" />
              {t("scanQr")}
            </Button>
```

to:

```tsx
            <Button
              variant="outline"
              className="h-14 rounded-xl border-2 border-white/70 bg-transparent text-base font-bold text-white hover:bg-white/10"
              onClick={() => setIsScannerOpen(true)}
            >
              <QrCode className="h-5 w-5" />
              {t("scanQr")}
            </Button>
```

Change the end of the returned JSX from:

```tsx
      </section>
    </div>
  )
}
```

(the closing `</section>` of the category chips section) to:

```tsx
      </section>

      {isScannerOpen && <QrScannerOverlay onClose={() => setIsScannerOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Run the build to confirm no type errors**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/marketing/landing-view.tsx messages/vi.json messages/en.json
git commit -m "feat: enable Landing's Scan QR button with the camera scanner"
```

---

### Task 4: End-to-end verification

**No files change in this task** — final verification pass, run against the deployed Vercel URL per this project's established convention (not `npm run dev`), using a real phone (camera testing needs a real device, not a desktop browser without a webcam).

- [ ] **Step 1: Deploy**

Push the commits from Tasks 1–3 to `main` (Vercel auto-deploys on push).

- [ ] **Step 2: Verify the success path**

On a phone, open `https://phadincafe.vercel.app`, tap "Scan QR at Table". Grant camera permission when prompted. Point the camera at one of Admin Tables' real generated QR codes (`/admin/tables` → any table card's QR image, or the "Download QR" file). Confirm:
- The scanner recognizes the code and navigates to that table's `/table/[qrToken]` page.
- The page shows the same "You're ordering at Table N" success state as physically scanning with the OS camera app.
- `select scan_count from public.tables where qr_token = '<token>';` (via `mcp__supabase__execute_sql`) shows the count incremented — proves this reused the real `increment_table_scan_count` RPC exactly like the existing manual-scan path, no new code path was needed there.

- [ ] **Step 3: Verify permission-denied**

Deny the camera permission prompt (or revoke it in the browser's site settings and reload). Tap "Scan QR at Table" again. Confirm the inline "Camera access is needed..." message shows with a working Close button that returns to Landing.

- [ ] **Step 4: Verify a non-table QR code**

Point the scanner at any unrelated QR code (e.g. a Wi-Fi QR code, a URL to a different site). Confirm the "That's not a table code" message appears briefly and the scanner keeps running (doesn't close or navigate) — then confirm pointing it back at a real table QR code still works in the same session.

- [ ] **Step 5: Verify camera cleanup**

After a successful scan (Step 2) and after manually closing via the X button, confirm the phone's camera-in-use indicator (the green dot on iOS, the camera icon in the status bar on Android) turns off in both cases — proves `stopCamera()`'s track-stopping runs on every close path, not just some.

- [ ] **Step 6: Update `daily.md` and `CLAUDE.md`**

Mark this feature as shipped in `daily.md`, moving on to the next queued item (table status in KDS + Admin Dashboard). Add a short "Camera QR scanning" mention to CLAUDE.md's feature-areas section (Customer ordering flow or a new small entry) following the existing level of detail for similarly-sized features.
