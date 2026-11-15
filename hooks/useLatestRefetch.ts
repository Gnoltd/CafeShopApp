import { useCallback, useEffect, useRef, useState } from "react"

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

export type AsyncLoadOutcome = "success" | "failure"

export type AsyncLoadFlags = {
  hasBlockingError: boolean
  hasStaleData: boolean
}

/**
 * Pure state-transition shared by hooks that keep polling/subscribing for a
 * background refetch after their first successful load:
 * - `hasBlockingError`: never succeeded yet, so callers render a blocking retry state.
 * - `hasStaleData`: succeeded at least once before this failure, so callers keep
 *   rendering last-good data and flag it as possibly outdated.
 * A success always clears both flags outright.
 */
export function nextAsyncLoadFlags(hasLoadedOnce: boolean, outcome: AsyncLoadOutcome): AsyncLoadFlags {
  if (outcome === "success") return { hasBlockingError: false, hasStaleData: false }
  return hasLoadedOnce
    ? { hasBlockingError: false, hasStaleData: true }
    : { hasBlockingError: true, hasStaleData: false }
}

export type AsyncLoadSnapshot = AsyncLoadFlags & {
  hasLoadedOnce: boolean
  error: unknown | null
}

const INITIAL_ASYNC_LOAD_SNAPSHOT: AsyncLoadSnapshot = {
  hasLoadedOnce: false,
  hasBlockingError: false,
  hasStaleData: false,
  error: null,
}

export type AsyncLoadStateMachine = {
  getSnapshot: () => AsyncLoadSnapshot
  markSuccess: () => AsyncLoadSnapshot
  markFailure: (error: unknown) => AsyncLoadSnapshot
  clearErrors: () => AsyncLoadSnapshot
  reset: () => AsyncLoadSnapshot
}

/**
 * Pure stateful transition helper backing `useLatestAsyncLoad` (no React,
 * directly unit-testable in node). Preserves snapshot reference identity when
 * a transition produces no change.
 */
export function createAsyncLoadState(): AsyncLoadStateMachine {
  let snapshot: AsyncLoadSnapshot = INITIAL_ASYNC_LOAD_SNAPSHOT

  return {
    getSnapshot: () => snapshot,
    markSuccess() {
      if (
        snapshot.hasLoadedOnce &&
        !snapshot.hasBlockingError &&
        !snapshot.hasStaleData &&
        snapshot.error === null
      ) {
        return snapshot
      }
      snapshot = {
        ...nextAsyncLoadFlags(true, "success"),
        hasLoadedOnce: true,
        error: null,
      }
      return snapshot
    },
    markFailure(error: unknown) {
      snapshot = {
        ...nextAsyncLoadFlags(snapshot.hasLoadedOnce, "failure"),
        hasLoadedOnce: snapshot.hasLoadedOnce,
        error,
      }
      return snapshot
    },
    clearErrors() {
      if (!snapshot.hasBlockingError && !snapshot.hasStaleData && snapshot.error === null) {
        return snapshot
      }
      snapshot = {
        hasLoadedOnce: snapshot.hasLoadedOnce,
        hasBlockingError: false,
        hasStaleData: false,
        error: null,
      }
      return snapshot
    },
    reset() {
      snapshot = INITIAL_ASYNC_LOAD_SNAPSHOT
      return snapshot
    },
  }
}

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
  /** Replaces the `onError` handler so error closures stay fresh across renders. */
  setOnError: (onError: ((error: unknown) => void) | undefined) => void
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
  const { maxDelayMs = delayMs * 4 } = options
  const guard = createSequenceGuard()

  let load = initialLoad
  let onError = options.onError
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
          // Cancelled or superseded runs must not surface errors into newer state.
          if (!ctx.isStale()) onError?.(error)
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
    setOnError(next: ((error: unknown) => void) | undefined) {
      onError = next
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
 * React binding for `createLatestRefetchRunner`. `load` and `options.onError`
 * may change identity every render (they usually close over props/state); the
 * runner always invokes the most recently committed closures.
 *
 * `delayMs` and `options.maxDelayMs` are read once on mount. When `onError` is
 * omitted, load failures are swallowed (recovered by the next Realtime event or
 * poll tick).
 */
export function useLatestRefetch(
  load: LatestRefetchLoad,
  delayMs: number,
  options?: LatestRefetchOptions
): LatestRefetchRunner {
  // useState's lazy initialiser (not useMemo) -- React may discard a useMemo
  // result, and this runner owns a timer and in-flight state.
  const [runner] = useState(() => createLatestRefetchRunner(load, delayMs, options))

  // Published from an effect, not during render, so a render that never
  // commits can't install its closure. This effect is declared inside the
  // hook, so it always runs before the calling component's own effects
  // (React runs effects in declaration order) -- a mount fetch in the same
  // component therefore still sees the current render's load and onError.
  useEffect(() => {
    runner.setLoad(load)
    runner.setOnError(options?.onError)
  })

  // `cancel()` (not a permanent dispose) so React Strict Mode's
  // mount/unmount/remount cycle leaves a reusable runner behind.
  useEffect(() => {
    return () => runner.cancel()
  }, [runner])

  return runner
}

export type LatestAsyncLoadOptions = LatestRefetchOptions & {
  initialLoading?: boolean
  enabled?: boolean
}

export type LatestAsyncLoadResult = Omit<LatestRefetchRunner, "setLoad" | "setOnError"> &
  AsyncLoadSnapshot & {
    isLoading: boolean
    loadWithSpinner: () => Promise<void>
    reset: () => void
  }

/**
 * Cohesive async-load hook uniting `useLatestRefetch` with `hasLoadedOnce`,
 * blocking-error vs stale-data flags, loading spinner lifecycle, and reset
 * invalidation so call sites avoid duplicating `hasLoadedOnceRef` boilerplate.
 */
export function useLatestAsyncLoad(
  load: LatestRefetchLoad,
  delayMs: number,
  options?: LatestAsyncLoadOptions
): LatestAsyncLoadResult {
  const enabled = options?.enabled ?? true
  const [machine] = useState(() => createAsyncLoadState())
  const [snapshot, setSnapshot] = useState<AsyncLoadSnapshot>(() => machine.getSnapshot())
  const [isLoading, setIsLoading] = useState(options?.initialLoading ?? true)
  const mountedRef = useRef(false)
  const loadingTicketRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runner = useLatestRefetch(
    async (ctx) => {
      if (!enabled) return
      await load(ctx)
      if (ctx.isStale()) return
      const next = machine.markSuccess()
      if (mountedRef.current) setSnapshot(next)
    },
    delayMs,
    {
      maxDelayMs: options?.maxDelayMs,
      onError: (error) => {
        const next = machine.markFailure(error)
        if (mountedRef.current) setSnapshot(next)
        options?.onError?.(error)
      },
    }
  )

  const loadWithSpinner = useCallback(async () => {
    const ticket = ++loadingTicketRef.current
    if (mountedRef.current) {
      setIsLoading(true)
      setSnapshot(machine.clearErrors())
    }
    try {
      await runner.run()
    } finally {
      if (mountedRef.current && loadingTicketRef.current === ticket) {
        setIsLoading(false)
      }
    }
  }, [machine, runner])

  const reset = useCallback(() => {
    ++loadingTicketRef.current
    runner.invalidate()
    const next = machine.reset()
    if (mountedRef.current) setSnapshot(next)
  }, [machine, runner])

  return {
    trigger: runner.trigger,
    run: runner.run,
    cancel: runner.cancel,
    invalidate: runner.invalidate,
    loadWithSpinner,
    reset,
    isLoading,
    ...snapshot,
  }
}
