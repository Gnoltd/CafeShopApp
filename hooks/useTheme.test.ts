import { describe, it, expect, afterEach } from "vitest"
import { readInitialTheme } from "./useTheme"

// readInitialTheme() backs both the "stored theme" preference (localStorage,
// applied to <html class="dark"> by the no-flash inline script in
// app/[locale]/layout.tsx before hydration) and the "system" preference
// fallback that same script resolves via matchMedia -- by the time this
// runs, both paths collapse to the same signal: whether <html> already
// carries the "dark" class. ThemeProvider (hooks/useTheme.tsx) only calls
// this from a post-mount effect, never during its initial render, so its
// result can never cause a server/client markup mismatch (React hydration
// error #418) -- see the comment on ThemeProvider's useState call.
describe("readInitialTheme", () => {
  const originalDocument = globalThis.document

  afterEach(() => {
    if (originalDocument === undefined) {
      // @ts-expect-error -- test-only cleanup in a Node (no-DOM) environment
      delete globalThis.document
    } else {
      globalThis.document = originalDocument
    }
  })

  it("returns light when there is no document (SSR)", () => {
    // @ts-expect-error -- simulating an SSR environment
    delete globalThis.document
    expect(readInitialTheme()).toBe("light")
  })

  it("returns dark for a stored/system dark preference (<html class=\"dark\">)", () => {
    // Minimal fake matching only what readInitialTheme reads.
    globalThis.document = {
      documentElement: { classList: { contains: (cls: string) => cls === "dark" } },
    } as unknown as Document
    expect(readInitialTheme()).toBe("dark")
  })

  it("returns light for a stored/system light preference (no \"dark\" class)", () => {
    globalThis.document = {
      documentElement: { classList: { contains: () => false } },
    } as unknown as Document
    expect(readInitialTheme()).toBe("light")
  })
})
