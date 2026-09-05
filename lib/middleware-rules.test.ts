import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { resolveRedirect, getSupabaseAuthCookieName, hasSupabaseAuthCookie } from "./middleware-rules"

describe("resolveRedirect — auth-required exact paths", () => {
  it("redirects an anonymous guest away from /profile", () => {
    expect(resolveRedirect("/profile", null)).toBe("/login")
  })

  it("redirects an anonymous guest away from /orders", () => {
    expect(resolveRedirect("/orders", null)).toBe("/login")
  })

  it("redirects an anonymous guest away from /loyalty", () => {
    expect(resolveRedirect("/loyalty", null)).toBe("/login")
  })

  it("redirects an anonymous guest away from /home", () => {
    expect(resolveRedirect("/home", null)).toBe("/login")
  })

  it("allows a logged-in customer to reach /home", () => {
    expect(resolveRedirect("/home", "customer")).toBeNull()
  })

  it("allows a logged-in customer to reach /profile", () => {
    expect(resolveRedirect("/profile", "customer")).toBeNull()
  })

  it("allows a logged-in staff user to reach /orders", () => {
    expect(resolveRedirect("/orders", "staff")).toBeNull()
  })

  it("allows a logged-in admin to reach /loyalty", () => {
    expect(resolveRedirect("/loyalty", "admin")).toBeNull()
  })

  it("does not gate an individual order tracking page for a guest", () => {
    expect(resolveRedirect("/orders/abc123", null)).toBeNull()
  })

  it("redirects an anonymous guest away from /profile/settings", () => {
    expect(resolveRedirect("/profile/settings", null)).toBe("/login")
  })

  it("allows a logged-in customer to reach /profile/settings", () => {
    expect(resolveRedirect("/profile/settings", "customer")).toBeNull()
  })

  it("redirects an anonymous guest away from /profile/addresses", () => {
    expect(resolveRedirect("/profile/addresses", null)).toBe("/login")
  })

  it("allows a logged-in customer to reach /profile/addresses", () => {
    expect(resolveRedirect("/profile/addresses", "customer")).toBeNull()
  })

  it("redirects an anonymous guest away from /loyalty/redemptions", () => {
    expect(resolveRedirect("/loyalty/redemptions", null)).toBe("/login")
  })

  it("allows a logged-in customer to reach /loyalty/redemptions", () => {
    expect(resolveRedirect("/loyalty/redemptions", "customer")).toBeNull()
  })
})

describe("resolveRedirect — existing /staff and /admin behavior unaffected", () => {
  it("still redirects an anonymous guest away from /staff/pos", () => {
    expect(resolveRedirect("/staff/pos", null)).toBe("/login")
  })

  it("still redirects a customer away from /admin/dashboard", () => {
    expect(resolveRedirect("/admin/dashboard", "customer")).toBe("/home")
  })

  it("redirects non-manager customers away from admin settings", () => {
    expect(resolveRedirect("/admin/settings", "customer")).toBe("/home")
  })
})

describe("getSupabaseAuthCookieName", () => {
  it("derives sb-<project-ref>-auth-token from the Supabase URL's hostname", () => {
    expect(getSupabaseAuthCookieName("https://qhiypdqnrnzndxdwqxbx.supabase.co")).toBe(
      "sb-qhiypdqnrnzndxdwqxbx-auth-token",
    )
  })

  it("uses only the first hostname label as the project ref", () => {
    expect(getSupabaseAuthCookieName("https://abcdefgh.supabase.co/")).toBe("sb-abcdefgh-auth-token")
  })

  it("returns null for an unparseable URL", () => {
    expect(getSupabaseAuthCookieName("not-a-url")).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(getSupabaseAuthCookieName("")).toBeNull()
  })
})

describe("hasSupabaseAuthCookie", () => {
  const storageKey = "sb-qhiypdqnrnzndxdwqxbx-auth-token"

  it("is false for a guest with no cookies at all", () => {
    expect(hasSupabaseAuthCookie([], storageKey)).toBe(false)
  })

  it("is false when only unrelated cookies are present", () => {
    expect(hasSupabaseAuthCookie(["theme", "NEXT_LOCALE"], storageKey)).toBe(false)
  })

  it("is true for the exact unchunked cookie name", () => {
    expect(hasSupabaseAuthCookie(["theme", storageKey], storageKey)).toBe(true)
  })

  it("is true for a chunked cookie (large token split into .0/.1/...)", () => {
    expect(hasSupabaseAuthCookie([`${storageKey}.0`, `${storageKey}.1`], storageKey)).toBe(true)
  })

  it("does not match a cookie for a different Supabase project", () => {
    expect(hasSupabaseAuthCookie(["sb-someotherproject-auth-token"], storageKey)).toBe(false)
  })

  it("does not match a similarly-prefixed but distinct cookie name", () => {
    expect(hasSupabaseAuthCookie([`${storageKey}-code-verifier`], storageKey)).toBe(false)
  })
})

