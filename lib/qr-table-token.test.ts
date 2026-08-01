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
