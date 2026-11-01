// Browser Supabase needs to read the session; HttpOnly requires a different
// server-only auth architecture. Production cookies must still require TLS.
export const authCookieOptions = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}
