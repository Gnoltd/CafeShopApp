import { describe, it, expect } from "vitest"
import { nextAsyncLoadFlags } from "./async-refetch-flags"

describe("nextAsyncLoadFlags", () => {
  it("a first-ever load succeeding clears both flags", () => {
    expect(nextAsyncLoadFlags(false, "success")).toEqual({ hasBlockingError: false, hasStaleData: false })
  })

  it("a first-ever load failing is a blocking error, not stale (nothing good to show yet)", () => {
    expect(nextAsyncLoadFlags(false, "failure")).toEqual({ hasBlockingError: true, hasStaleData: false })
  })

  it("a refetch failing after a prior success retains-and-flags-stale, never blocks", () => {
    expect(nextAsyncLoadFlags(true, "failure")).toEqual({ hasBlockingError: false, hasStaleData: true })
  })

  it("a refetch succeeding after a prior success stays clear", () => {
    expect(nextAsyncLoadFlags(true, "success")).toEqual({ hasBlockingError: false, hasStaleData: false })
  })

  it("recovery: stale -> success clears staleness (the caller re-applies hasLoadedOnce=true before this call)", () => {
    // Simulates the sequence a hook actually drives: fail once while loaded
    // (stale), then succeed again.
    const afterFailure = nextAsyncLoadFlags(true, "failure")
    expect(afterFailure.hasStaleData).toBe(true)
    const afterRecovery = nextAsyncLoadFlags(true, "success")
    expect(afterRecovery).toEqual({ hasBlockingError: false, hasStaleData: false })
  })
})
