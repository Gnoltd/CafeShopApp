/**
 * Pure state-transition shared by every hook that keeps polling/subscribing
 * for a background refetch after its first successful load (useTableSession,
 * useOrders, useKitchenOrders, useDashboardStats) -- see daily.md Task 3's
 * "retain last-good data, flag stale" checklist item.
 *
 * Kept free of React (no useState/useRef) so the transition itself is
 * directly unit-testable without a render harness, matching this project's
 * established pattern for hook-adjacent logic (useKitchenOrders.tsx's
 * withItemStatus/advanceItemGuarded, useOrderHistory.tsx's buildDateRange,
 * useLatestRefetch.ts's createSequenceGuard).
 *
 * The two flags are deliberately mutually exclusive:
 * - `hasBlockingError`: the load has never succeeded even once, so there is
 *   nothing safe to show yet -- callers render a blocking retry state
 *   (`AsyncRetryError`) instead of good data.
 * - `hasStaleData`: the load succeeded at least once before this failure --
 *   callers must leave whatever they already rendered untouched and only
 *   flag it as possibly outdated (`StaleNotice`), never clear/blank it.
 *
 * A success always clears both flags outright, regardless of prior state.
 */
export type AsyncLoadOutcome = "success" | "failure"

export type AsyncLoadFlags = {
  hasBlockingError: boolean
  hasStaleData: boolean
}

export function nextAsyncLoadFlags(hasLoadedOnce: boolean, outcome: AsyncLoadOutcome): AsyncLoadFlags {
  if (outcome === "success") return { hasBlockingError: false, hasStaleData: false }
  return hasLoadedOnce
    ? { hasBlockingError: false, hasStaleData: true }
    : { hasBlockingError: true, hasStaleData: false }
}
