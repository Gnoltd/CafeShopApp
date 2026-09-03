import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import createIntlMiddleware from "next-intl/middleware"
import { routing } from "./i18n/routing"
import {
  resolveRedirect,
  splitLocaleFromPathname,
  getSupabaseAuthCookieName,
  hasSupabaseAuthCookie,
} from "./lib/middleware-rules"
import { getCurrentRole } from "./lib/get-current-role"

const handleI18nRouting = createIntlMiddleware(routing)

// Same host backs REST/Auth (https) and Realtime (wss) -- both need to be
// allowed in connect-src; the public Storage bucket serving menu photos
// needs the https origin in img-src too.
const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")
const SUPABASE_WS_ORIGIN = SUPABASE_ORIGIN.replace(/^https:/, "wss:")

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

// strict-dynamic + a per-request nonce: Next.js's own framework-injected
// scripts auto-detect the nonce from this header (documented behavior since
// Next 13), and app/[locale]/layout.tsx applies the same nonce to the one
// inline script it renders (the theme-init IIFE) via headers().get("x-nonce").
// style-src stays nonce-less + unsafe-inline: several components use React's
// inline `style={{}}` prop (dynamic progress rings/bars etc.), which can't
// carry a per-element nonce -- CSS injection alone can't achieve script
// execution, so this is a deliberately narrower risk than script-src would be.
function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    // images.unsplash.com: interim allowance for spotlight-hero.tsx's
    // hardcoded hero photos (CSS background-image, so this CSP's img-src
    // governs them same as an <img> tag would) -- being replaced by an
    // admin-managed, Supabase-Storage-hosted image feature (see
    // docs/superpowers/specs/), at which point this line comes out.
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN} https://images.unsplash.com`,
    `font-src 'self'`,
    `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS_ORIGIN}`,
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ")
}

function applySecurityHeaders(headers: Headers, csp: string) {
  headers.set("Content-Security-Policy", csp)
  // Vercel injects HSTS on *.vercel.app, but that's not guaranteed for a
  // future custom domain -- set it explicitly rather than relying on the
  // platform default (2026-07-29 review, L-1).
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  // frame-ancestors above already covers modern browsers; this is the
  // legacy fallback for the same "don't let anyone iframe this app" intent
  // (real payment/admin/staff surfaces make clickjacking a live concern).
  headers.set("X-Frame-Options", "DENY")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  // camera=(self) keeps the dine-in QR scanner (qr-scanner-overlay.tsx,
  // getUserMedia) working; every other sensitive feature this policy
  // covers is unused anywhere in this app, so denied outright.
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
}

async function resolveRole(request: NextRequest): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabasePublishableKey) return null

  try {
    // Skip the network round trip (Auth getUser() + a profiles SELECT)
    // entirely for a request that can't possibly be authenticated -- no
    // Supabase auth cookie present at all. This is the common case (every
    // guest request) and was previously paying for two full round trips
    // just to learn "anonymous".
    const storageKey = getSupabaseAuthCookieName(supabaseUrl)
    if (!storageKey) return null
    const cookieNames = request.cookies.getAll().map((cookie) => cookie.name)
    if (!hasSupabaseAuthCookie(cookieNames, storageKey)) return null

    const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {
          // Cookie writes are handled by the outer response from next-intl's middleware;
          // this read-only client is only used here to resolve the current user's role.
        },
      },
    })

    return await getCurrentRole(supabase)
  } catch {
    // Supabase unreachable or misconfigured — fall through and treat the request as anonymous
    // rather than taking the whole site down.
    return null
  }
}

export async function middleware(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildCsp(nonce)
  // Mutating the incoming request's headers (rather than only the eventual
  // response's) is what makes x-nonce visible to Server Components via
  // next/headers -- this is the documented mechanism for passing data from
  // middleware downstream, and next-intl's own NextResponse.next() calls
  // below preserve it since it reads from this same request object.
  request.headers.set("x-nonce", nonce)

  // Resolve the role once, here, and stash it in a private request header
  // so every downstream layout/page reuses this exact result instead of
  // each repeating its own Auth + profiles round trip (previously up to
  // 3-4x per request across root/staff/admin layouts and leaf pages).
  //
  // Security-critical: request.headers.set() REPLACES any value already
  // present for this header name (confirmed against the Fetch-standard
  // Headers API NextRequest.headers implements — it does not append), and
  // HTTP header names are case-insensitive, so this unconditionally
  // clobbers whatever a client may have sent on its own request (e.g. a
  // spoofed `X-Resolved-Role: admin`) before any downstream code ever
  // reads it. There is no code path between the incoming request and this
  // line that reads x-resolved-role, so nothing can observe the
  // client-supplied value first.
  const role = await resolveRole(request)
  request.headers.set("x-resolved-role", role ?? "")

  // Let next-intl resolve/normalize the locale prefix first (e.g. "/" -> "/vi").
  // Mutating request.headers above (not just the eventual response's) is
  // what makes x-resolved-role visible to Server Components via
  // next/headers, same mechanism as x-nonce above -- must happen before
  // this call so next-intl's own NextResponse.next() picks it up.
  const intlResponse = handleI18nRouting(request)
  applySecurityHeaders(intlResponse.headers, csp)

  // If next-intl already decided to redirect (locale prefix was missing/wrong),
  // let that happen first — our auth check will run again on the follow-up request.
  if (intlResponse.status === 307 || intlResponse.status === 308) {
    return intlResponse
  }

  const { locale, rest } = splitLocaleFromPathname(request.nextUrl.pathname)

  const redirectPath = resolveRedirect(rest, role)
  if (redirectPath) {
    const redirectResponse = NextResponse.redirect(new URL(`/${locale}${redirectPath}`, request.url))
    applySecurityHeaders(redirectResponse.headers, csp)
    return redirectResponse
  }

  return intlResponse
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|glb)$).*)",
  ],
}
