import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LoginForm } from "./login-form"

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  push: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword },
  }),
}))

vi.mock("@/lib/get-current-role", () => ({
  getCurrentRole: vi.fn().mockResolvedValue("customer"),
}))

describe("LoginForm", () => {
  beforeEach(() => {
    mocks.signInWithPassword.mockReset()
    mocks.push.mockReset()
  })

  it("signs in with the entered email/password", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null })
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText("Auth.emailLabel"), "staff@example.com")
    await user.type(screen.getByLabelText("Auth.passwordLabel"), "s3cret-pass")
    await user.click(screen.getByRole("button", { name: "Auth.login" }))

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "staff@example.com",
      password: "s3cret-pass",
    })
  })

  it("shows a recoverable error and re-enables submit when sign-in fails", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: null, error: new Error("invalid credentials") })
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText("Auth.emailLabel"), "staff@example.com")
    await user.type(screen.getByLabelText("Auth.passwordLabel"), "wrong-pass")
    const button = screen.getByRole("button", { name: "Auth.login" })
    await user.click(button)

    expect(await screen.findByRole("alert")).toHaveTextContent("Auth.loginError: invalid credentials")
    expect(button).toBeEnabled()
  })
})
