import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Guards for the "one accessible Dialog module" rule (Task 6, 2026-09-02).
 *
 * This project's test setup is node-environment only — no jsdom, no
 * testing-library — and the brief asked not to invent component-test tooling
 * for this change. So rather than mock a DOM to assert focus-trap behaviour
 * that `@base-ui/react` already tests upstream, these are source-level
 * regression guards on the two things that actually regressed here before:
 * hand-rolled `fixed inset-0` scrims with no dialog semantics, and native
 * `window.confirm` (untranslatable, unstyleable, and invisible to the
 * `/vi`-`/en` parity checks). They follow the same file-walking shape as
 * lib/i18n-coverage.test.ts.
 */

const ROOT = join(__dirname, "..", "..")
const DIALOG_MODULE = join("components", "ui", "dialog.tsx")

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (/\.tsx$/.test(entry) && !entry.endsWith(".test.tsx")) files.push(full)
  }
  return files
}

function sourceFiles(): { path: string; source: string }[] {
  return [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].map((file) => ({
    path: file.slice(ROOT.length + 1),
    source: readFileSync(file, "utf8"),
  }))
}

describe("dialog module adoption", () => {
  it("walks a real tree (sanity check)", () => {
    expect(sourceFiles().length).toBeGreaterThan(50)
  })

  it("has no full-screen modal scrim that isn't built on the Dialog module", () => {
    // A `fixed inset-0` + translucent-black element is this codebase's
    // modal-scrim shape. Every one of them must come from components/ui/dialog
    // (directly, or via BottomSheet/SideDrawer, which import it) so that focus
    // trap, Escape, aria-modal and the inert background come along with it.
    const offenders = sourceFiles()
      .filter(({ path }) => path !== DIALOG_MODULE)
      .filter(({ source }) => /fixed inset-0[^"']*bg-black\//.test(source))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it("uses no native window.confirm/alert/prompt anywhere in the UI", () => {
    const offenders = sourceFiles()
      .filter(({ source }) => /\bwindow\.(confirm|alert|prompt)\s*\(/.test(source))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it("routes every BottomSheet/SideDrawer through the Dialog module", () => {
    for (const name of ["bottom-sheet", "side-drawer"]) {
      const source = readFileSync(join(ROOT, "components", "motion", `${name}.tsx`), "utf8")
      expect(source).toContain('from "@/components/ui/dialog"')
      expect(source).toContain("DialogRoot")
    }
  })
})
