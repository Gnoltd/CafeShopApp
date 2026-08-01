# Admin-Editable, Motion-Enhanced Landing Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page hero's hardcoded, now-CSP-broken Unsplash photos with admin-manageable images (a 3-photo crossfading background gallery + 1 spotlight-reveal photo) stored in a new Supabase Storage bucket, seeded with new Stitch-generated brand-matched photography, and remove the interim CSP allowance once done.

**Architecture:** Extends the existing single-row `shop_settings` table with two new columns (no new table — matches this project's existing config-table pattern). A new `landing-hero-images` Storage bucket follows the `menu-item-images` convention documented this session. `spotlight-hero.tsx` becomes prop-driven instead of hardcoded; a new self-contained admin card handles the 4 image uploads independently of the existing Shop Info/Loyalty save flow (since uploads are async and slower than the existing synchronous-feeling text-field save).

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase (Postgres + Storage), Tailwind v4, Vitest.

## Global Constraints

- Add new i18n keys to **both** `messages/en.json` and `messages/vi.json` (this project's stated bilingual convention) — never one without the other.
- Query-layer functions take a `SupabaseClient` as their first argument (DI'd, not a singleton) — matches every existing function in `lib/supabase/*.ts`.
- Migrations apply via the Supabase MCP server's `apply_migration` directly against the live hosted project (`qhiypdqnrnzndxdwqxbx`) — this project has no local Supabase stack.
- Verify the final result against the deployed Vercel URL (`https://phadincafe.vercel.app`), not just local `npm run dev` — this project's explicit, stated convention.
- Run `npx tsc --noEmit` and `npx vitest run` after every task that touches `.ts`/`.tsx` files.

---

### Task 1: Create the `landing-hero-images` Storage bucket

**Files:**
- Create: `supabase/migrations/0051_landing_hero_images_bucket.sql`

**Interfaces:**
- Produces: a Storage bucket named `landing-hero-images` that Task 2 uploads into and Task 3's seeded URLs point at.

- [ ] **Step 1: Write the migration**

```sql
-- 0051_landing_hero_images_bucket.sql
-- Public Storage bucket for the landing page hero's admin-manageable
-- photos (3-photo crossfading background gallery + 1 spotlight-reveal
-- photo) -- see docs/superpowers/specs/2026-07-21-admin-editable-
-- landing-hero-design.md. Follows the same convention as
-- menu-item-images (0028, hardened in 0050): public read (the landing
-- page is guest-facing), manager/admin write, MIME/size restrictions
-- enforced server-side at the bucket level, not just client-side.

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'landing-hero-images',
  'landing-hero-images',
  true,
  array['image/jpeg', 'image/png', 'image/webp'],
  8388608 -- 8MB: full-bleed hero photos render larger than menu-item thumbnails
)
on conflict (id) do nothing;

create policy "landing_hero_images_public_read" on storage.objects
  for select using (bucket_id = 'landing-hero-images');

create policy "landing_hero_images_admin_insert" on storage.objects
  for insert with check (
    bucket_id = 'landing-hero-images'
    and public.current_user_role() in ('manager', 'admin')
  );

create policy "landing_hero_images_admin_update" on storage.objects
  for update using (
    bucket_id = 'landing-hero-images'
    and public.current_user_role() in ('manager', 'admin')
  );

create policy "landing_hero_images_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'landing-hero-images'
    and public.current_user_role() in ('manager', 'admin')
  );
```

- [ ] **Step 2: Apply the migration via the Supabase MCP server**

Use `mcp__supabase__apply_migration` with `name: "landing_hero_images_bucket"` and the SQL body above (everything after the leading comment block, or including it — comments are harmless in the applied migration).

- [ ] **Step 3: Verify the bucket was created correctly**

Call `mcp__supabase__list_storage_buckets` and confirm the response includes:
```json
{
  "id": "landing-hero-images",
  "public": true,
  "file_size_limit": 8388608,
  "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"]
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0051_landing_hero_images_bucket.sql
git commit -m "Add landing-hero-images Storage bucket for the new admin-managed hero photos"
```

---

### Task 2: Generate and upload the 4 seed hero photos via Stitch

**Files:** None (no source files — this task produces 4 public Storage URLs that Task 3 consumes).

**Interfaces:**
- Consumes: the `landing-hero-images` bucket from Task 1.
- Produces: 4 public HTTPS URLs (3 for the base crossfade gallery, 1 for the spotlight-reveal photo) that Task 3 writes into the `shop_settings` migration as column defaults.

This task is exploratory/creative, not deterministic TDD — execute it inline in the main session (not via a dispatched subagent, since it benefits from you directly reviewing each generated image before accepting it) rather than delegating it.

- [ ] **Step 1: Create a Stitch project**

Call `mcp__stitch-mcp__create_project` with `title: "PhaDinCafe Landing Hero"`. Note the returned project ID (e.g. `4044680601076201931`).

- [ ] **Step 2: Generate the base-layer photos (×3)**

Call `mcp__stitch-mcp__generate_screen_from_text` three times (once per photo), `projectId` from Step 1, `deviceType: "DESKTOP"`, with a prompt each time describing a **pure full-bleed photograph, no UI chrome** — read `app/globals.css`'s `:root`/`.dark` color tokens first (the `--primary`, `--background`, `--card` hex values) and name the actual colors in the prompt so the generated image is genuinely brand-matched, not generic. Example shape for photo 1 (adapt colors/description per the actual token values you read):

```
A single full-bleed photograph, no text, no buttons, no UI elements —
pure photography only. A moody, cinematic close-up of coffee beans
being poured into a grinder in a warm Vietnamese coffee shop, dark
ambient lighting with warm amber highlights matching hex #<primary
color read from globals.css>, shallow depth of field, editorial coffee
photography style, 16:9 landscape orientation suitable for a full-
screen website hero background.
```

Vary the second and third prompts' subject (e.g. a latte-art pour, a steaming cup on a wooden counter) while keeping the same lighting/color-palette direction so the 3 photos crossfade cohesively.

Per the tool's own documented behavior: if a call times out, do not retry — instead poll `mcp__stitch-mcp__get_screen` (using the project ID and returned screen name) every 30 seconds, up to 10 times, before giving up.

- [ ] **Step 3: Generate the spotlight-reveal photo (×1)**

Same process, one more `generate_screen_from_text` call, prompt describing a warmer/brighter reveal photo (e.g. a glowing finished latte in warm light) — this is the photo shown through the mouse-follow spotlight mask, so it should read as a distinct "reward" moment compared to the darker base-layer photos.

- [ ] **Step 4: Review each generated image**

For each of the 4 screens, call `mcp__stitch-mcp__get_screen` and inspect the result. If Stitch produced a busy UI mockup (buttons, text, layout chrome baked into the image) rather than a clean photograph, regenerate with a more explicit prompt (add "absolutely no text, no buttons, no interface elements — this is raw photography, not an app screen"). Do not proceed to Task 3 with an image that has UI chrome baked in — a landing-page background image showing a fake button will visibly look broken once composited into the real hero.

- [ ] **Step 5: Download the assets**

Call `mcp__stitch-mcp__download_assets` with the project ID and an `outputDir` under the scratchpad directory (e.g. `C:\Users\dotha\AppData\Local\Temp\claude\...\scratchpad\landing-hero-images`).

- [ ] **Step 6: Upload the 4 images to the new bucket**

For each downloaded file, use the Supabase client (or the Storage REST API directly, since this is a one-off script rather than app code — a short inline script using `@supabase/supabase-js` with the service-role key, run via `node`, is fine here) to upload to `landing-hero-images`, e.g. path `base-1.webp`, `base-2.webp`, `base-3.webp`, `reveal.webp`. Record the 4 resulting public URLs (`https://qhiypdqnrnzndxdwqxbx.supabase.co/storage/v1/object/public/landing-hero-images/<path>`) — Task 3 needs them verbatim.

---

### Task 3: Add `shop_settings` columns, seeded with the real photo URLs

**Files:**
- Create: `supabase/migrations/0052_landing_hero_settings_columns.sql`

**Interfaces:**
- Consumes: the 4 public URLs captured in Task 2.
- Produces: `shop_settings.landing_hero_base_images` (`text[]`, 3 URLs) and `shop_settings.landing_hero_reveal_image` (`text`) — Task 4's query-layer functions read/write these exact column names.

- [ ] **Step 1: Write the migration**

Replace the placeholder URLs below with the 4 real URLs from Task 2 before applying.

```sql
-- 0052_landing_hero_settings_columns.sql
-- Landing hero photos become admin-manageable instead of hardcoded in
-- spotlight-hero.tsx -- extends shop_settings (this project's existing
-- single-row shop-config table) rather than a new table, since this is
-- a fixed set of exactly 4 image slots, not a variable-length
-- collection. No new RLS needed: shop_settings_select_all (public read)
-- and shop_settings_update_admin (manager/admin write) are unscoped by
-- column, so they cover these new columns automatically.
--
-- Seeded with real Stitch-generated, brand-matched photography (not
-- left empty) so there's never a broken/blank hero state even before
-- an admin first opens the new Landing Page settings card.

alter table public.shop_settings
  add column landing_hero_base_images text[] not null default array[
    'https://qhiypdqnrnzndxdwqxbx.supabase.co/storage/v1/object/public/landing-hero-images/base-1.webp',
    'https://qhiypdqnrnzndxdwqxbx.supabase.co/storage/v1/object/public/landing-hero-images/base-2.webp',
    'https://qhiypdqnrnzndxdwqxbx.supabase.co/storage/v1/object/public/landing-hero-images/base-3.webp'
  ],
  add column landing_hero_reveal_image text
    default 'https://qhiypdqnrnzndxdwqxbx.supabase.co/storage/v1/object/public/landing-hero-images/reveal.webp';
```

- [ ] **Step 2: Apply the migration via the Supabase MCP server**

Use `mcp__supabase__apply_migration` with `name: "landing_hero_settings_columns"`.

- [ ] **Step 3: Verify**

```sql
select landing_hero_base_images, landing_hero_reveal_image from public.shop_settings where id = 1;
```

Run via `mcp__supabase__execute_sql` and confirm it returns the 3-element array and the reveal URL, both matching what was just inserted.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0052_landing_hero_settings_columns.sql
git commit -m "Add shop_settings columns for admin-manageable landing hero photos, seeded with new brand photography"
```

---

### Task 4: `lib/supabase/settings-data.ts` — landing hero settings query functions

**Files:**
- Modify: `lib/supabase/settings-data.ts`
- Test: `lib/supabase/settings-data.test.ts`

**Interfaces:**
- Produces: `LandingHeroSettings` type (`{ baseImages: string[], revealImage: string | null }`), `getLandingHeroSettings(supabase): Promise<LandingHeroSettings>`, `updateLandingHeroSettings(supabase, input: LandingHeroSettings): Promise<void>`.
- Consumed by: Task 7 (server-side fetch in `page.tsx`) and Task 8 (admin card's save handler).

- [ ] **Step 1: Write the failing tests**

Add to `lib/supabase/settings-data.test.ts`:

```ts
import {
  getShopSettings,
  updateShopSettings,
  getLoyaltySettings,
  updateLoyaltySettings,
  getLandingHeroSettings,
  updateLandingHeroSettings,
} from "./settings-data"

describe("getLandingHeroSettings", () => {
  it("maps the row to camelCase", async () => {
    const row = {
      landing_hero_base_images: ["https://x/base-1.webp", "https://x/base-2.webp", "https://x/base-3.webp"],
      landing_hero_reveal_image: "https://x/reveal.webp",
    }
    const singleSpy = vi.fn(() => Promise.resolve({ data: row, error: null }))
    const eqSpy = vi.fn(() => ({ single: singleSpy }))
    const selectSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ select: selectSpy }) } as unknown as SupabaseClient

    const result = await getLandingHeroSettings(supabase)

    expect(selectSpy).toHaveBeenCalledWith("landing_hero_base_images, landing_hero_reveal_image")
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
    expect(result).toEqual({
      baseImages: ["https://x/base-1.webp", "https://x/base-2.webp", "https://x/base-3.webp"],
      revealImage: "https://x/reveal.webp",
    })
  })

  it("maps a null reveal image to null", async () => {
    const row = { landing_hero_base_images: [], landing_hero_reveal_image: null }
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) }),
    } as unknown as SupabaseClient

    const result = await getLandingHeroSettings(supabase)

    expect(result.revealImage).toBeNull()
    expect(result.baseImages).toEqual([])
  })
})

