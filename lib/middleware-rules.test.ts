import { describe, it, expect } from "vitest"
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
    expect(resolveRedirect("/admin/dashboard", "customer")).toBe("/menu")
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
