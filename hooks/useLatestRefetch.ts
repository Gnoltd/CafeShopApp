import { useEffect, useState } from "react"

/**
 * Passed to every load run so the load body can drop its own result when a
 * newer run has already applied one ("latest wins"). Call `isStale()` after
 * the network work and before touching state:
 *
 *   const data = await fetchThing()
 *   if (isStale()) return
 *   setThing(data)
 */
export type LoadContext = { isStale: () => boolean }

export type LatestRefetchLoad = (ctx: LoadContext) => Promise<unknown>

/**
 * A `LoadContext` that never reports staleness -- for calling a load body
 * directly (outside any runner), e.g. from a test or a one-off path.
 */
export const FRESH_LOAD: LoadContext = { isStale: () => false }

/**
 * Monotonic "latest wins" sequencer, kept as a standalone pure factory (no
 * React, no timers) so the ordering rule can be tested against genuinely
 * out-of-order promise resolution -- the same
 * extract-the-logic-so-it's-testable split this project already uses for
 * `readInitialTheme` (hooks/useTheme.tsx) and `lib/middleware-rules.ts`.
 *
 * Each `begin()` hands out a ticket. The first `isStale()` call from a
 * ticket newer than anything applied so far marks itself as the applied
 * generation and reports `false`; any older ticket that finishes later
 * reports `true` and must discard its result.
 */
export function createSequenceGuard() {
  let issued = 0
  let applied = 0

  return {
    begin(): LoadContext {
      const ticket = ++issued
      return {
        isStale() {
          if (ticket < applied) return true
          applied = ticket
          return false
        },
      }
    },
    /**
     * Invalidates every run currently in flight: their `isStale()` will
     * report true. Used on unmount/cancel and after a mutation writes an
     * authoritative result straight into state.
     */
    invalidate() {
      applied = ++issued
    },
  }
}

export type LatestRefetchRunner = {
  /**
   * Replaces the load body. React call sites re-declare their load closure
   * every render (it captures props/state); the runner itself is created
   * once, so it always calls the most recently published body.
   */
  setLoad: (load: LatestRefetchLoad) => void
  /** Debounced + coalesced refetch. A burst of events produces one load. */
  trigger: () => void
  /** Run as soon as possible (initial mount fetch, explicit user refresh). */
  run: () => Promise<void>
  /** Drop any pending/queued run and invalidate whatever is in flight. */
  cancel: () => void
  /** Invalidate in-flight runs without scheduling anything new. */
  invalidate: () => void
}

export type LatestRefetchOptions = {
  /**
   * Upper bound on how long a continuous stream of triggers can keep
   * pushing the debounce window out. Without it a table that changes more
   * often than `delayMs` would never refetch at all. Defaults to 4x
   * `delayMs`.
   */
  maxDelayMs?: number
  onError?: (error: unknown) => void
}

/**
 * The event-coalescing half of the runner, again free of React so it can be
 * driven by fake timers in tests.
 *
 * Guarantees:
 * - **Coalesces bursts**: triggers within `delayMs` of each other collapse
 *   into a single `load` call (trailing edge), capped by `maxDelayMs`.
 * - **One active fetch**: `load` is never invoked while a previous
 *   invocation is still pending; at most one follow-up run is queued.
 * - **Latest wins**: every invocation gets a `LoadContext` from a shared
 *   sequence guard, so a straggling older response cannot overwrite state a
 *   newer response already applied (this matters for loads started outside
 *   the debounce path too -- the mount fetch and `run()`).
 */
export function createLatestRefetchRunner(
  initialLoad: LatestRefetchLoad,
  delayMs: number,
  options: LatestRefetchOptions = {}
): LatestRefetchRunner {
  const { maxDelayMs = delayMs * 4, onError } = options
  const guard = createSequenceGuard()

  let load = initialLoad
  let timer: ReturnType<typeof setTimeout> | null = null
  let burstStartedAt = 0
  let inFlight: Promise<void> | null = null
  let queued = false
  // Callers of run() that arrived while a load was already in flight: their
  // promise must resolve only once a run started *after* their call has
  // finished, otherwise "await refetch()" would resolve against data the
  // caller has already decided is out of date.
  let waiters: (() => void)[] = []

  function settleWaiters() {
    if (waiters.length === 0) return
    const pending = waiters
    waiters = []
    for (const resolve of pending) resolve()
  }

  function start(): Promise<void> {
    const ctx = guard.begin()
    const settled = Promise.resolve()
      .then(() => load(ctx))
      .then(
        () => {},
        (error) => {
          onError?.(error)
        }
      )
      .then(() => {
        inFlight = null
        if (queued) {
          queued = false
          void start()
        } else {
          settleWaiters()
        }
      })
    inFlight = settled
    return settled
  }

  function fire() {
    timer = null
    if (inFlight) {
      queued = true
      return
    }
    void start()
  }

  return {
    setLoad(next: LatestRefetchLoad) {
      load = next
    },
    trigger() {
      const now = Date.now()
      if (timer === null) {
        burstStartedAt = now
      } else {
        clearTimeout(timer)
      }
      const remainingMax = Math.max(0, burstStartedAt + maxDelayMs - now)
      timer = setTimeout(fire, Math.min(delayMs, remainingMax))
    },
    run() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (inFlight) {
        queued = true
        return new Promise<void>((resolve) => waiters.push(resolve))
      }
      return start()
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      queued = false
      guard.invalidate()
      if (inFlight === null) settleWaiters()
    },
    invalidate() {
      guard.invalidate()
    },
  }
}

/**
 * React binding for `createLatestRefetchRunner`. `load` may change identity
 * every render (it usually closes over props/state); the runner always calls
 * the most recent one.
 *
 * `delayMs` is read once -- every call site in this app passes a module
 * constant. Load failures are swallowed (matching what these hooks did
 * before): a dropped refetch is recovered by the next Realtime event or
 * poll tick, and the pure factory is where an `onError` can be supplied.
 */
export function useLatestRefetch(load: LatestRefetchLoad, delayMs: number): LatestRefetchRunner {
  // useState's lazy initialiser (not useMemo) -- React may discard a useMemo
  // result, and this runner owns a timer and in-flight state.
  const [runner] = useState(() => createLatestRefetchRunner(load, delayMs))

  // Published from an effect, not during render, so a render that never
  // commits can't install its closure. This effect is declared inside the
  // hook, so it always runs before the calling component's own effects
  // (React runs effects in declaration order) -- a mount fetch in the same
  // component therefore still sees the current render's load.
  useEffect(() => {
    runner.setLoad(load)
  })

  // `cancel()` (not a permanent dispose) so React Strict Mode's
  // mount/unmount/remount cycle leaves a reusable runner behind.
  useEffect(() => {
    return () => runner.cancel()
  }, [runner])

  return runner
}
