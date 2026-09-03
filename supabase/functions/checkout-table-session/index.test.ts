import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createStripeCheckoutSessionForTableSession: vi.fn(),
  buildVnpayCheckoutUrlForTableSession: vi.fn(),
  buildVnpayReturnUrlForTableSession: vi.fn(() => "https://functions.example/vnpay-return"),
  extractClientIp: vi.fn(() => "203.0.113.7"),
  rateLimitOrNull: vi.fn(async () => null),
}))

vi.mock("jsr:@supabase/supabase-js@2", () => ({ createClient: mocks.createClient }))
vi.mock("../_shared/stripe.ts", () => ({
  createStripeCheckoutSessionForTableSession: mocks.createStripeCheckoutSessionForTableSession,
}))
vi.mock("../_shared/vnpay.ts", () => ({
  buildVnpayCheckoutUrlForTableSession: mocks.buildVnpayCheckoutUrlForTableSession,
  buildVnpayReturnUrlForTableSession: mocks.buildVnpayReturnUrlForTableSession,
  extractClientIp: mocks.extractClientIp,
}))
vi.mock("../_shared/rate-limit.ts", () => ({ rateLimitOrNull: mocks.rateLimitOrNull }))

let handler: (request: Request) => Promise<Response>
const env = new Map<string, string>()

vi.stubGlobal("Deno", {
  env: { get: (name: string) => env.get(name) },
  serve: vi.fn((registeredHandler: typeof handler) => {
    handler = registeredHandler
  }),
})

await import("./index.ts")

function request(method: "stripe" | "vnpay") {
  return new Request("https://functions.example/checkout-table-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrToken: "table-secret", method, locale: "en" }),
  })
}

function checkoutResult(attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  return {
    data: {
      tableSessionId: "session-1",
      orderIds: ["order-1"],
      chargeTotal: 125000,
      checkoutAttemptId: attemptId,
    },
    error: null,
  }
}

function checkoutResultWithUrl() {
  const result = checkoutResult()
  result.data.checkoutSessionUrl = "https://checkout.stripe.example/existing"
  return result
}

describe("checkout-table-session recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.clear()
    env.set("SUPABASE_URL", "https://project.supabase.co")
    env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    env.set("SITE_URL", "https://cafe.example")
  })

  it("releases the same checkout attempt when Stripe rejects session creation", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })
    mocks.createStripeCheckoutSessionForTableSession.mockResolvedValue({ error: "Stripe unavailable" })
    env.set("STRIPE_SECRET_KEY", "stripe-secret")

    const response = await handler(request("stripe"))

    expect(response.status).toBe(400)
    expect(rpc).toHaveBeenLastCalledWith("release_table_checkout", {
      p_qr_token: "table-secret",
      p_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("releases the same checkout attempt when Stripe times out", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })
    mocks.createStripeCheckoutSessionForTableSession.mockRejectedValue(new Error("timeout"))
    env.set("STRIPE_SECRET_KEY", "stripe-secret")

    const response = await handler(request("stripe"))

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenLastCalledWith("release_table_checkout", {
      p_qr_token: "table-secret",
      p_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("releases the same checkout attempt when the Stripe secret is missing", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })

    const response = await handler(request("stripe"))

    expect(response.status).toBe(500)
    expect(mocks.createStripeCheckoutSessionForTableSession).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith("release_table_checkout", {
      p_qr_token: "table-secret",
      p_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("logs a resolved recovery RPC error without exposing it in the response", async () => {
    const recoveryError = { message: "database detail that must stay internal" }
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: null, error: recoveryError })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.createClient.mockReturnValue({ rpc })

    const response = await handler(request("stripe"))
    const body = await response.json()

    expect(consoleError).toHaveBeenCalledWith(
      "Table checkout recovery failed",
      expect.objectContaining({
        attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        error: recoveryError,
      })
    )
    expect(body).toEqual({ error: "Unexpected error checking the bill" })
    expect(JSON.stringify(body)).not.toContain(recoveryError.message)
    consoleError.mockRestore()
  })

  it.each([
    ["missing secrets", undefined, undefined],
    ["gateway failure", "vnpay-code", "vnpay-secret"],
  ])("releases the same checkout attempt after a VNPay %s", async (_case, code, secret) => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })
    if (code) env.set("VNPAY_TMN_CODE", code)
    if (secret) env.set("VNPAY_HASH_SECRET", secret)
    mocks.buildVnpayCheckoutUrlForTableSession.mockRejectedValue(new Error("VNPay unavailable"))

    const response = await handler(request("vnpay"))

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenLastCalledWith("release_table_checkout", {
      p_qr_token: "table-secret",
      p_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("does not release a successful Stripe checkout attempt", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })
    mocks.createStripeCheckoutSessionForTableSession.mockResolvedValue({ url: "https://checkout.stripe.example/session" })
    env.set("STRIPE_SECRET_KEY", "stripe-secret")

    const response = await handler(request("stripe"))

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("releases the attempt when checkout URL persistence fails", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(checkoutResult())
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.createClient.mockReturnValue({ rpc })
    mocks.createStripeCheckoutSessionForTableSession.mockResolvedValue({ url: "https://checkout.stripe.example/session" })
    env.set("STRIPE_SECRET_KEY", "stripe-secret")

    const response = await handler(request("stripe"))

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenLastCalledWith("release_table_checkout", {
      p_qr_token: "table-secret",
      p_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
  })

  it("reuses a persisted hosted URL without creating another gateway session", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(checkoutResultWithUrl())
    mocks.createClient.mockReturnValue({ rpc })
    env.set("STRIPE_SECRET_KEY", "stripe-secret")

    const response = await handler(request("stripe"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ checkoutUrl: "https://checkout.stripe.example/existing" })
    expect(mocks.createStripeCheckoutSessionForTableSession).not.toHaveBeenCalled()
  })
})
