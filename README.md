# PhaDinCafe

Customer ordering (pickup + dine-in QR), staff POS + Kitchen Display, and
manager/admin tools for a single-location coffee shop. Bilingual
(Vietnamese/English). Built with Next.js + Supabase.

See `CLAUDE.md` for the structural map, `continuity.md` for current project
status, and `docs/superpowers/` for the design spec and implementation plan.

## Setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local`.
3. Start local Supabase (requires Docker Desktop running): `npx supabase start`
4. Copy the printed API URL, anon key, and service role key into `.env.local`.
5. Apply migrations once they exist: `npx supabase db reset`
6. Run the app: `npm run dev`

Without a configured `.env.local`, the app still runs — public/customer
routes work normally, and `/staff/*`/`/admin/*` redirect to `/login` (no
backend means no one can be authenticated yet).
