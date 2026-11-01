import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe("auth cookie transport", () => {
  it("requires HTTPS in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const { authCookieOptions } = await import("./cookie-options")
    expect(authCookieOptions).toEqual({ secure: true, sameSite: "lax", path: "/" })
  })
  it("allows the local HTTP development server", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    const { authCookieOptions } = await import("./cookie-options")
    expect(authCookieOptions.secure).toBe(false)
  })
})
