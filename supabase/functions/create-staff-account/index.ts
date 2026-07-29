// create-staff-account: creates a real, login-capable Supabase Auth
// account for a new staff/manager/admin hire — profiles rows can only
// ever be created via the handle_new_user trigger on auth.users insert,
// so this can't be a plain table insert. Uses email_confirm: true to
// skip sending any confirmation email at all (sidesteps this project's
// already-documented shared-email rate limit rather than hitting it
// again), and returns a randomly generated one-time password for the
// admin to relay to the new hire out of band.
//
// verify_jwt stays enabled (the default) for this function — unlike
// place-order, there is no guest use case here.

import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_ROLES = ["staff", "manager", "admin"]

function randomPassword(): string {
  // This is the initial credential for a privileged staff/manager/admin
  // account, so it must be cryptographically unpredictable. Math.random()
  // is NOT a CSPRNG (V8's xorshift128+ state is recoverable from outputs),
  // so draw from crypto.getRandomValues() and rejection-sample to keep the
  // mapping onto `chars` uniform (no modulo bias).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const targetLength = 16
  const maxUnbiased = Math.floor(256 / chars.length) * chars.length
  let password = ""
  while (password.length < targetLength) {
    const bytes = crypto.getRandomValues(new Uint8Array(targetLength))
    for (const byte of bytes) {
      if (byte >= maxUnbiased) continue
      password += chars[byte % chars.length]
      if (password.length === targetLength) break
    }
  }
  return password
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders })
  }

  try {
    const { fullName, email, role } = await req.json()
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders })
    }

    // Resolve who is actually calling — the service-role client below
    // has no session of its own, so the caller's identity must come
    // from their own forwarded JWT via an anon-key client first.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders })
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: callerProfile } = await serviceClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single()

    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only an active admin can create staff accounts" }), {
        status: 403,
        headers: corsHeaders,
      })
    }

    if (!fullName || !email || !VALID_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: corsHeaders })
    }

    const temporaryPassword = randomPassword()

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create account" }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // A plain update is fine for full_name (the on_profile_role_change
    // trigger only checks changes to the role column), but assigning
    // this brand-new profile's initial role must go through the
    // set_initial_staff_role RPC — a plain update here would be
    // rejected by that same trigger, since it fires regardless of RLS
    // bypass and this service-role connection has no forwarded JWT for
    // current_user_role() to resolve as 'admin'.
    const { error: nameError } = await serviceClient
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", created.user.id)

    if (nameError) {
      return new Response(JSON.stringify({ error: nameError.message }), { status: 400, headers: corsHeaders })
    }

    const { error: roleError } = await serviceClient.rpc("set_initial_staff_role", {
      p_user_id: created.user.id,
      p_role: role,
    })

    if (roleError) {
      return new Response(JSON.stringify({ error: roleError.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ userId: created.user.id, temporaryPassword }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Unexpected error creating staff account" }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