describe("updateLandingHeroSettings", () => {
  it("writes both columns", async () => {
    const eqSpy = vi.fn(() => Promise.resolve({ error: null }))
    const updateSpy = vi.fn(() => ({ eq: eqSpy }))
    const supabase = { from: () => ({ update: updateSpy }) } as unknown as SupabaseClient

    await updateLandingHeroSettings(supabase, {
      baseImages: ["https://x/1.webp", "https://x/2.webp", "https://x/3.webp"],
      revealImage: "https://x/reveal.webp",
    })

    expect(updateSpy).toHaveBeenCalledWith({
      landing_hero_base_images: ["https://x/1.webp", "https://x/2.webp", "https://x/3.webp"],
      landing_hero_reveal_image: "https://x/reveal.webp",
    })
    expect(eqSpy).toHaveBeenCalledWith("id", 1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/supabase/settings-data.test.ts`
Expected: FAIL — `getLandingHeroSettings`/`updateLandingHeroSettings` are not exported from `./settings-data`.

- [ ] **Step 3: Add the implementation**

Append to `lib/supabase/settings-data.ts`:

```ts
export type LandingHeroSettings = {
  baseImages: string[]
  revealImage: string | null
}

type LandingHeroSettingsRow = {
  landing_hero_base_images: string[]
  landing_hero_reveal_image: string | null
}

export async function getLandingHeroSettings(supabase: SupabaseClient): Promise<LandingHeroSettings> {
  const { data, error } = await supabase
    .from("shop_settings")
    .select("landing_hero_base_images, landing_hero_reveal_image")
    .eq("id", 1)
    .single()
  if (error) throw error
  const row = data as LandingHeroSettingsRow
  return {
    baseImages: row.landing_hero_base_images,
    revealImage: row.landing_hero_reveal_image,
  }
}

export async function updateLandingHeroSettings(
  supabase: SupabaseClient,
  input: LandingHeroSettings
): Promise<void> {
  const { error } = await supabase
    .from("shop_settings")
    .update({
      landing_hero_base_images: input.baseImages,
      landing_hero_reveal_image: input.revealImage,
    })
    .eq("id", 1)
  if (error) throw error
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/supabase/settings-data.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/settings-data.ts lib/supabase/settings-data.test.ts
git commit -m "Add getLandingHeroSettings/updateLandingHeroSettings query functions"
```

---

### Task 5: `app/globals.css` — crossfade keyframes

**Files:**
- Modify: `app/globals.css:159-186` (the existing "Landing spotlight hero" animation block)

**Interfaces:**
- Produces: CSS classes `.hero-crossfade` and `.hero-crossfade-first`, consumed by Task 6's `spotlight-hero.tsx`.

- [ ] **Step 1: Add the crossfade keyframes and classes**

Insert immediately after the existing `@media (prefers-reduced-motion: reduce)` block that ends at line 186:

```css
/* Base-layer crossfade gallery — 3 photos, ~5s hold + 0.5s fade each,
   full 18s cycle. Each layer gets a staggered animation-delay (0s, 6s,
   12s) via inline style in spotlight-hero.tsx, same convention as
   .hero-anim's staggered animationDelay above. */
@keyframes heroCrossfade {
  0% { opacity: 0; }
  2.7% { opacity: 1; }
  30.5% { opacity: 1; }
  33.3% { opacity: 0; }
  100% { opacity: 0; }
}
.hero-crossfade {
  animation: heroCrossfade 18s ease-in-out infinite;
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .hero-crossfade {
    animation: none;
    opacity: 0;
  }
  .hero-crossfade-first {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "Add heroCrossfade keyframes for the landing hero's base-layer photo gallery"
```

---

### Task 6: `spotlight-hero.tsx` — prop-driven images, crossfading base layer

**Files:**
- Modify: `components/marketing/spotlight-hero.tsx`

**Interfaces:**
- Consumes: `LandingHeroSettings` shape (`baseImages: string[]`, `revealImage: string | null`) from Task 4, `.hero-crossfade`/`.hero-crossfade-first` classes from Task 5.
- Produces: `SpotlightHero` now takes `baseImages`/`revealImage` props — Task 7's `LandingView` must pass them.

- [ ] **Step 1: Remove the hardcoded constants and update the props signature**

In `components/marketing/spotlight-hero.tsx`, delete lines 15-20 (the `BASE_IMAGE`/`REVEAL_IMAGE` constants and their comment) and change the function signature:

```ts
export function SpotlightHero({
  onScanQr,
  baseImages,
  revealImage,
}: {
  onScanQr: () => void
  baseImages: string[]
  revealImage: string | null
}) {
```

- [ ] **Step 2: Replace the single base-layer div with 3 crossfading layers**

Replace this block (originally lines 76-79):

```tsx
      <div
        className="hero-zoom absolute inset-0 z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${BASE_IMAGE})` }}
      />
```

with:

```tsx
      {baseImages.map((image, index) => (
        <div
          key={image}
          className={cn(
            "hero-crossfade absolute inset-0 z-10 bg-cover bg-center bg-no-repeat",
            index === 0 && "hero-crossfade-first"
          )}
          style={{ backgroundImage: `url(${image})`, animationDelay: `${index * 6}s` }}
        />
      ))}
```

This needs `cn` imported — add to the top of the file: `import { cn } from "@/lib/utils"`.

- [ ] **Step 3: Guard the reveal layer against a null image**

Replace this block (originally lines 80-87):

```tsx
      <div
        className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${REVEAL_IMAGE})`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
```

with:

```tsx
      {revealImage && (
        <div
          className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${revealImage})`,
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails at this point, since `LandingView` (Task 7, not done yet) doesn't pass the new required props to `SpotlightHero` yet — this is expected; Task 7 fixes it. Confirm the ONLY new error is the missing-props error on `<SpotlightHero ... />` in `landing-view.tsx`, not an error inside `spotlight-hero.tsx` itself.

- [ ] **Step 5: Commit**

```bash
git add components/marketing/spotlight-hero.tsx
git commit -m "Make SpotlightHero prop-driven with a 3-photo crossfading base layer"
```

---

### Task 7: Wire settings through `LandingView` and the page

**Files:**
- Modify: `components/marketing/landing-view.tsx`
- Modify: `app/[locale]/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `getLandingHeroSettings` (Task 4), `SpotlightHero`'s new props (Task 6).

- [ ] **Step 1: Update `LandingView`'s props and pass them through**

In `components/marketing/landing-view.tsx`, add the import and update the signature/render:

```ts
import type { LandingHeroSettings } from "@/lib/supabase/settings-data"
```

```ts
export function LandingView({
  bestSellers,
  landingHero,
}: {
  bestSellers: MenuItem[]
  landingHero: LandingHeroSettings
}) {
```

```tsx
        <SpotlightHero
          onScanQr={() => setIsScannerOpen(true)}
          baseImages={landingHero.baseImages}
          revealImage={landingHero.revealImage}
        />
```

- [ ] **Step 2: Fetch the settings server-side and pass them down**

In `app/[locale]/(marketing)/page.tsx`:

```ts
import { getTranslations } from "next-intl/server"
import { LandingView } from "@/components/marketing/landing-view"
import { getPublicMenuData } from "@/lib/supabase/menu-data-cached"
import { getLandingHeroSettings } from "@/lib/supabase/settings-data"
import { createClient } from "@/lib/supabase/server"

export default async function LandingPage() {
  const t = await getTranslations("Landing")
  const supabase = await createClient()
  const [{ items }, landingHero] = await Promise.all([getPublicMenuData(), getLandingHeroSettings(supabase)])
  const bestSellers = items.filter((item) => item.isPopular)

  return (
    <>
      <h1 className="sr-only">{t("title")}</h1>
      <LandingView bestSellers={bestSellers} landingHero={landingHero} />
    </>
  )
}
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

Run: `npx vitest run`
Expected: all tests pass (154 existing + the new ones from Task 4).

- [ ] **Step 4: Commit**

```bash
git add components/marketing/landing-view.tsx "app/[locale]/(marketing)/page.tsx"
git commit -m "Fetch landing hero settings server-side and thread them through to SpotlightHero"
```

---

### Task 8: New admin card — `landing-hero-settings-card.tsx`

**Files:**
- Create: `components/admin/landing-hero-settings-card.tsx`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Consumes: `getLandingHeroSettings`/`updateLandingHeroSettings` (Task 4).
- Produces: `LandingHeroSettingsCard` component, mounted by Task 9.

Kept as its own file (not inlined into `settings-view.tsx`) because it manages async image uploads independently of that file's existing synchronous-feeling combined Shop Info + Loyalty save flow — a genuinely separate concern with its own loading/saving/error state, matching this project's pattern of extracting focused, independently-testable units.

- [ ] **Step 1: Add i18n keys**

Add to the `AdminSettings` namespace in `messages/en.json` (alongside the existing `shopInfo`/`loyaltySettings` keys):

```json
"landingHeroTitle": "Landing Page",
"landingHeroBasePhoto1": "Background Photo 1",
"landingHeroBasePhoto2": "Background Photo 2",
"landingHeroBasePhoto3": "Background Photo 3",
"landingHeroRevealPhoto": "Spotlight Photo",
"landingHeroUploadPrompt": "Click to upload",
"landingHeroSaveButton": "Save Landing Page",
"landingHeroSavedMessage": "Landing page updated.",
"landingHeroSaveError": "Couldn't save — please try again.",
"landingHeroImageTooLargeError": "Image must be under 8MB.",
"landingHeroImageInvalidTypeError": "Please choose an image file."
```

Add the matching Vietnamese block to the `AdminSettings` namespace in `messages/vi.json`:

```json
"landingHeroTitle": "Trang Chủ",
"landingHeroBasePhoto1": "Ảnh Nền 1",
"landingHeroBasePhoto2": "Ảnh Nền 2",
"landingHeroBasePhoto3": "Ảnh Nền 3",
"landingHeroRevealPhoto": "Ảnh Hiệu Ứng",
"landingHeroUploadPrompt": "Nhấn để tải lên",
"landingHeroSaveButton": "Lưu Trang Chủ",
"landingHeroSavedMessage": "Đã cập nhật trang chủ.",
"landingHeroSaveError": "Không thể lưu — vui lòng thử lại.",
"landingHeroImageTooLargeError": "Ảnh phải nhỏ hơn 8MB.",
"landingHeroImageInvalidTypeError": "Vui lòng chọn một tệp ảnh."
```

- [ ] **Step 2: Write the component**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ImageIcon, Check, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  getLandingHeroSettings,
  updateLandingHeroSettings,
  type LandingHeroSettings,
} from "@/lib/supabase/settings-data"

const MAX_SIZE_BYTES = 8 * 1024 * 1024

type SlotKey = "base0" | "base1" | "base2" | "reveal"
const SLOTS: { key: SlotKey; labelKey: string }[] = [
  { key: "base0", labelKey: "landingHeroBasePhoto1" },
  { key: "base1", labelKey: "landingHeroBasePhoto2" },
  { key: "base2", labelKey: "landingHeroBasePhoto3" },
  { key: "reveal", labelKey: "landingHeroRevealPhoto" },
]

export function LandingHeroSettingsCard() {
  const t = useTranslations("AdminSettings")
  const [supabase] = useState(() => createClient())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const [currentUrls, setCurrentUrls] = useState<Record<SlotKey, string | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })
  const [pendingFiles, setPendingFiles] = useState<Record<SlotKey, File | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })
  const [previewUrls, setPreviewUrls] = useState<Record<SlotKey, string | null>>({
    base0: null,
    base1: null,
    base2: null,
    reveal: null,
  })

  useEffect(() => {
    getLandingHeroSettings(supabase)
      .then((settings) => {
        setCurrentUrls({
          base0: settings.baseImages[0] ?? null,
          base1: settings.baseImages[1] ?? null,
          base2: settings.baseImages[2] ?? null,
          reveal: settings.revealImage,
        })
      })
      .catch(() => setError(t("landingHeroSaveError")))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectFile(slot: SlotKey, file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError(t("landingHeroImageInvalidTypeError"))
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t("landingHeroImageTooLargeError"))
      return
    }
    setError(null)
    setPendingFiles((prev) => ({ ...prev, [slot]: file }))
    setPreviewUrls((prev) => ({ ...prev, [slot]: URL.createObjectURL(file) }))
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      const finalUrls = { ...currentUrls }
      for (const slot of SLOTS.map((s) => s.key)) {
        const file = pendingFiles[slot]
        if (!file) continue
        const path = `${crypto.randomUUID()}-${file.name}`
        const { error: uploadError } = await supabase.storage.from("landing-hero-images").upload(path, file)
        if (uploadError) throw uploadError
        finalUrls[slot] = supabase.storage.from("landing-hero-images").getPublicUrl(path).data.publicUrl
      }

      const input: LandingHeroSettings = {
        baseImages: [finalUrls.base0, finalUrls.base1, finalUrls.base2].filter((u): u is string => !!u),
        revealImage: finalUrls.reveal,
      }
      await updateLandingHeroSettings(supabase, input)

      setCurrentUrls(finalUrls)
      setPendingFiles({ base0: null, base1: null, base2: null, reveal: null })
      setPreviewUrls({ base0: null, base1: null, base2: null, reveal: null })
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch {
      setError(t("landingHeroSaveError"))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ImageIcon className="h-5 w-5 text-primary" />
          {t("landingHeroTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          {SLOTS.map(({ key, labelKey }) => {
            const displayUrl = previewUrls[key] ?? currentUrls[key]
            return (
              <div key={key} className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">{t(labelKey)}</label>
                <label className="nb-border-sm block aspect-video cursor-pointer overflow-hidden rounded-lg bg-card">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => selectFile(key, e.target.files?.[0] ?? null)}
                  />
                  {displayUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                      <span className="text-xs">{t("landingHeroUploadPrompt")}</span>
                    </div>
                  )}
                </label>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button variant="neubrutal" onClick={handleSave} disabled={isSaving} className="h-11 px-6">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("landingHeroSaveButton")}
          </Button>
          {justSaved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
              <Check className="h-4 w-4" />
              {t("landingHeroSavedMessage")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/landing-hero-settings-card.tsx messages/en.json messages/vi.json
git commit -m "Add LandingHeroSettingsCard: admin upload UI for the 4 landing hero photos"
```

---

### Task 9: Mount the new card in Admin Settings

**Files:**
- Modify: `components/admin/settings-view.tsx`

**Interfaces:**
- Consumes: `LandingHeroSettingsCard` from Task 8.

- [ ] **Step 1: Import and render it**

In `components/admin/settings-view.tsx`, add the import near the other component imports:

```ts
import { LandingHeroSettingsCard } from "@/components/admin/landing-hero-settings-card"
```

Add `<LandingHeroSettingsCard />` as a new `Card` sibling immediately after the closing `</Card>` of the Loyalty section (before the `<div className="flex items-center gap-3">` Save/Cancel button row):

```tsx
      </Card>

      <LandingHeroSettingsCard />

      <div className="flex items-center gap-3">
```

- [ ] **Step 2: Typecheck and run the full test suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add components/admin/settings-view.tsx
git commit -m "Mount LandingHeroSettingsCard in Admin Settings"
```

---

### Task 10: Remove the interim CSP allowance

**Files:**
- Modify: `middleware.ts`

**Interfaces:** None (final cleanup, no new interfaces produced or consumed).

- [ ] **Step 1: Remove `images.unsplash.com` from `img-src`**

In `middleware.ts`'s `buildCsp` function, replace:

```ts
    // images.unsplash.com: interim allowance for spotlight-hero.tsx's
    // hardcoded hero photos (CSS background-image, so this CSP's img-src
    // governs them same as an <img> tag would) -- being replaced by an
    // admin-managed, Supabase-Storage-hosted image feature (see
    // docs/superpowers/specs/), at which point this line comes out.
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN} https://images.unsplash.com`,
```

with:

```ts
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN}`,
```

- [ ] **Step 2: Typecheck, build, and run the full test suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx next build`
Expected: succeeds with zero errors (same as the earlier CSP work this session).

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "Remove interim images.unsplash.com CSP allowance now that hero photos are self-hosted"
```

---

### Task 11: Push and live-verify

**Files:** None.

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the Vercel deploy, then verify on `https://phadincafe.vercel.app`**

- Landing page (`/vi` and `/en`) shows real photography (not broken/blank), with a visible slow crossfade on the background over ~18 seconds and the mouse/touch-follow spotlight still revealing the 4th photo correctly.
- Browser DevTools console on `/` shows zero CSP violations.
- Log in as the admin test account, go to `/admin/settings`, confirm the new "Landing Page" card shows the 4 current photos.
- Upload a new photo to one slot, click "Save Landing Page," confirm the success message appears.
- Reload the landing page and confirm the newly uploaded photo is now live in the correct slot.
- Confirm the other three Admin Settings sections (Shop Info, Loyalty, and their shared Save/Cancel row) still work unaffected.
