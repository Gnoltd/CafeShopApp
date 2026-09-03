import type { ComponentType, ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LoginForm } from "./login-form"
import { SignupForm } from "./signup-form"

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithOAuth: mocks.signInWithOAuth },
  }),
}))

describe.each([
  ["login", LoginForm as ComponentType],
  ["signup", SignupForm as ComponentType],
])("%s OAuth initiation", (_name, Form) => {
  beforeEach(() => {
    mocks.signInWithOAuth.mockReset()
  })

  it("shows a recoverable error and unlocks the Google button when initiation fails", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: null, error: new Error("provider unavailable") })
    const user = userEvent.setup()
    render(<Form />)

    const button = screen.getByRole("button", { name: "Auth.continueWithGoogle" })
    await user.click(button)

    expect(await screen.findByRole("alert")).toHaveTextContent("Auth.oauthStartError")
    expect(button).toBeEnabled()
  })
})
