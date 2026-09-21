import { defineRouting } from "next-intl/routing"

export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  localePrefix: "always",
  // Always land first-time guests on vi instead of negotiating against the
  // browser's Accept-Language header — this app's actual customers are
  // walk-in guests scanning a Vietnamese cafe's table QR, not the browser's
  // locale. The LanguageSwitcher (now visible on every page, including
  // Home — see header-actions-stack.tsx) still lets anyone switch to en,
  // and next-intl remembers that choice via its own locale cookie.
  localeDetection: false,
})

export type Locale = (typeof routing.locales)[number]
