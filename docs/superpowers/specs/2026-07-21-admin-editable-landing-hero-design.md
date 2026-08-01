# Design: Admin-editable, motion-enhanced landing hero

Date: 2026-07-21

## Context

`components/marketing/spotlight-hero.tsx` renders the landing page's
full-screen hero: a mouse/touch-follow spotlight effect revealing a
warm "reveal" photo through a dark "base" photo, plus a slow background
zoom (`hero-zoom`) and staggered fade-in text (`hero-anim`,
`app/globals.css:160-182`). Both photos are hardcoded Unsplash URLs
(`BASE_IMAGE`/`REVEAL_IMAGE` constants, lines 17-20), loaded via CSS
`background-image` specifically to avoid `next/image`'s remote-domain
config overhead (per the file's own comment).

Two problems this design fixes:

1. **They just broke.** This session's new CSP (`middleware.ts`) scopes
   `img-src` to `'self' data: blob:` plus the Supabase project origin —
   CSS `background-image` is governed by `img-src` the same as an
   `<img>` tag, so `images.unsplash.com` is now blocked. A one-line
   interim allowance was already shipped to restore the current photos;
   this feature removes that allowance again once real images replace
   them.
2. **They were never real photography of this shop**, and there was no
   way to change them without editing code and redeploying.

## Data storage — extends `shop_settings`, no new table

`shop_settings` (`supabase/migrations/0002_shop_config.sql`) is this
project's existing single-row shop-config table: public-read
(`shop_settings_select_all`, `using (true)`), manager/admin-write
(`shop_settings_update_admin`, `current_user_role() in ('manager',
'admin')`), already used for shop info + tax rate. A dedicated
`landing_page_images` table was considered and rejected: this is a
fixed set of exactly 4 image slots, not a variable-length collection —
a new table would need its own RLS policies (duplicating exactly what
`shop_settings` already has) for no structural benefit.

New migration adds two columns:

```sql
alter table public.shop_settings
  add column landing_hero_base_images text[] not null default '{}',
  add column landing_hero_reveal_image text;
```

No RLS changes — the existing table-level policies (unscoped by
column) automatically cover the new columns.

`lib/supabase/settings-data.ts` gains a third settings group next to
`ShopSettings`/`LoyaltySettings`, matching the existing
`get*Settings`/`update*Settings` pair pattern exactly:

```ts
export type LandingHeroSettings = {
  baseImages: string[]       // exactly 3 URLs once seeded
  revealImage: string | null
}
export async function getLandingHeroSettings(supabase): Promise<LandingHeroSettings>
export async function updateLandingHeroSettings(supabase, input): Promise<void>
```

## Storage bucket — `landing-hero-images`

New bucket following the convention documented this session in
`supabase/CLAUDE.md` ("Storage buckets" section) — the same shape as
`menu-item-images` (migration `0028`, hardened in `0050`):

- Public read (`using (true)` on `storage.objects`, scoped to this
  bucket) — the landing page is guest-facing.
- Insert/update/delete restricted to manager/admin
  (`current_user_role() in ('manager', 'admin')`).
- `allowed_mime_types`: `image/jpeg`, `image/png`, `image/webp` (no
  `image/gif` — these are full-bleed hero photos, not the small icons
  `menu-item-images` allows gif for).
- `file_size_limit`: 8 MB (hero photos render larger than menu-item
  thumbnails; still bounded, still enforced server-side not just via
  a client-side check).

## Admin UI — new card in `/admin/settings`

`components/admin/settings-view.tsx` gains a fourth `Card` section,
"Landing Page", alongside the existing Shop Info/Tax/Loyalty cards
(same `Card`/`CardHeader`/`CardTitle`/`CardContent` composition already
used there). Shows 4 upload slots — 3 labeled "Background Photo 1/2/3"
(the crossfade gallery) and 1 labeled "Spotlight Photo" (the reveal
image) — each reusing `menu-item-form.tsx`'s existing image-picker
pattern: instant local preview via `URL.createObjectURL`, real upload
to Storage on Save (not on file-select), `image/*` + size client-side
guard mirroring the bucket's own server-side limits. Saving calls
`updateLandingHeroSettings` with the 4 resulting public URLs.

## Hero rendering changes

`LandingView` (`components/marketing/landing-view.tsx`) already renders
server-side-fetched data as props into child components (`bestSellers`)
— `SpotlightHero` gains the same treatment: the page-level server
component additionally calls `getLandingHeroSettings` and passes
`baseImages`/`revealImage` down as props, replacing the `BASE_IMAGE`/
`REVEAL_IMAGE` constants entirely.

The base layer changes from one `<div>` with a static
`background-image` to 3 stacked, absolutely-positioned divs (one per
`baseImages[i]`), each carrying a new CSS animation
(`.hero-crossfade`, `app/globals.css`) that holds full opacity for
~5s then crossfades to the next layer, staggered so exactly one is
visible at a time — a `animation-delay` offset per index, matching how
`hero-anim`'s existing staggered-delay pattern already works
(`animationDelay` inline style per element, same technique). Pure CSS
keyframes, no JS interval/state — consistent with `hero-zoom`/
`hero-anim` already being CSS-only. The reveal layer is structurally
unchanged (still one photo shown through the existing spotlight mask
logic in `spotlightMask`/`SPOTLIGHT_R`) — only its URL source changes
from a constant to a prop.

If `baseImages` has fewer than 3 entries (shouldn't happen once seeded,
but guards a not-yet-migrated or partially-cleared state) the crossfade
degrades to however many entries exist; if `revealImage` is null the
spotlight layer simply doesn't render (base layer alone, no broken
`background-image: url(null)`).

