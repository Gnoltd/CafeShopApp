import { describe, it, expect } from "vitest"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { AUTH_REQUIRED_EXACT_PATHS } from "./middleware-rules"

// AUTH_REQUIRED_EXACT_PATHS (middleware-rules.ts) is exact-match, not
// prefix-match, so a new page nested under an already-gated path is
// silently unprotected until manually added -- this test walks the real
// route tree under app/[locale]/(customer)/{profile,loyalty} and asserts
// every static (non-dynamic-segment) page it finds is actually listed.
// /orders/[orderId] is deliberately excluded from both the walk and the
// list -- it's guest-reachable by design (see root CLAUDE.md's route
// map), so only the /orders list page itself is checked separately
// below (2026-07-29 review, I-8).

const CUSTOMER_ROOT = join(__dirname, "..", "app", "[locale]", "(customer)")
const AUTH_RELEVANT_PREFIXES = ["profile", "loyalty"]

function findStaticPagePaths(dir: string, urlPath: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const paths: string[] = []

  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    paths.push(urlPath)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue
    paths.push(...findStaticPagePaths(join(dir, entry.name), `${urlPath}/${entry.name}`))
  }

  return paths
}

describe("AUTH_REQUIRED_EXACT_PATHS stays in sync with the real route tree", () => {
  for (const prefix of AUTH_RELEVANT_PREFIXES) {
    const discovered = findStaticPagePaths(join(CUSTOMER_ROOT, prefix), `/${prefix}`)

    it(`found at least one static page under /${prefix}`, () => {
      expect(discovered.length).toBeGreaterThan(0)
    })

    for (const path of discovered) {
      it(`${path} is listed in AUTH_REQUIRED_EXACT_PATHS`, () => {
        expect(AUTH_REQUIRED_EXACT_PATHS).toContain(path)
      })
    }
  }

  it("/orders (the list page) is listed -- /orders/[orderId] is intentionally not", () => {
    expect(AUTH_REQUIRED_EXACT_PATHS).toContain("/orders")
    expect(AUTH_REQUIRED_EXACT_PATHS).not.toContain("/orders/[orderId]")
  })
})
