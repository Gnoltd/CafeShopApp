// Shared VNPay signing/verification, used by both outbound checkout-URL
// construction (place-order, pay-order) and inbound signature
// verification (vnpay-ipn, vnpay-return). Was previously copy-pasted
// across all four functions — the vnpayEncode PHP-urlencode() bug (fixed
// 2026-07-07) was "shared" only by copy-paste, not by import, so a future
// fix could patch some copies and miss others. Import from here instead.

// VNPay signs with PHP urlencode()-style encoding — spaces become "+",
// not "%20" like encodeURIComponent's default. Confirmed by comparing
// against a known-working reference implementation after live sandbox
// testing showed "Invalid signature" on VNPay's own payment page (i.e.
// before ever reaching our code again) — vnp_OrderInfo contains spaces,
// so plain encodeURIComponent silently produced a wrong hash.
export function vnpayEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+")
}

/** The caller's real IP for VNPay's vnp_IpAddr field -- the same one-liner was previously copy-pasted into both place-order and pay-order. */
export function extractClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
}

/** VNPay always redirects here after a checkout attempt, regardless of whether it was built by place-order or pay-order. */
export function buildVnpayReturnUrl(orderId: string, locale: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?orderId=${orderId}&locale=${locale}`
}

/** Sibling of buildVnpayReturnUrl for the aggregate Check Bill charge -- carries no orderId, since the trusted identity travels in vnp_TxnRef's "session:" prefix, not this URL's query params. */
export function buildVnpayReturnUrlForTableSession(locale: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/vnpay-return?locale=${locale}`
}

async function hmacSha512Hex(signString: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  )
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signString))
  return Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function signVnpayParams(params: Record<string, string>, secret: string): Promise<string> {
  const sortedKeys = Object.keys(params).sort()
  const signString = sortedKeys.map((k) => `${k}=${vnpayEncode(params[k])}`).join("&")
  return hmacSha512Hex(signString, secret)
}

// extraExcludedKeys covers a genuine per-caller difference, not
// accidental drift: vnpay-return's URL carries orderId/locale query
// params (added by place-order's returnUrl construction) that aren't
// part of VNPay's own signed param set, so vnpay-return excludes them
// too. vnpay-ipn is called directly by VNPay's servers with only vnp_*
// params, so it passes no extra exclusions.
export async function verifyVnpaySignature(
  params: URLSearchParams,
  secret: string,
  extraExcludedKeys: string[] = []
): Promise<boolean> {
  const received = params.get("vnp_SecureHash")
  if (!received) return false
  const excluded = new Set(["vnp_SecureHash", "vnp_SecureHashType", ...extraExcludedKeys])
  const entries = Array.from(params.entries()).filter(([k]) => !excluded.has(k))
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signString = entries.map(([k, v]) => `${k}=${vnpayEncode(v)}`).join("&")
  const computed = await hmacSha512Hex(signString, secret)
  if (computed.length !== received.length) return false
  let mismatch = 0
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return mismatch === 0
}

const VNPAY_GATEWAY_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"

// yyyyMMddHHmmss in Asia/Ho_Chi_Minh time — VNPay requires this exact
// format and timezone regardless of where this function actually runs.
function toVnpayDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`
}

export async function buildVnpayCheckoutUrl(params: {
  orderId: string
  total: number
  ipAddr: string
  locale: string
  returnUrl: string
}): Promise<string> {
  const now = new Date()
  const expire = new Date(now.getTime() + 15 * 60 * 1000)
  const vnpParams: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: Deno.env.get("VNPAY_TMN_CODE")!,
    // VNPay's own convention: amount is always x100, regardless of
    // currency having no subdivision — the OPPOSITE of the zero-decimal
    // VND handling used for Stripe. Do not "fix" this to match.
    vnp_Amount: String(params.total * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: params.orderId,
    vnp_OrderInfo: `Thanh toan don hang ${params.orderId}`,
    vnp_OrderType: "other",
    vnp_Locale: params.locale === "vi" ? "vn" : "en",
    vnp_ReturnUrl: params.returnUrl,
    vnp_IpAddr: params.ipAddr,
    vnp_CreateDate: toVnpayDateString(now),
    vnp_ExpireDate: toVnpayDateString(expire),
  }
  const secureHash = await signVnpayParams(vnpParams, Deno.env.get("VNPAY_HASH_SECRET")!)
  const query = Object.keys(vnpParams)
    .sort()
    .map((k) => `${k}=${vnpayEncode(vnpParams[k])}`)
    .join("&")
  return `${VNPAY_GATEWAY_URL}?${query}&vnp_SecureHash=${secureHash}`
}

// Sibling of buildVnpayCheckoutUrl for the aggregate "Check Bill" charge
// (docs/superpowers/specs/2026-08-28-shared-table-ordering-session-design.md,
// Section 6) -- a separate function rather than widening the existing
// one's params, so place-order/pay-order's call sites need no changes.
// vnp_TxnRef gets a "session:" prefix so vnpay-ipn/vnpay-return can
// tell an aggregate charge apart from a plain order id (both are raw
// UUIDs otherwise) -- see those functions' own comments for the parse
// side of this convention.
export async function buildVnpayCheckoutUrlForTableSession(params: {
  tableSessionId: string
  total: number
  ipAddr: string
  locale: string
  returnUrl: string
}): Promise<string> {
  const now = new Date()
  const expire = new Date(now.getTime() + 15 * 60 * 1000)
  const vnpParams: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: Deno.env.get("VNPAY_TMN_CODE")!,
    vnp_Amount: String(params.total * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: `session:${params.tableSessionId}`,
    vnp_OrderInfo: `Thanh toan ban ${params.tableSessionId}`,
    vnp_OrderType: "other",
    vnp_Locale: params.locale === "vi" ? "vn" : "en",
    vnp_ReturnUrl: params.returnUrl,
    vnp_IpAddr: params.ipAddr,
    vnp_CreateDate: toVnpayDateString(now),
    vnp_ExpireDate: toVnpayDateString(expire),
  }
  const secureHash = await signVnpayParams(vnpParams, Deno.env.get("VNPAY_HASH_SECRET")!)
  const query = Object.keys(vnpParams)
    .sort()
    .map((k) => `${k}=${vnpayEncode(vnpParams[k])}`)
    .join("&")
  return `${VNPAY_GATEWAY_URL}?${query}&vnp_SecureHash=${secureHash}`
}
