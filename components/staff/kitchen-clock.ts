// Kept in its own module, not inline in kitchen-stats-footer.tsx -- that
// file now also imports "@/i18n/navigation" (the walk-in-order Link),
// which pulls in next/navigation and breaks under Vitest's node
// environment (this project's Vitest setup has no DOM). Same reasoning as
// lib/middleware-rules.ts's own extraction, for the same underlying cause.
export function formatKitchenClock(now: number, locale: string): string {
  return new Date(now).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: locale !== "vi",
  })
}
