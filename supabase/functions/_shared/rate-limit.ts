// Shared per-IP rate limiting for the guest-callable, verify_jwt-disabled
// Edge Functions (place-order, pay-order) -- see migration
// 0057_edge_rate_limiting.sql for why this is a DB-backed counter rather
// than an in-memory one (Deno Deploy runs multiple isolate instances, so
// in-memory state per instance doesn't add up to a real global limit).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2"

/**
 * Returns true if the request should proceed, false if the caller has hit
 * the limit. Fails open (returns true) if the check itself errors, so a
 * transient DB hiccup degrades to "unthrottled" rather than taking the
 * whole endpoint down -- matches this project's existing fail-open
 * convention for auxiliary checks (e.g. middleware.ts's resolveRole).
 */
export async function checkRateLimit(
  serviceClient: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc("check_rate_limit", {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  })
  if (error) return true
  return data === true
}

function rateLimitedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Too many requests, please try again shortly" }), {
    status: 429,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

/**
 * Convenience wrapper: checks the limit and returns a ready-to-return 429
 * Response if it's exceeded, or null if the caller should proceed.
 */
export async function rateLimitOrNull(
  serviceClient: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const allowed = await checkRateLimit(serviceClient, key, maxRequests, windowSeconds)
  return allowed ? null : rateLimitedResponse(corsHeaders)
}
