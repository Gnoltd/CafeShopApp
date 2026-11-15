export {
  AUTH_REQUIRED_EXACT_PATHS,
  ROUTE_POLICIES,
  canAccessRoute,
  resolveRedirect,
} from "@/lib/roles"

/** Splits a locale-prefixed pathname (e.g. "/vi/staff/orders") into its locale and the rest ("/staff/orders"). */
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