/**
 * middleware.ts's `config.matcher` decides whether middleware runs at all
 * for a given path -- and middleware is what overwrites the private
 * `x-resolved-role` request header (clobbering any client-supplied
 * `X-Resolved-Role`) and applies resolveRedirect's role gate. A path the
 * matcher excludes gets NEITHER. So the matcher itself is an
 * authorization-relevant surface and needs its own coverage.
 *
 * Next.js requires `config.matcher` to be a statically analyzable string
 * literal, so it can't be imported from here (and importing middleware.ts
 * would pull in next-intl/middleware, which is exactly what
 * middleware-rules.ts exists to avoid). Instead we read the literal back
 * out of the source file and evaluate it directly -- the pattern uses no
 * path-to-regexp params, only a plain regex group, so anchoring it with
 * ^...$ models Next's own compilation faithfully for these cases.
 */
function loadMiddlewareMatchers(): RegExp[] {
  const middlewarePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../middleware.ts")
  const source = readFileSync(middlewarePath, "utf8")
  // Note the array body is matched as "one or more string literals" rather
  // than a lazy `[\s\S]*?` up to the next `]` -- the matcher literal itself
  // contains a `]` (inside its `[^/]` character class) and would truncate it.
  const block = source.match(/matcher:\s*\[\s*((?:"(?:[^"\\]|\\.)*"\s*,?\s*)+)\]/)
  if (!block) throw new Error("could not find config.matcher in middleware.ts")
  const literals = block[1].match(/"(?:[^"\\]|\\.)*"/g)
  if (!literals?.length) throw new Error("config.matcher contained no string literals")
  return literals.map((literal) => new RegExp(`^${JSON.parse(literal) as string}$`))
}

/** True if middleware would run for this path (any matcher entry matches). */
function middlewareRunsOn(pathname: string): boolean {
  return loadMiddlewareMatchers().some((re) => re.test(pathname))
}

describe("middleware matcher — must run on real app routes", () => {
  // The regression this exists for: the previous unanchored
  // `.*\.(?:svg|png|...)$` exclusion swallowed any route whose dynamic
  // segment ended in a static-asset extension. Middleware never ran, so
  // a spoofed `X-Resolved-Role: admin` header reached the staff layout
  // unclobbered and got past its gate.
  it("runs on a staff route whose dynamic segment ends in an image extension", () => {
    expect(middlewareRunsOn("/vi/staff/orders/history/abc.png")).toBe(true)
  })

  it("runs on an admin route whose dynamic segment ends in an image extension", () => {
    expect(middlewareRunsOn("/en/admin/staff/some-id.svg")).toBe(true)
  })

  it("runs on a customer route whose dynamic segment ends in an image extension", () => {
    expect(middlewareRunsOn("/vi/menu/latte.jpg")).toBe(true)
  })

  it.each([
    "/",
    "/menu",
    "/vi",
    "/vi/menu",
    "/vi/staff/pos",
    "/vi/staff/orders/history/6f1c2b9e-1111-2222-3333-444455556666",
    "/en/admin/dashboard",
    "/vi/profile/settings",
    "/vi/table/some-qr-token",
  ])("runs on %s", (pathname) => {
    expect(middlewareRunsOn(pathname)).toBe(true)
  })
})

describe("middleware matcher — must skip real static assets", () => {
  it.each([
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon-192.png",
    "/icon-512.png",
    "/next.svg",
    "/models/coffee-cup.glb",
    "/_next/static/chunks/main.js",
    "/_vercel/insights/script.js",
    "/api/anything",
  ])("skips %s", (pathname) => {
    expect(middlewareRunsOn(pathname)).toBe(false)
  })

  it("skips every file actually present in public/", async () => {
    const { readdirSync } = await import("node:fs")
    const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public")
    const entries = readdirSync(publicDir, { recursive: true, withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => "/" + path.relative(publicDir, path.join(entry.parentPath, entry.name)))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(middlewareRunsOn(file), `${file} should be excluded from middleware`).toBe(false)
    }
  })
})
