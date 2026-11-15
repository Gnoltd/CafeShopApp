import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StaffAccounts } from "./staff-accounts"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  updateEq: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  removeChannel: vi.fn(),
  realtimeHandlers: [] as Array<() => void>,
}))

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const client = {
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
      from: () => ({ update: mocks.update }),
      functions: { invoke: mocks.invoke },
      channel: vi.fn(() => {
        const channel = {
          on: vi.fn((_type: string, _filter: unknown, callback: () => void) => {
            mocks.realtimeHandlers.push(callback)
            return channel
          }),
          subscribe: vi.fn((cb?: (status: string) => void) => {
            cb?.("SUBSCRIBED")
            return channel
          }),
        }
        return channel
      }),
      removeChannel: mocks.removeChannel,
    }
    return client
  },
}))

function makeStaffRow(index: number, overrides: Partial<{ id: string; full_name: string; role: string; is_active: boolean; email: string }> = {}) {
  return {
    id: overrides.id ?? `staff-${index}`,
    full_name: overrides.full_name ?? `Staff Member ${index}`,
    phone: null,
    role: overrides.role ?? "staff",
    is_active: overrides.is_active ?? true,
    email: overrides.email ?? `staff${index}@phadincafe.vn`,
  }
}

describe("StaffAccounts", () => {
  beforeEach(() => {
    mocks.getUser.mockReset()
    mocks.rpc.mockReset()
    mocks.updateEq.mockReset()
    mocks.update.mockReset()
    mocks.invoke.mockReset()
    mocks.removeChannel.mockReset()
    mocks.realtimeHandlers.length = 0

    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-1" } } })
    mocks.updateEq.mockResolvedValue({ error: null })
    mocks.update.mockImplementation(() => ({ eq: mocks.updateEq }))
  })

  it("loads staff, disables self-deactivation, and paginates beyond 5 rows", async () => {
    const rows = Array.from({ length: 6 }, (_, idx) =>
      makeStaffRow(idx + 1, {
        role: idx === 0 ? "admin" : idx === 1 ? "manager" : "staff",
        is_active: idx !== 2,
      })
    )
    mocks.rpc.mockResolvedValue({ data: rows, error: null })

    render(<StaffAccounts />)

    const table = await screen.findByRole("table")
    expect(within(table).getByText("Staff Member 1")).toBeInTheDocument()
    expect(within(table).getByText("Staff Member 5")).toBeInTheDocument()
    expect(within(table).queryByText("Staff Member 6")).not.toBeInTheDocument()
    expect(screen.getAllByText('AdminStaff.showingItems:{"start":1,"end":5,"total":6}')).toHaveLength(2)

    // Current user's toggle button in the desktop row is disabled.
    const row1 = within(table).getByText("Staff Member 1").closest("tr")!
    const row1Buttons = within(row1).getAllByRole("button")
    expect(row1Buttons[1]).toBeDisabled()

    // Navigate to page 2.
    fireEvent.click(screen.getAllByRole("button", { name: "AdminStaff.next" })[0])
    expect(within(table).getByText("Staff Member 6")).toBeInTheDocument()
    expect(within(table).queryByText("Staff Member 1")).not.toBeInTheDocument()
  })

  it("surfaces loadError via useLatestRefetch onError, recovers via realtime, and retains last-good rows on refetch failure", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("initial outage"))

    const { unmount } = render(<StaffAccounts />)

    expect(await screen.findByText("AdminStaff.loadError")).toBeInTheDocument()
    expect(mocks.realtimeHandlers).toHaveLength(1)

    // Realtime profiles change triggers refetch and clears the error banner.
    mocks.rpc.mockResolvedValueOnce({ data: [makeStaffRow(1), makeStaffRow(2)], error: null })
    await act(async () => {
      mocks.realtimeHandlers[0]()
    })

    const table = screen.getByRole("table")
    await waitFor(() => {
      expect(within(table).getByText("Staff Member 2")).toBeInTheDocument()
    })
    expect(screen.queryByText("AdminStaff.loadError")).not.toBeInTheDocument()

    // Subsequent realtime refetch failure surfaces loadError without wiping visible rows.
    mocks.rpc.mockRejectedValueOnce(new Error("transient glitch"))
    await act(async () => {
      mocks.realtimeHandlers[0]()
    })

    expect(await screen.findByText("AdminStaff.loadError")).toBeInTheDocument()
    expect(within(table).getByText("Staff Member 2")).toBeInTheDocument()

    unmount()
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1)
  })

  it("toggles active status and creates a new staff account showing its temporary password", async () => {
    mocks.rpc.mockResolvedValue({ data: [makeStaffRow(1), makeStaffRow(2, { is_active: true })], error: null })
    mocks.invoke.mockResolvedValue({
      data: { userId: "staff-new", temporaryPassword: "TempPass!99" },
      error: null,
    })

    const user = userEvent.setup()
    render(<StaffAccounts />)

    const table = await screen.findByRole("table")
    const row2 = within(table).getByText("Staff Member 2").closest("tr")!
    const toggleBtn = within(row2).getAllByRole("button")[1]
    await user.click(toggleBtn)

    expect(mocks.update).toHaveBeenCalledWith({
      full_name: "Staff Member 2",
      role: "staff",
      is_active: false,
    })
    expect(mocks.updateEq).toHaveBeenCalledWith("id", "staff-2")

    // Add staff flow.
    await user.click(screen.getByRole("button", { name: "AdminStaff.addStaff" }))
    const dialog = await screen.findByRole("dialog")
    const textboxes = within(dialog).getAllByRole("textbox")
    await user.type(textboxes[0], "New Barista")
    await user.type(textboxes[1], "barista@phadincafe.vn")
    await user.click(within(dialog).getByRole("button", { name: "AdminStaff.save" }))

    expect(mocks.invoke).toHaveBeenCalledWith("create-staff-account", {
      body: {
        fullName: "New Barista",
        email: "barista@phadincafe.vn",
        role: "staff",
      },
    })
    expect(await screen.findByText("TempPass!99")).toBeInTheDocument()
  })

  it("shows saveError when toggling active fails", async () => {
    mocks.rpc.mockResolvedValue({ data: [makeStaffRow(1), makeStaffRow(2)], error: null })
    mocks.updateEq.mockResolvedValueOnce({ error: new Error("permission denied") })

    const user = userEvent.setup()
    render(<StaffAccounts />)

    const table = await screen.findByRole("table")
    const row2 = within(table).getByText("Staff Member 2").closest("tr")!
    await user.click(within(row2).getAllByRole("button")[1])

    expect(await screen.findByText("AdminStaff.saveError")).toBeInTheDocument()
  })
})
