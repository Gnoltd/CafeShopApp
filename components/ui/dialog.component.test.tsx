import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./dialog"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `Dialog.${key}`,
}))

describe("ConfirmDialog keyboard behavior", () => {
  it("exposes its accessible name and closes with Escape", async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete menu item"
        description="This cannot be undone"
        onConfirm={vi.fn()}
      />
    )

    const dialog = await screen.findByRole("dialog", { name: "Delete menu item" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleDescription("This cannot be undone")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
