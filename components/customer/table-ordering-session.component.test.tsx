import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TableOrderingSession } from "./table-ordering-session"

const mocks = vi.hoisted(() => ({ retryLoad: vi.fn() }))

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/hooks/useTableSession", () => ({
  useTableSession: () => ({ isLoading: false, hasLoadError: true, retryLoad: mocks.retryLoad }),
}))

describe("TableOrderingSession initial-load recovery", () => {
  it("renders a retry action instead of a false empty cart", async () => {
    const user = userEvent.setup()
    render(
      <TableOrderingSession
        table={{ id: "table-1", number: "T1", locationVi: "", locationEn: "", status: "occupied", scanCount: 0, cleaningNotifiedAt: null }}
        qrToken="secret-token"
        categories={[]}
        items={[]}
      />
    )

    await user.click(screen.getByRole("button", { name: "AsyncState.retryButton" }))
    expect(mocks.retryLoad).toHaveBeenCalledTimes(1)
  })
})
