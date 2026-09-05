import { ROLE_HOME } from "@/lib/roles"

export const ADMIN_ONLY_PREFIXES = ["/admin/staff", "/admin/settings"]

export const AUTH_REQUIRED_EXACT_PATHS = ["/home", "/profile", "/profile/settings", "/profile/addresses", "/orders", "/loyalty", "/loyalty/redemptions"]

export const ROUTE_GROUP_ROLES: { prefix: string; roles: string[] }[] = [
  { prefix: "/staff", roles: ["staff", "manager", "admin"] },
  { prefix: "/admin", roles: ["manager", "admin"] },
]

export function resolveRedirect(pathname: string, role: string | null): string | null {
  if (AUTH_REQUIRED_EXACT_PATHS.includes(pathname) && !role) {
    return "/login"
  }

  const adminOnlyMatch = ADMIN_ONLY_PREFIXES.find((p) => pathname.startsWith(p))
  if (adminOnlyMatch) {
    if (role !== "admin") {
      return role ? (ROLE_HOME[role] ?? "/menu") : "/login"
    }
    return null
  }

  const match = ROUTE_GROUP_ROLES.find((r) => pathname.startsWith(r.prefix))
  if (!match) return null

  if (!role || !match.roles.includes(role)) {
    return role ? (ROLE_HOME[role] ?? "/menu") : "/login"
  }
  return null
}

/** Splits a locale-prefixed pathname (e.g. "/vi/staff/pos") into its locale and the rest ("/staff/pos"). */
export function splitLocaleFromPathname(pathname: string): { locale: string; rest: string } {
  const segments = pathname.split("/")
  const locale = segments[1]
  const rest = "/" + segments.slice(2).join("/")
  return { locale, rest: rest === "/" ? "/" : rest.replace(/\/+$/, "") || "/" }
}

/**
 * Supabase's default auth-session cookie name -- `sb-<project-ref>-auth-token`,
 * where `<project-ref>` is the first label of the Supabase URL's hostname.
 * This project never passes `cookieOptions.name` to `createServerClient`
 * (checked both call sites: middleware.ts and lib/supabase/server.ts), so
 * @supabase/supabase-js's own default applies -- confirmed by reading its
 * bundled source (`sb-${new URL(url).hostname.split(".")[0]}-auth-token`,
 * in `createClient`'s default `auth.storageKey`), not assumed.
 */
export function getSupabaseAuthCookieName(supabaseUrl: string): string | null {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0]
    return projectRef ? `sb-${projectRef}-auth-token` : null
  } catch {
    return null
  }
}

// Matches @supabase/ssr's own chunk-naming convention (its
// utils/chunker.ts's isChunkLike): a session token too large for one cookie
// is split across `<key>.0`, `<key>.1`, etc.
const COOKIE_CHUNK_SUFFIX_REGEX = /^(.*)\.(0|[1-9][0-9]*)$/

/**
 * True if the request's cookie jar carries the Supabase auth-session cookie
 * (or any of its numbered chunks) for the given storage key. Lets
 * middleware skip the network round-trip role lookup entirely for a guest
 * with no session at all -- the actual "requests with no Supabase auth
 * cookie" case.
 */
export function hasSupabaseAuthCookie(cookieNames: string[], storageKey: string): boolean {
  return cookieNames.some((name) => {
    if (name === storageKey) return true
    const match = name.match(COOKIE_CHUNK_SUFFIX_REGEX)
    return match !== null && match[1] === storageKey
  })
}
