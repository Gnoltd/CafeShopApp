// Shared Stripe Checkout Session creation, used by both place-order (at
// order-placement time) and pay-order (deferred payment-method choice).
// Uses raw fetch against Stripe's REST API (form-urlencoded, per
// Stripe's API convention) rather than an SDK, matching this project's
// dependency-free edge functions.

// Flattens a nested object into Stripe's bracket-notation form fields,
// e.g. { line_items: [{ quantity: 1 }] } -> "line_items[0][quantity]=1".
// Stripe's REST API expects application/x-www-form-urlencoded bodies,
// not JSON.
function flattenForStripe(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenForStripe(item, `${prefix}[${i}]`, out))
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      flattenForStripe(v, prefix ? `${prefix}[${key}]` : key, out)
    }
  } else if (value !== undefined && value !== null) {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
  }
}

export async function createStripeCheckoutSession(params: {
  orderId: string
  total: number
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string } | { error: string }> {
  const body: string[] = []
  flattenForStripe(
    {
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Stripe's minimum allowed Checkout Session lifetime (30 minutes) —
      // chosen over the 24h default so an abandoned session doesn't leave
      // a pending_payment order sitting around for a full day.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { order_id: params.orderId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "vnd",
            // VND is zero-decimal in Stripe — pass the integer total as-is.
            unit_amount: params.total,
            product_data: { name: "PhaDinCafe Order" },
          },
        },
      ],
    },
    "",
    body
  )

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")!}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.join("&"),
  })

  const json = await response.json()
  if (!response.ok) {
    return { error: json?.error?.message ?? "Stripe rejected the checkout session" }
  }
  return { url: json.url as string }
}
