# Customer App redesign — worktree brief

Source: Claude Design canvas project "PhaDinCafe mobile app design"
(`b774e8b3-40d0-4447-ae9c-80a8b1463fd1`), screen `PhaDinCafe Customer App.dc.html`
(full mockup saved alongside this file — it's a `.dc.html` design-canvas
document: React-ish pseudo-JSX with `{{ }}` bindings and `sc-for`/`sc-if`
control-flow tags, not directly runnable code — read it as a spec of
states/copy/layout, not paste-able source).

The canvas project's own `github.md` (fetched via the `claude_design` MCP,
`get_file` on the same project) says this pass was built by reading the
**real, shipping implementation** as source of truth, not proposing a new
visual language. Confirmed independently: the design system's
`tokens/colors.css` (`--primary #b3341f`, `--secondary #6f4e37`, `--accent
#c9a66b`, `--chip`/`--ink`/`--price`/`--success`/`--warn`) is byte-for-byte
identical to what's already in `app/globals.css` — this repo's neubrutalist
redesign (thick ink borders, hard offset shadows, `nb-border`/`nb-shadow`
classes) already shipped in July 2026 (see
`docs/superpowers/plans/2026-07-12-neubrutalist-redesign-phase*.md`).
**So: don't reskin from scratch.** The job is reconciling/upgrading specific
flows against an already-correct palette and component base, not repainting
the app.

## Screen → real component map (from the canvas's `github.md`)

| Mockup screen | Real files |
|---|---|
| QR scan states | `components/customer/table-landing.tsx`, `lib/qr-table-token.ts`, `hooks/useTables.tsx` |
| Table session, shared cart, rounds | `components/customer/table-ordering-session.tsx`, `components/customer/table-cart-panel.tsx`, `hooks/useTableSession.tsx`, `lib/table-session-changes.ts` |
| Check Bill | `components/customer/check-bill-sheet.tsx`, `lib/order-total.ts` |
| Cart transfer into table | `lib/table-cart-transfer.ts` |
| Menu browse + quick add | `components/customer/menu-browser.tsx`, `components/customer/quick-add-popup.tsx` |
| Pickup flow, tracking, loyalty, profile | not repo-derived — earlier design pass, treat as inspiration only, verify against `components/customer/*` and `AGENTS.md`/`components/customer/AGENTS.md` (if present) before trusting copy or flow details |

`AsyncSkeleton`/`AsyncRetryError`/`StaleNotice` treatments in the mockup were
"rebuilt to match the real components" per `github.md` — cross-check against
whatever async-state components actually exist under `components/customer/`
or `components/shared/` before assuming the mockup's version is current;
this repo just finished a Task 3 pass (see root `AGENTS.md`/`daily.md`)
specifically hardening loading/empty/error/stale handling, so the real
components may already be ahead of this mockup in places.

## The component library is already real — don't rebuild it

Checked directly: every component the design system publishes
(`Button`, `Input`, `Label`, `Badge`, `Card`, `SegmentedControl`,
`AnimatedTabBar`, `ProgressRing`, `StepProgress`, `PressFeedback`,
`StaggerList`, `AnimatedCounter`, `BottomSheet`, `RoleBadge`,
`ThemeToggle`, `LanguageSwitcher`) already exists as a real, shipped
TypeScript component in this repo — `components/ui/{button,input,label,
badge,card}.tsx`, `components/motion/{segmented-control,animated-tab-bar,
progress-ring,step-progress,press-feedback,stagger-list,animated-counter,
bottom-sheet}.tsx`, `components/shared/{role-badge,theme-toggle,
language-switcher}.tsx`. The design system's own `.jsx` versions are
plain-React simplifications of these for the canvas preview (no Framer
Motion, no shadcn/Base UI) — reference them only to understand an
interaction pattern's *intent*, never as code to port in. Always import
and use the real component.

## Before writing code

1. Read the real components listed above first — they're the behavioral
   source of truth (RLS, guest-safe RPCs, Realtime, i18n keys in
   `messages/{vi,en}.json`). The mockup only tells you what changed
   visually/interaction-wise.
2. Diff the mockup's copy against `messages/vi.json`/`messages/en.json` —
   `github.md` claims copy was "taken verbatim," but verify per-string; if a
   string's genuinely new, add it to **both** locale files.
3. Any component the design system publishes as reusable (`AnimatedTabBar`,
   `SegmentedControl`, `ProgressRing`, `StepProgress`, `BottomSheet`,
   `StaggerList`, `AnimatedCounter`, `RoleBadge`, `ThemeToggle`,
   `LanguageSwitcher`) may already exist under `components/motion/` or
   `components/shared/` in this repo — grep before creating a duplicate.
4. This branch (`redesign/customer-app`) was cut from `main` at `a2f1dbf`.
   Rebase before merging if `main` has moved. Use the
   `superpowers:finishing-a-development-branch` skill when the work here is
   ready to integrate.
5. Coordination with the other two redesign worktrees
   (`redesign/kitchen-display`, `redesign/manager-app`) and with Codex: same
   pattern as root `AGENTS.md`'s existing Task-split notes — commit and push
   often so progress is visible via `git log`, and check `git log
   redesign/kitchen-display`/`redesign/manager-app` before touching any file
   that might be shared (there shouldn't be much overlap between customer,
   staff, and admin surfaces, but `hooks/useTableSession.tsx` and
   `hooks/useTables.tsx` are touched by both the customer and admin/staff
   redesigns — check the other branches before editing those two).
