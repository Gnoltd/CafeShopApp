import { describe, it, expect } from "vitest"
import { loadingState, dataState, emptyState, errorState, staleState } from "./async-state"

describe("AsyncViewState factories", () => {
  it("loadingState() produces a status-only loading state", () => {
    expect(loadingState()).toEqual({ status: "loading" })
  })

  it("dataState(data) carries the given data under status 'data'", () => {
    expect(dataState({ id: 1 })).toEqual({ status: "data", data: { id: 1 } })
  })

  it("emptyState() produces a status-only empty state", () => {
    expect(emptyState()).toEqual({ status: "empty" })
  })

  it("errorState() defaults to an undefined error payload", () => {
    expect(errorState()).toEqual({ status: "error", error: undefined })
  })

  it("errorState(error) carries the given error", () => {
    const err = new Error("boom")
    expect(errorState(err)).toEqual({ status: "error", error: err })
  })

  it("staleState(data) retains the last-good data alongside status 'stale'", () => {
    expect(staleState([1, 2, 3])).toEqual({ status: "stale", data: [1, 2, 3], error: undefined })
  })

  it("staleState(data, error) retains both the last-good data and the refresh failure", () => {
    const err = new Error("refresh failed")
    expect(staleState("last-good", err)).toEqual({ status: "stale", data: "last-good", error: err })
  })

  it("data and stale carry independently distinguishable statuses even with identical data", () => {
    const good = dataState("x")
    const outdated = staleState("x")
    expect(good.status).toBe("data")
    expect(outdated.status).toBe("stale")
    expect(good).not.toEqual(outdated)
  })
})
