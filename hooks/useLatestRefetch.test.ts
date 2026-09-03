import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createSequenceGuard, createLatestRefetchRunner, type LoadContext } from "./useLatestRefetch"

// A deferred promise, so a test can decide exactly when (and in what order)
// each simulated network round trip resolves.
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Lets pending microtasks (the runner's internal promise chain) drain while
// fake timers are installed.
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe("createSequenceGuard", () => {
  it("applies results in the order they resolve when that order is correct", () => {
    const guard = createSequenceGuard()
    const first = guard.begin()
    const second = guard.begin()
    expect(first.isStale()).toBe(false)
    expect(second.isStale()).toBe(false)
  })

  it("discards an older run that resolves after a newer one (latest wins)", async () => {
    const guard = createSequenceGuard()
    const store: string[] = []

    const slow = deferred<string>()
    const fast = deferred<string>()

    async function load(value: Promise<string>, ctx: LoadContext) {
      const result = await value
      if (ctx.isStale()) return
      store.push(result)
    }

    // Two genuinely overlapping loads: #1 started first, #2 started second.
    const runA = load(slow.promise, guard.begin())
    const runB = load(fast.promise, guard.begin())

    // ...but the *newer* one comes back first.
    fast.resolve("newer")
    await runB
    // ...and the older one straggles in afterwards.
    slow.resolve("older")
    await runA

    expect(store).toEqual(["newer"])
  })

  it("is idempotent for repeated isStale() calls from the same run", () => {
    const guard = createSequenceGuard()
    const ctx = guard.begin()
    expect(ctx.isStale()).toBe(false)
    expect(ctx.isStale()).toBe(false)
  })

  it("invalidate() marks every in-flight run stale", () => {
    const guard = createSequenceGuard()
    const inFlight = guard.begin()
    guard.invalidate()
    expect(inFlight.isStale()).toBe(true)
    // A run started after the invalidation is still allowed to apply.
    expect(guard.begin().isStale()).toBe(false)
  })
})

describe("createLatestRefetchRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("coalesces a burst of triggers into a single load", async () => {
    const load = vi.fn(async () => {})
    const runner = createLatestRefetchRunner(load, 300)

    // e.g. one `orders` INSERT + five `order_items` INSERTs from the same
    // round, all delivered within a few milliseconds of each other.
    for (let i = 0; i < 6; i++) {
      runner.trigger()
      vi.advanceTimersByTime(5)
    }
    expect(load).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("debounces (trailing edge), not throttles", async () => {
    const load = vi.fn(async () => {})
    const runner = createLatestRefetchRunner(load, 300)

    runner.trigger()
    vi.advanceTimersByTime(299)
    runner.trigger()
    vi.advanceTimersByTime(299)
    expect(load).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("cannot be starved forever by a continuous event stream (maxDelayMs)", async () => {
    const load = vi.fn(async () => {})
    const runner = createLatestRefetchRunner(load, 300, { maxDelayMs: 900 })

    // A trigger every 100ms would push a pure debounce out indefinitely.
    for (let i = 0; i < 20; i++) {
      runner.trigger()
      vi.advanceTimersByTime(100)
      await flush()
    }
    expect(load.mock.calls.length).toBeGreaterThan(0)
  })

  it("never runs two loads in parallel and queues at most one follow-up", async () => {
    const gates: ReturnType<typeof deferred<void>>[] = []
    let active = 0
    let maxActive = 0
    const load = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      const gate = deferred<void>()
      gates.push(gate)
      await gate.promise
      active--
    })

    const runner = createLatestRefetchRunner(load, 300)

    runner.trigger()
    vi.advanceTimersByTime(300)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    // Three more bursts arrive while the first load is still in flight.
    for (let i = 0; i < 3; i++) {
      runner.trigger()
      vi.advanceTimersByTime(300)
      await flush()
    }
    expect(load).toHaveBeenCalledTimes(1)
    expect(maxActive).toBe(1)

    gates[0].resolve()
    await flush()
    // Exactly one queued follow-up, not three.
    expect(load).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)

    gates[1].resolve()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("serialises the mount fetch (run) against realtime triggers, newest state last", async () => {
    const gates: ReturnType<typeof deferred<void>>[] = []
    const applied: number[] = []
    let call = 0
    const load = vi.fn(async (ctx: LoadContext) => {
      const id = ++call
      const gate = deferred<void>()
      gates.push(gate)
      await gate.promise
      if (ctx.isStale()) return
      applied.push(id)
    })

    const runner = createLatestRefetchRunner(load, 300)

    // Mount fetch, slow.
    const mountRun = runner.run()
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    // A realtime burst arrives while the mount fetch is still open.
    runner.trigger()
    vi.advanceTimersByTime(300)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    gates[0].resolve()
    await mountRun
    await flush()
    expect(load).toHaveBeenCalledTimes(2)

    gates[1].resolve()
    await flush()
    expect(applied).toEqual([1, 2])
  })

  it("discards an in-flight load's result once cancelled (unmount)", async () => {
    const gate = deferred<void>()
    const applied: string[] = []
    const load = vi.fn(async (ctx: LoadContext) => {
      await gate.promise
      if (ctx.isStale()) return
      applied.push("applied")
    })

    const runner = createLatestRefetchRunner(load, 300)
    void runner.run()
    await flush()

    runner.cancel()
    gate.resolve()
    await flush()

    expect(applied).toEqual([])
  })

  it("resolves run() only after a run started at-or-after the call finishes", async () => {
    const gates: ReturnType<typeof deferred<void>>[] = []
    const load = vi.fn(async () => {
      const gate = deferred<void>()
      gates.push(gate)
      await gate.promise
    })
    const runner = createLatestRefetchRunner(load, 300)

    void runner.run()
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    // A second run() (e.g. the user switched tables) while the first is open.
    let secondResolved = false
    void runner.run().then(() => {
      secondResolved = true
    })
    await flush()
    expect(secondResolved).toBe(false)

    // The first load finishing is NOT enough -- the caller asked for fresh data.
    gates[0].resolve()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(secondResolved).toBe(false)

    gates[1].resolve()
    await flush()
    expect(secondResolved).toBe(true)
  })

  it("calls the most recently published load body (setLoad)", async () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    const runner = createLatestRefetchRunner(first, 300)

    runner.setLoad(second)
    runner.trigger()
    vi.advanceTimersByTime(300)
    await flush()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("drops a pending trigger on cancel", async () => {
    const load = vi.fn(async () => {})
    const runner = createLatestRefetchRunner(load, 300)
    runner.trigger()
    runner.cancel()
    vi.advanceTimersByTime(1000)
    await flush()
    expect(load).not.toHaveBeenCalled()
  })

  it("reports a load failure and keeps accepting later triggers", async () => {
    const onError = vi.fn()
    let shouldFail = true
    const load = vi.fn(async () => {
      if (shouldFail) {
        shouldFail = false
        throw new Error("network down")
      }
    })
    const runner = createLatestRefetchRunner(load, 300, { onError })

    runner.trigger()
    vi.advanceTimersByTime(300)
    await flush()
    expect(onError).toHaveBeenCalledTimes(1)

    runner.trigger()
    vi.advanceTimersByTime(300)
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
