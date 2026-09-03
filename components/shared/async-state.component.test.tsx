import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AsyncStateView, staleState } from "./async-state"

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

describe("AsyncStateView stale-data presentation", () => {
  it("keeps last-good data visible, labels it stale, and offers recovery", async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(
      <AsyncStateView
        state={staleState({ orderNumber: "A-17" }, new Error("realtime disconnected"))}
        onRetry={retry}
        renderData={(data) => <p>Order {data.orderNumber}</p>}
      />
    )

    expect(screen.getByText("Order A-17")).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("AsyncState.staleNotice")
    await user.click(screen.getByRole("button", { name: "AsyncState.retryButton" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