## New photography

4 images generated via the Stitch MCP tool during implementation,
styled around this project's actual brand — `app/globals.css`'s color
tokens, the neubrutalist card aesthetic used everywhere else in the
app — rather than generic stock photography. Seeded directly as the
migration's default column values (not left empty), so there's no
broken/blank state even before an admin ever opens the new Settings
card.

## CSP cleanup

Once the new images are live and `spotlight-hero.tsx` no longer
references any `images.unsplash.com` URL, `middleware.ts`'s interim
`img-src` allowance for it is removed — `img-src` returns to `'self'
data: blob:` plus the Supabase origin only, since the hero photos now
live in Supabase Storage same as every other admin-uploaded image in
this app.

## Out of scope

- No image cropping/editing UI — admin uploads a pre-sized photo, same
  as `menu-item-form.tsx`'s existing image picker.
- No configurable crossfade timing/duration in the admin UI — fixed at
  a single hardcoded interval in CSS, matching how `hero-zoom`'s
  duration is also fixed rather than admin-configurable.
- No history/versioning of previous hero photos — uploading a new one
  overwrites the slot's URL; the old Storage object becomes orphaned
  (same accepted behavior as `menu-item-form.tsx`'s existing image
  replace flow, which doesn't delete the previous upload either).
- No per-locale hero images (same 4 photos for `vi` and `en`).

## Testing

Unit tests for `getLandingHeroSettings`/`updateLandingHeroSettings` in
`lib/supabase/settings-data.test.ts` (if that file doesn't exist yet,
created following the mocked-`SupabaseClient` pattern every other
query-layer test in this codebase uses), covering the same
row-shape-mapping behavior `getShopSettings`/`updateShopSettings`
already have coverage for.

No automated test for the CSS crossfade animation itself (matches
`hero-zoom`/`hero-anim` having none). Verified live on
`https://phadincafe.vercel.app`: landing page shows the new photos
with a visible slow crossfade on the background and the spotlight
reveal still works on mouse move (desktop) and touch (mobile); Admin
Settings' new Landing Page card uploads each of the 4 slots and the
change reflects on the live landing page after save; browser console
shows no CSP violations on `/` once the `images.unsplash.com`
allowance is removed.
