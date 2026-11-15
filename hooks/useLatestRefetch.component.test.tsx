import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLatestAsyncLoad, useLatestRefetch } from "./useLatestRefetch"

describe("useLatestRefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("preserves 2-arg compatibility and forwards maxDelayMs and latest onError closures", async () => {
    const errorsV1: string[] = []
    const errorsV2: string[] = []
    let fail = true

    const { result, rerender } = renderHook(
      ({ label }: { label: string }) =>
        useLatestRefetch(
          async () => {
            if (fail) throw new Error("boom")
          },
          100,
          {
            maxDelayMs: 250,
            onError: (err) => {
              const target = label === "v1" ? errorsV1 : errorsV2
              target.push(`${label}:${(err as Error).message}`)
            },
          }
        ),
      { initialProps: { label: "v1" } }
    )

    const initialRunner = result.current

    rerender({ label: "v2" })
    expect(result.current).toBe(initialRunner)

    await act(async () => {
      await result.current.run()
    })

    expect(errorsV1).toEqual([])
    expect(errorsV2).toEqual(["v2:boom"])

    fail = false
    // Continuous burst faster than delayMs=100 still fires within maxDelayMs=250.
    const loadSpy = vi.fn(async () => {})
    const burst = renderHook(() => useLatestRefetch(loadSpy, 100, { maxDelayMs: 250 }))
    for (let i = 0; i < 4; i++) {
      act(() => burst.result.current.trigger())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(75)
      })
    }
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })
})

describe("useLatestAsyncLoad", () => {
  it("manages initial load, blocking retry recovery, stale preservation, and reset invalidation", async () => {
    let outcome: "success" | "fail" = "fail"
    const applied: string[] = []
    let pendingResolve: (() => void) | null = null

    const { result, rerender } = renderHook(
      ({ token }: { token: string }) =>
        useLatestAsyncLoad(
          async ({ isStale }) => {
            if (token === "slow") {
              await new Promise<void>((resolve) => {
                pendingResolve = resolve
              })
            }
            if (outcome === "fail") throw new Error("offline")
            if (isStale()) return
            applied.push(token)
          },
          0
        ),
      { initialProps: { token: "t1" } }
    )

    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      await result.current.loadWithSpinner()
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.hasBlockingError).toBe(true)
    expect(result.current.hasStaleData).toBe(false)
    expect(result.current.hasLoadedOnce).toBe(false)

    outcome = "success"
    await act(async () => {
      await result.current.loadWithSpinner()
    })
    expect(result.current.hasBlockingError).toBe(false)
    expect(result.current.hasStaleData).toBe(false)
    expect(result.current.hasLoadedOnce).toBe(true)
    expect(applied).toEqual(["t1"])

    // Background failure after prior success sets stale without blocking.
    outcome = "fail"
    await act(async () => {
      await result.current.run()
    })
    expect(result.current.hasBlockingError).toBe(false)
    expect(result.current.hasStaleData).toBe(true)
    expect(result.current.hasLoadedOnce).toBe(true)

    // Recovery clears staleness.
    outcome = "success"
    await act(async () => {
      await result.current.run()
    })
    expect(result.current.hasStaleData).toBe(false)

    // In-flight load invalidated by reset() does not mark new token as loaded.
    rerender({ token: "slow" })
    const inFlightPromise = result.current.loadWithSpinner()
    await act(async () => {
      await Promise.resolve()
    })
    rerender({ token: "t2" })
    act(() => {
      result.current.reset()
    })
    expect(result.current.hasLoadedOnce).toBe(false)

    outcome = "fail"
    await act(async () => {
      pendingResolve?.()
      await inFlightPromise
    })
    // Stale failure from invalidated "slow" run must not surface on "t2".
    expect(result.current.hasBlockingError).toBe(false)
    expect(result.current.hasLoadedOnce).toBe(false)
  })

  it("does not mark hasLoadedOnce when enabled is false", async () => {
    const load = vi.fn(async () => {})
    const { result } = renderHook(() => useLatestAsyncLoad(load, 0, { enabled: false }))

    await act(async () => {
      await result.current.loadWithSpinner()
    })

    expect(load).not.toHaveBeenCalled()
    expect(result.current.hasLoadedOnce).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })
})
