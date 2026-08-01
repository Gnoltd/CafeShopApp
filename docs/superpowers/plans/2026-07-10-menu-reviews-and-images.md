# Real Reviews + Real/Bigger Menu Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock product reviews with a real, verified-purchase reviews system (with staff replies), and fix the admin image-upload bug (uploaded images were silently discarded) while making menu list images noticeably bigger.

**Architecture:** Two independent slices sharing one plan. Images: a new public Supabase Storage bucket + a real `.upload()` call in the admin form, plus a CSS size bump on two thumbnails. Reviews: one new table + three `security definer` RPCs (write path enforces verified-purchase and role checks server-side, matching every other privileged mutation in this codebase), a new DI'd query module (`lib/supabase/reviews-data.ts`), and three small new/edited UI surfaces (Product Detail display, an inline review form on the customer's Order Tracking/History detail page, and an admin reply panel).

**Tech Stack:** Next.js App Router, Supabase (Postgres + Storage), next-intl, Vitest (query-layer unit tests only — this project has no component-test harness).

## Global Constraints

- Every new Supabase write path goes through a `security definer` RPC (never raw RLS on a sensitive table) — this project's established convention for anything involving cross-role authorization (verified purchase, staff-only actions). See `current_user_role()` in `supabase/migrations/0001_identity_and_roles.sql`.
- Every `lib/supabase/*.ts` module takes `SupabaseClient` as its first argument (DI'd, mockable) — never import a singleton client.
- Any new UI-facing string needs a key added to **both** `messages/en.json` and `messages/vi.json` in the same task.
- No new npm dependencies — `crypto.randomUUID()` (native Web Crypto, already usable in this browser-targeted client code) is enough for a storage object path.
- `lib/mock-data/reviews.ts` must end up fully deleted with zero remaining references once real reviews are wired in.
- Local `npm run test` / `npm run build` are for fast feedback only — this project's explicit convention is that final verification happens live on `https://phadincafe.vercel.app` after a push to `main`, not on localhost.

---

### Task 1: Storage bucket for menu item images

**Files:**
- Create: `supabase/migrations/0028_menu_item_images_bucket.sql`

**Interfaces:**
- Produces: a public Supabase Storage bucket named `menu-item-images`, readable by anyone, writable only by `manager`/`admin`. Task 4 (`menu-item-form.tsx`) uploads to this exact bucket name.

- [ ] **Step 1: Write the migration file**

```sql
-- 0028_menu_item_images_bucket.sql
-- Public Storage bucket backing real menu item photo uploads (previously
-- admin-uploaded images were discarded entirely -- see menu-item-form.tsx's
-- blob-URL-only preview bug). Public read since /menu is guest-browsable;
-- write restricted to manager/admin, mirroring every other admin-only
-- mutation's role check via current_user_role().

insert into storage.buckets (id, name, public)
values ('menu-item-images', 'menu-item-images', true)
on conflict (id) do nothing;

create policy "menu_item_images_public_read" on storage.objects
  for select using (bucket_id = 'menu-item-images');

create policy "menu_item_images_admin_insert" on storage.objects
  for insert with check (
    bucket_id = 'menu-item-images'
    and public.current_user_role() in ('manager', 'admin')
  );

create policy "menu_item_images_admin_update" on storage.objects
  for update using (
    bucket_id = 'menu-item-images'
    and public.current_user_role() in ('manager', 'admin')
  );

create policy "menu_item_images_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'menu-item-images'
    and public.current_user_role() in ('manager', 'admin')
  );
```

- [ ] **Step 2: Apply the migration via the Supabase MCP tool**

Call `mcp__supabase__apply_migration` with `name: "menu_item_images_bucket"` and the SQL above as `query`.

- [ ] **Step 3: Verify the bucket exists**

Call `mcp__supabase__list_storage_buckets` and confirm `menu-item-images` (public: true) is now present — it was empty before this task (confirmed during brainstorming).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0028_menu_item_images_bucket.sql
git commit -m "Add public Storage bucket for menu item images, admin-only write"
```

---

### Task 2: Fix the real image upload in the admin Menu Management form

**Files:**
- Modify: `components/admin/menu-item-form.tsx:52` (state), `:117-123` (`selectFile`), `:202-239` (`handleSave`), `:334` (preview size), `:619-624` (Save button)
- Modify: `messages/en.json`, `messages/vi.json` (`AdminMenu` namespace)

**Interfaces:**
- Consumes: `supabase.storage.from("menu-item-images")` (Task 1's bucket).
- Produces: `handleSave` now calls `onSave(...)` with a real, persistable `imageUrl` (either a freshly-uploaded public URL, the untouched inherited URL, or `null`) instead of always nulling out a fresh upload.

- [ ] **Step 1: Add an `isUploading` state**

In `components/admin/menu-item-form.tsx`, right after line 59 (`const [error, setError] = useState<string | null>(null)`):

```tsx
  const [isUploading, setIsUploading] = useState(false)
```

- [ ] **Step 2: Add validation + error surfacing to `selectFile`**

Replace lines 117-123:

```tsx
  function selectFile(file: File | null) {
    if (!file) return
    if (imagePreviewUrl && ownsPreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setOwnsPreviewUrl(true)
  }
```

with:

```tsx
  function selectFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError(t("imageInvalidTypeError"))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t("imageTooLargeError"))
      return
    }
    setError(null)
    if (imagePreviewUrl && ownsPreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setOwnsPreviewUrl(true)
  }
```

- [ ] **Step 3: Replace `handleSave` with a real-uploading, async version**

Replace lines 202-239 (the whole `handleSave` function) with:

```tsx
  async function handleSave() {
    const parsedPrice = Number(price)
    if (!nameVi.trim() || !nameEn.trim() || !categoryId || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError(t("requiredFieldsError"))
      return
    }

    const recipeEntries: RecipeEntry[] = Object.entries(selectedRecipe).map(([ingredientId, quantityUsed]) => ({
      ingredientId,
      quantityUsed,
    }))
    if (recipeEntries.some((entry) => !Number.isFinite(entry.quantityUsed) || entry.quantityUsed <= 0)) {
      setRecipeError(t("recipeQuantityRequiredError"))
      return
    }
    setRecipeError(null)

    // imagePreviewUrl is a blob: URL only when imageFile is also set (see
    // selectFile/removeImage above, which always set/clear both together) —
    // so a real upload is needed exactly when imageFile is present; any
    // inherited real URL (editing without changing the photo) or null
    // (removed) passes through untouched.
    let finalImageUrl: string | null = imagePreviewUrl
    if (imageFile) {
      setIsUploading(true)
      const path = `${crypto.randomUUID()}-${imageFile.name}`
      const { error: uploadError } = await supabase.storage.from("menu-item-images").upload(path, imageFile)
      if (uploadError) {
        setError(t("imageUploadError"))
        setIsUploading(false)
        return
      }
      finalImageUrl = supabase.storage.from("menu-item-images").getPublicUrl(path).data.publicUrl
      setIsUploading(false)
    }

    setError(null)
    onSave(
      {
        categoryId,
        nameVi: nameVi.trim(),
        nameEn: nameEn.trim(),
        descriptionVi: descriptionVi.trim(),
        descriptionEn: descriptionEn.trim(),
        basePrice: parsedPrice,
        icon,
        isAvailable,
        isPopular,
        hasSizeOptions,
        imageUrl: finalImageUrl,
      },
      selectedExtraIds,
      recipeEntries
    )
  }
```

- [ ] **Step 4: Bump the admin preview thumbnail size**

Line 334, change:

```tsx
                <img src={imagePreviewUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
```

to:

```tsx
                <img src={imagePreviewUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
```

- [ ] **Step 5: Show upload progress on the Save button**

Lines 619-624, change:

```tsx
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave}>{t("save")}</Button>
        </div>
```

to:

```tsx
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isUploading}>
            {isUploading ? t("uploadingButton") : t("save")}
          </Button>
        </div>
```

- [ ] **Step 6: Add the new `AdminMenu` message keys**

In `messages/en.json`, inside the `AdminMenu` object (alongside the existing `photoLabel`/`dragDropText` keys), add:

```json
    "imageInvalidTypeError": "Please choose an image file.",
    "imageTooLargeError": "Image must be smaller than 5MB.",
    "imageUploadError": "Couldn't upload the image — please try again.",
    "uploadingButton": "Uploading…",
```

In `messages/vi.json`, inside the same `AdminMenu` object:

```json
    "imageInvalidTypeError": "Vui lòng chọn một tệp hình ảnh.",
    "imageTooLargeError": "Ảnh phải nhỏ hơn 5MB.",
    "imageUploadError": "Không thể tải ảnh lên — vui lòng thử lại.",
    "uploadingButton": "Đang tải lên…",
```

- [ ] **Step 7: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add components/admin/menu-item-form.tsx messages/en.json messages/vi.json
git commit -m "Fix admin menu image upload to actually persist to Supabase Storage"
```

---

### Task 3: Bigger menu list thumbnails

**Files:**
- Modify: `components/customer/menu-browser.tsx:129`

**Interfaces:**
- None — pure CSS class change.

- [ ] **Step 1: Bump the thumbnail size**

Line 129, change:

```tsx
                className={cn("h-20 w-20 shrink-0 rounded-lg", !item.isAvailable && "grayscale")}
```

to:

```tsx
                className={cn("h-28 w-28 shrink-0 rounded-lg", !item.isAvailable && "grayscale")}
```

- [ ] **Step 2: Commit**

```bash
git add components/customer/menu-browser.tsx
git commit -m "Enlarge menu list item thumbnails from 80px to 112px"
```

---

### Task 4: Reviews database schema + RPCs

**Files:**
- Create: `supabase/migrations/0027_menu_item_reviews.sql`

**Interfaces:**
- Produces: table `public.menu_item_reviews` (columns: `id`, `menu_item_id`, `customer_id`, `rating`, `comment`, `staff_reply`, `staff_reply_at`, `replied_by`, `created_at`, `updated_at`; unique on `(menu_item_id, customer_id)`); RPCs `submit_menu_item_review(p_item_id uuid, p_rating smallint, p_comment text)`, `reply_to_review(p_review_id uuid, p_reply text)`, `get_menu_item_reviews(p_item_id uuid) returns json` (shape: `{ reviews: [...], avgRating: number, reviewCount: number }`, each review: `{ id, reviewer_name, rating, comment, staff_reply, staff_reply_at, created_at }`). Task 5's query module calls these three by exact name.

- [ ] **Step 1: Write the migration file**

```sql
-- 0027_menu_item_reviews.sql
-- Real verified-purchase reviews, replacing lib/mock-data/reviews.ts.
-- All writes go through security definer RPCs (never raw RLS grants) so
-- "verified purchase" and "manager/admin only reply" are enforced
-- server-side, matching every other privileged mutation in this project
-- (place_order, adjust_ingredient_stock, etc.). Reads are public (guest-
-- browsable /menu) via a security definer RPC too, since resolving the
-- reviewer's display name requires reading public.profiles, which plain
-- RLS (profiles_select_own/profiles_select_staff) would block for any
-- viewer who isn't that reviewer or staff.

create table public.menu_item_reviews (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null,
  staff_reply text,
  staff_reply_at timestamptz,
  replied_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, customer_id)
);

alter table public.menu_item_reviews enable row level security;

create policy "menu_item_reviews_select_all" on public.menu_item_reviews
  for select using (true);

-- No insert/update/delete policies: every write goes through the two
-- RPCs below, which run as security definer.

create or replace function public.submit_menu_item_review(
  p_item_id uuid,
  p_rating smallint,
  p_comment text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_purchase boolean;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.menu_item_id = p_item_id
      and o.customer_id = auth.uid()
      and o.status = 'completed'
  ) into v_has_purchase;

  if not v_has_purchase then
    raise exception 'only customers with a completed order for this item can review it';
  end if;

  insert into public.menu_item_reviews (menu_item_id, customer_id, rating, comment)
  values (p_item_id, auth.uid(), p_rating, p_comment)
  on conflict (menu_item_id, customer_id)
  do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
end;
$$;

grant execute on function public.submit_menu_item_review(uuid, smallint, text) to authenticated;

create or replace function public.reply_to_review(
  p_review_id uuid,
  p_reply text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('manager', 'admin') then
    raise exception 'only manager/admin can reply to reviews';
  end if;

  update public.menu_item_reviews
  set staff_reply = p_reply, staff_reply_at = now(), replied_by = auth.uid()
  where id = p_review_id;
end;
$$;

grant execute on function public.reply_to_review(uuid, text) to authenticated;

create or replace function public.get_menu_item_reviews(p_item_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviews json;
  v_avg numeric;
  v_count int;
begin
  select coalesce(avg(rating), 0), count(*) into v_avg, v_count
  from public.menu_item_reviews where menu_item_id = p_item_id;

  select coalesce(json_agg(row_to_json(r) order by r.created_at desc), '[]'::json) into v_reviews
  from (
    select
      mir.id,
      p.full_name as reviewer_name,
      mir.rating,
      mir.comment,
      mir.staff_reply,
      mir.staff_reply_at,
      mir.created_at
    from public.menu_item_reviews mir
    join public.profiles p on p.id = mir.customer_id
    where mir.menu_item_id = p_item_id
  ) r;

  return json_build_object('reviews', v_reviews, 'avgRating', v_avg, 'reviewCount', v_count);
end;
$$;

grant execute on function public.get_menu_item_reviews(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP tool**

Call `mcp__supabase__apply_migration` with `name: "menu_item_reviews"` and the SQL above as `query`.

- [ ] **Step 3: Verify with a direct SQL check**

Call `mcp__supabase__execute_sql` with:

```sql
select p_item_id, get_menu_item_reviews(id) from (select id as p_item_id, id from public.menu_items limit 1) x;
```

Expected: returns one row with `{"reviews": [], "avgRating": 0, "reviewCount": 0}` (no reviews exist yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0027_menu_item_reviews.sql
git commit -m "Add menu_item_reviews table + verified-purchase review RPCs"
```

---

### Task 5: Add `menuItemId` to the customer order-items query

**Files:**
- Modify: `lib/supabase/orders-data.ts:8` (type), `:127-135` (`ORDER_SELECT`/`OrderRow`), `:143-149` (`mapOrderRow`)
- Create: `lib/supabase/orders-data.test.ts`

**Interfaces:**
- Produces: `OrderForTrackingItem` now includes `menuItemId: string`, populated by `getMyOrders`/`getOrderForTracking`. Task 8 (`order-tracking.tsx`) uses `item.menuItemId` to know which item a review is for.

- [ ] **Step 1: Write the failing test**

Create `lib/supabase/orders-data.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getMyOrders } from "./orders-data"

describe("getMyOrders", () => {
  it("includes menuItemId on each mapped item", async () => {
    const row = {
      id: "order-1",
      created_at: "2026-07-10T10:00:00Z",
      order_type: "dine_in",
      status: "completed",
      subtotal: 50000,
      discount_amount: 0,
      total: 50000,
      table_id: "table-1",
      payment_status: "paid",
      payment_method: "cash",
      tables: { table_number: "5" },
      order_items: [
        {
          menu_item_id: "item-1",
          quantity: 2,
          unit_price: 25000,
          note: null,
          menu_items: { name_vi: "Cà Phê Đen", name_en: "Black Coffee" },
        },
      ],
    }
    const supabase = {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: [row], error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await getMyOrders(supabase)

    expect(result[0].items[0]).toEqual({
      menuItemId: "item-1",
      nameVi: "Cà Phê Đen",
      nameEn: "Black Coffee",
      quantity: 2,
      unitPrice: 25000,
      note: undefined,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: FAIL — `menuItemId` is `undefined` in the actual result (not yet selected/mapped).

- [ ] **Step 3: Add `menuItemId` to the type**

In `lib/supabase/orders-data.ts`, line 8, change:

```ts
export type OrderForTrackingItem = { nameVi: string; nameEn: string; quantity: number; unitPrice: number; note?: string }
```

to:

```ts
export type OrderForTrackingItem = { menuItemId: string; nameVi: string; nameEn: string; quantity: number; unitPrice: number; note?: string }
```

- [ ] **Step 4: Select `menu_item_id` and map it through**

Lines 127-135, change:

```ts
type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  total: number
  table_id: string | null
  payment_status: string
  payment_method: RealPaymentMethod | null
  tables: { table_number: string } | null
  order_items: { menu_items: { name_vi: string; name_en: string }; quantity: number; unit_price: number; note: string | null }[]
}

const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`
```

to:

```ts
type OrderRow = {
  id: string
  created_at: string
  order_type: RealOrderType
  status: RealOrderStatus
  subtotal: number
  discount_amount: number
  total: number
  table_id: string | null
  payment_status: string
  payment_method: RealPaymentMethod | null
  tables: { table_number: string } | null
  order_items: { menu_item_id: string; menu_items: { name_vi: string; name_en: string }; quantity: number; unit_price: number; note: string | null }[]
}

const ORDER_SELECT = `
  id, created_at, order_type, status, subtotal, discount_amount, total,
  table_id, payment_status, payment_method,
  tables ( table_number ),
  order_items ( menu_item_id, quantity, unit_price, note, menu_items ( name_vi, name_en ) )
`
```

- [ ] **Step 5: Map `menu_item_id` in `mapOrderRow`**

Lines 143-149, change:

```ts
    items: row.order_items.map((oi) => ({
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      unitPrice: oi.unit_price,
      note: oi.note ?? undefined,
    })),
```

to:

```ts
    items: row.order_items.map((oi) => ({
      menuItemId: oi.menu_item_id,
      nameVi: oi.menu_items.name_vi,
      nameEn: oi.menu_items.name_en,
      quantity: oi.quantity,
      unitPrice: oi.unit_price,
      note: oi.note ?? undefined,
    })),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/supabase/orders-data.test.ts`
Expected: PASS

- [ ] **Step 7: Full build check (this type is used across several files)**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/supabase/orders-data.ts lib/supabase/orders-data.test.ts
git commit -m "Include menuItemId on customer order items, needed to submit a review"
```

---

### Task 6: `lib/supabase/reviews-data.ts` query module

**Files:**
- Create: `lib/supabase/reviews-data.ts`
- Create: `lib/supabase/reviews-data.test.ts`

**Interfaces:**
- Consumes: RPCs `get_menu_item_reviews`, `submit_menu_item_review`, `reply_to_review` from Task 4; table `menu_item_reviews` (plain select, own row only).
- Produces: `MenuItemReview` type (`{ id, reviewerName, rating, comment, staffReply, staffReplyAt, createdAt }`), `getMenuItemReviews(supabase, itemId): Promise<{ reviews: MenuItemReview[]; avgRating: number; reviewCount: number }>`, `getMyReviewForItem(supabase, itemId): Promise<{ rating: number; comment: string } | null>`, `submitReview(supabase, itemId, rating, comment): Promise<void>`, `replyToReview(supabase, reviewId, reply): Promise<void>`. Tasks 7, 8, 9, 10 all import from this module.

- [ ] **Step 1: Write the failing tests**

Create `lib/supabase/reviews-data.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getMenuItemReviews, getMyReviewForItem, submitReview, replyToReview } from "./reviews-data"

describe("getMenuItemReviews", () => {
  it("maps the RPC's snake_case json rows to camelCase, converting timestamps to epoch ms", async () => {
    const rpcResult = {
      reviews: [
        {
          id: "rev-1",
          reviewer_name: "Minh Anh",
          rating: 5,
          comment: "Rất ngon!",
          staff_reply: "Cảm ơn bạn!",
          staff_reply_at: "2026-07-10T12:00:00Z",
          created_at: "2026-07-09T12:00:00Z",
        },
      ],
      avgRating: 5,
      reviewCount: 1,
    }
    const rpcSpy = vi.fn(() => Promise.resolve({ data: rpcResult, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    const result = await getMenuItemReviews(supabase, "item-1")

    expect(rpcSpy).toHaveBeenCalledWith("get_menu_item_reviews", { p_item_id: "item-1" })
    expect(result.avgRating).toBe(5)
    expect(result.reviewCount).toBe(1)
    expect(result.reviews[0]).toEqual({
      id: "rev-1",
      reviewerName: "Minh Anh",
      rating: 5,
      comment: "Rất ngon!",
      staffReply: "Cảm ơn bạn!",
      staffReplyAt: new Date("2026-07-10T12:00:00Z").getTime(),
      createdAt: new Date("2026-07-09T12:00:00Z").getTime(),
    })
  })
})

describe("getMyReviewForItem", () => {
  it("returns null when there is no logged-in session", async () => {
    const supabase = {
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    } as unknown as SupabaseClient

    expect(await getMyReviewForItem(supabase, "item-1")).toBeNull()
  })

  it("returns the customer's own review when one exists", async () => {
    const maybeSingle = vi.fn(() => Promise.resolve({ data: { rating: 4, comment: "Ổn" }, error: null }))
    const supabase = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "cust-1" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
    } as unknown as SupabaseClient

    expect(await getMyReviewForItem(supabase, "item-1")).toEqual({ rating: 4, comment: "Ổn" })
  })
})

describe("submitReview", () => {
  it("calls submit_menu_item_review with snake_case params", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await submitReview(supabase, "item-1", 5, "Great!")

    expect(rpcSpy).toHaveBeenCalledWith("submit_menu_item_review", {
      p_item_id: "item-1",
      p_rating: 5,
      p_comment: "Great!",
    })
  })
})

describe("replyToReview", () => {
  it("calls reply_to_review with snake_case params", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const supabase = { rpc: rpcSpy } as unknown as SupabaseClient

    await replyToReview(supabase, "rev-1", "Thanks!")

    expect(rpcSpy).toHaveBeenCalledWith("reply_to_review", { p_review_id: "rev-1", p_reply: "Thanks!" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/supabase/reviews-data.test.ts`
Expected: FAIL with "Cannot find module './reviews-data'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/supabase/reviews-data.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

export type MenuItemReview = {
  id: string
  reviewerName: string
  rating: number
  comment: string
  staffReply: string | null
  staffReplyAt: number | null
  createdAt: number
}

export type MenuItemReviewsResult = {
  reviews: MenuItemReview[]
  avgRating: number
  reviewCount: number
}

type ReviewJsonRow = {
  id: string
  reviewer_name: string
  rating: number
  comment: string
  staff_reply: string | null
  staff_reply_at: string | null
  created_at: string
}

type ReviewsRpcResult = {
  reviews: ReviewJsonRow[]
  avgRating: number
  reviewCount: number
}

export async function getMenuItemReviews(supabase: SupabaseClient, itemId: string): Promise<MenuItemReviewsResult> {
  const { data, error } = await supabase.rpc("get_menu_item_reviews", { p_item_id: itemId })
  if (error) throw error
  const result = data as ReviewsRpcResult
  return {
    reviews: result.reviews.map((row) => ({
      id: row.id,
      reviewerName: row.reviewer_name,
      rating: row.rating,
      comment: row.comment,
      staffReply: row.staff_reply,
      staffReplyAt: row.staff_reply_at ? new Date(row.staff_reply_at).getTime() : null,
      createdAt: new Date(row.created_at).getTime(),
    })),
    avgRating: result.avgRating,
    reviewCount: result.reviewCount,
  }
}

export type MyReview = { rating: number; comment: string } | null

export async function getMyReviewForItem(supabase: SupabaseClient, itemId: string): Promise<MyReview> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null
  const { data, error } = await supabase
    .from("menu_item_reviews")
    .select("rating, comment")
    .eq("menu_item_id", itemId)
    .eq("customer_id", userId)
    .maybeSingle()
  if (error) throw error
  return data ? { rating: data.rating, comment: data.comment } : null
}

export async function submitReview(
  supabase: SupabaseClient,
  itemId: string,
  rating: number,
  comment: string
): Promise<void> {
  const { error } = await supabase.rpc("submit_menu_item_review", {
    p_item_id: itemId,
    p_rating: rating,
    p_comment: comment,
  })
  if (error) throw error
}

export async function replyToReview(supabase: SupabaseClient, reviewId: string, reply: string): Promise<void> {
  const { error } = await supabase.rpc("reply_to_review", { p_review_id: reviewId, p_reply: reply })
  if (error) throw error
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/supabase/reviews-data.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/reviews-data.ts lib/supabase/reviews-data.test.ts
git commit -m "Add reviews-data query module wrapping the review RPCs"
```

---

### Task 7: Interactive star picker

**Files:**
- Modify: `components/customer/star-rating.tsx`

**Interfaces:**
- Produces: `StarRating` gains an optional `onRate?: (value: number) => void` prop — when provided, each star becomes a clickable button. Existing display-only callers (`product-detail.tsx`) are unaffected since they never pass `onRate`. Task 8's `ReviewForm` uses the interactive mode.

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `components/customer/star-rating.tsx`:

```tsx
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

export function StarRating({
  rating,
  size = "sm",
  onRate,
}: {
  rating: number
  size?: "sm" | "lg"
  onRate?: (value: number) => void
}) {
  const starSize = size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < Math.round(rating)
        const star = (
          <Star className={cn(starSize, filled ? "fill-accent text-accent" : "fill-none text-muted-foreground/40")} />
        )
        if (!onRate) return <span key={i}>{star}</span>
        return (
          <button key={i} type="button" onClick={() => onRate(i + 1)} aria-label={`${i + 1} star`} className="p-0.5">
            {star}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Build to catch type errors**

Run: `npm run build`
Expected: succeeds — existing `<StarRating rating={...} />` and `<StarRating rating={...} size="lg" />` calls in `product-detail.tsx` still type-check with no `onRate`.

- [ ] **Step 3: Commit**

```bash
git add components/customer/star-rating.tsx
git commit -m "Make StarRating support an interactive click-to-rate mode"
```

---

### Task 8: Review submission form + wiring into Order Tracking/History

**Files:**
- Create: `components/customer/review-form.tsx`
- Modify: `components/customer/order-tracking.tsx:1-17` (imports/state), `:99-112` (login detection), `:270-281` (per-item render)
- Modify: `messages/en.json`, `messages/vi.json` (`OrderTracking` namespace)

**Interfaces:**
- Consumes: `getMyReviewForItem`, `submitReview` from Task 6; `StarRating`'s `onRate` from Task 7.
- Produces: a "Rate & Review" action appears under each item of a `completed` order, only for logged-in customers.

- [ ] **Step 1: Write `ReviewForm`**

Create `components/customer/review-form.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { StarRating } from "@/components/customer/star-rating"
import { getMyReviewForItem, submitReview } from "@/lib/supabase/reviews-data"

export function ReviewForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const t = useTranslations("OrderTracking")
  const [supabase] = useState(() => createClient())
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMyReviewForItem(supabase, itemId).then((existing) => {
      if (cancelled) return
      if (existing) {
        setRating(existing.rating)
        setComment(existing.comment)
      }
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  async function handleSubmit() {
    if (rating < 1) {
      setError(t("reviewRatingRequiredError"))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await submitReview(supabase, itemId, rating, comment.trim())
      onDone()
    } catch {
      setError(t("reviewSubmitError"))
      setIsSaving(false)
    }
  }

  if (isLoading) return null

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-dashed p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <StarRating rating={rating} size="lg" onRate={setRating} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("reviewCommentPlaceholder")}
        rows={2}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={isSaving}>
          {t("reviewCancelButton")}
        </Button>
        <Button type="button" size="sm" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? t("reviewSubmitLoading") : t("submitReviewButton")}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add `isLoggedIn` state and per-item toggle state to `order-tracking.tsx`**

Add this import near the top of `components/customer/order-tracking.tsx` (alongside the other component imports):

```tsx
import { ReviewForm } from "@/components/customer/review-form"
```

Add these two state lines right after line 59 (`const [cashConfirmed, setCashConfirmed] = useState(false)`):

```tsx
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [openReviewIndex, setOpenReviewIndex] = useState<number | null>(null)
```

- [ ] **Step 3: Set `isLoggedIn` where the user is already fetched**

Line 99, change:

```tsx
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
```

to:

```tsx
      const { data: { user } } = await supabase.auth.getUser()
      if (!cancelled) setIsLoggedIn(Boolean(user))
      if (!user) {
```

- [ ] **Step 4: Render the review action per item**

Replace lines 270-281:

```tsx
          {order.items.map((item, index) => (
            <div key={index} className="flex items-center justify-between rounded-xl p-3">
              <div>
                <h5 className="font-bold text-card-foreground">
                  {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                </h5>
                {item.note && <p className="text-xs italic text-accent-foreground">+ {item.note}</p>}
              </div>
              <span className="text-sm font-bold text-primary">{formatVND(item.unitPrice * item.quantity)}</span>
            </div>
          ))}
```

with:

```tsx
          {order.items.map((item, index) => (
            <div key={index} className="rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-card-foreground">
                    {item.quantity}x {locale === "vi" ? item.nameVi : item.nameEn}
                  </h5>
                  {item.note && <p className="text-xs italic text-accent-foreground">+ {item.note}</p>}
                </div>
                <span className="text-sm font-bold text-primary">{formatVND(item.unitPrice * item.quantity)}</span>
              </div>
              {isLoggedIn && order.status === "completed" && (
                openReviewIndex === index ? (
                  <ReviewForm itemId={item.menuItemId} onDone={() => setOpenReviewIndex(null)} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenReviewIndex(index)}
                    className="mt-1 text-xs font-semibold text-secondary hover:underline"
                  >
                    {t("rateReviewButton")}
                  </button>
                )
              )}
            </div>
          ))}
```

- [ ] **Step 5: Add the new `OrderTracking` message keys**

In `messages/en.json`, inside the `OrderTracking` object:

```json
    "rateReviewButton": "Rate & Review",
    "submitReviewButton": "Submit Review",
    "reviewSubmitLoading": "Submitting…",
    "reviewCancelButton": "Cancel",
    "reviewCommentPlaceholder": "Share your thoughts about this item…",
    "reviewRatingRequiredError": "Please select a star rating.",
    "reviewSubmitError": "Couldn't submit your review — please try again.",
```

In `messages/vi.json`, inside the same `OrderTracking` object:

```json
    "rateReviewButton": "Đánh giá",
    "submitReviewButton": "Gửi đánh giá",
    "reviewSubmitLoading": "Đang gửi…",
    "reviewCancelButton": "Hủy",
    "reviewCommentPlaceholder": "Chia sẻ cảm nhận của bạn về món này…",
    "reviewRatingRequiredError": "Vui lòng chọn số sao đánh giá.",
    "reviewSubmitError": "Không thể gửi đánh giá — vui lòng thử lại.",
```

- [ ] **Step 6: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add components/customer/review-form.tsx components/customer/order-tracking.tsx messages/en.json messages/vi.json
git commit -m "Add review submission to the customer's completed-order detail page"
```

---

### Task 9: Real reviews on the Product Detail page

**Files:**
- Modify: `components/customer/product-detail.tsx:1-17` (imports/state), `:99-104` (rating summary), `:178-209` (review list)
- Modify: `messages/en.json`, `messages/vi.json` (`ProductDetail` namespace)

**Interfaces:**
- Consumes: `getMenuItemReviews` from Task 6.
- Produces: Product Detail shows real reviews + real aggregate rating, plus any shop reply.

- [ ] **Step 1: Swap the mock import for the real query + fetch state**

Line 13, change:

```tsx
import { MOCK_REVIEWS, MOCK_RATING, MOCK_REVIEW_COUNT } from "@/lib/mock-data/reviews"
```

to:

```tsx
import { createClient } from "@/lib/supabase/client"
import { getMenuItemReviews, type MenuItemReview } from "@/lib/supabase/reviews-data"
```

Right after line 30 (`const { addItem } = useCart()`), add:

```tsx
  const [supabase] = useState(() => createClient())
  const [reviews, setReviews] = useState<MenuItemReview[]>([])
  const [avgRating, setAvgRating] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    getMenuItemReviews(supabase, item.id).then((result) => {
      if (cancelled) return
      setReviews(result.reviews)
      setAvgRating(result.avgRating)
      setReviewCount(result.reviewCount)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])
```

Add `useEffect` to the existing `"use client"` React import (line 3): change `import { useState } from "react"` to `import { useEffect, useState } from "react"`.

- [ ] **Step 2: Replace the top rating summary**

Lines 99-104, change:

```tsx
        <div className="mt-2 flex items-center gap-2">
          <StarRating rating={MOCK_RATING} />
          <span className="text-sm text-muted-foreground">
            {MOCK_RATING.toFixed(1)} · {tProduct("reviewCount", { count: MOCK_REVIEW_COUNT })}
          </span>
        </div>
```

to:

```tsx
        {reviewCount > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <StarRating rating={avgRating} />
            <span className="text-sm text-muted-foreground">
              {avgRating.toFixed(1)} · {tProduct("reviewCount", { count: reviewCount })}
            </span>
          </div>
        )}
```

- [ ] **Step 3: Replace the reviews section**

Lines 178-209, change:

```tsx
        <section className="mt-8 border-t pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-card-foreground">{tProduct("reviewsTitle")}</h2>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-primary">{MOCK_RATING.toFixed(1)}</span>
              <StarRating rating={MOCK_RATING} size="lg" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {MOCK_REVIEWS.map((review) => (
              <div key={review.id} className="rounded-xl border bg-card p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                    {review.reviewerName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-card-foreground">{review.reviewerName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {tProduct("daysAgo", { days: review.daysAgo })}
                      </span>
                    </div>
                    <StarRating rating={review.rating} />
                  </div>
                </div>
                <p className="mt-2 text-sm text-card-foreground">
                  {locale === "vi" ? review.commentVi : review.commentEn}
                </p>
              </div>
            ))}
          </div>
        </section>
```

to:

```tsx
        <section className="mt-8 border-t pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-card-foreground">{tProduct("reviewsTitle")}</h2>
            {reviewCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-primary">{avgRating.toFixed(1)}</span>
                <StarRating rating={avgRating} size="lg" />
              </div>
            )}
          </div>
          {reviewCount === 0 ? (
            <p className="text-sm text-muted-foreground">{tProduct("noReviewsYet")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                      {review.reviewerName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-card-foreground">{review.reviewerName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {tProduct("daysAgo", {
                            days: Math.max(0, Math.floor((Date.now() - review.createdAt) / 86400000)),
                          })}
                        </span>
                      </div>
                      <StarRating rating={review.rating} />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-card-foreground">{review.comment}</p>
                  {review.staffReply && (
                    <div className="ml-12 mt-2 rounded-lg bg-muted p-2">
                      <p className="text-xs font-semibold text-secondary">{tProduct("shopReplyLabel")}</p>
                      <p className="text-sm text-card-foreground">{review.staffReply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
```

- [ ] **Step 4: Add the new `ProductDetail` message keys**

In `messages/en.json`, inside the `ProductDetail` object:

```json
    "noReviewsYet": "No reviews yet.",
    "shopReplyLabel": "Shop reply",
```

In `messages/vi.json`, inside the same `ProductDetail` object:

```json
    "noReviewsYet": "Chưa có đánh giá nào.",
    "shopReplyLabel": "Phản hồi từ quán",
```

- [ ] **Step 5: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, no remaining reference to `MOCK_RATING`/`MOCK_REVIEW_COUNT`/`MOCK_REVIEWS` in this file.

- [ ] **Step 6: Commit**

```bash
git add components/customer/product-detail.tsx messages/en.json messages/vi.json
git commit -m "Show real reviews and aggregate rating on Product Detail"
```

---

### Task 10: Admin reply panel

**Files:**
- Create: `components/admin/menu-item-reviews-panel.tsx`
- Modify: `components/admin/menu-item-form.tsx` (import + one render line, near line 616-617)
- Modify: `messages/en.json`, `messages/vi.json` (`AdminMenu` namespace)

**Interfaces:**
- Consumes: `getMenuItemReviews`, `replyToReview` from Task 6.
- Produces: a self-contained panel manager/admin sees when editing an existing menu item, listing its reviews with a reply box for any review lacking a reply yet.

- [ ] **Step 1: Write the panel component**

Create `components/admin/menu-item-reviews-panel.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { StarRating } from "@/components/customer/star-rating"
import { getMenuItemReviews, replyToReview, type MenuItemReview } from "@/lib/supabase/reviews-data"

export function MenuItemReviewsPanel({ itemId }: { itemId: string }) {
  const t = useTranslations("AdminMenu")
  const [supabase] = useState(() => createClient())
  const [reviews, setReviews] = useState<MenuItemReview[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    getMenuItemReviews(supabase, itemId).then((result) => {
      setReviews(result.reviews)
      setIsLoading(false)
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  async function handleReply(reviewId: string) {
    const reply = (replyDrafts[reviewId] ?? "").trim()
    if (!reply) return
    setSavingId(reviewId)
    setError(null)
    try {
      await replyToReview(supabase, reviewId, reply)
      setReplyDrafts((prev) => ({ ...prev, [reviewId]: "" }))
      load()
    } catch {
      setError(t("replySubmitError"))
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) return null

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t("reviewsPanelTitle")}</label>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noReviewsForItem")}</p>
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          {reviews.map((review) => (
            <div key={review.id} className="space-y-1.5 border-b pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-card-foreground">{review.reviewerName}</span>
                <StarRating rating={review.rating} />
              </div>
              <p className="text-sm text-card-foreground">{review.comment}</p>
              {review.staffReply ? (
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs font-semibold text-secondary">{t("shopReplyLabel")}</p>
                  <p className="text-sm text-card-foreground">{review.staffReply}</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={replyDrafts[review.id] ?? ""}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                    placeholder={t("replyPlaceholder")}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button type="button" size="sm" onClick={() => handleReply(review.id)} disabled={savingId === review.id}>
                    {t("replyButton")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `menu-item-form.tsx`**

Add this import alongside the other component imports (near line 21):

```tsx
import { MenuItemReviewsPanel } from "@/components/admin/menu-item-reviews-panel"
```

Right after the Recipe section's closing `</div>` (the block ending at line 616, just before the outer `</div>` that closes `flex-1 space-y-4 overflow-y-auto` at line 617), add:

```tsx
          {isEditing && initialItem && <MenuItemReviewsPanel itemId={initialItem.id} />}
```

- [ ] **Step 3: Add the new `AdminMenu` message keys**

In `messages/en.json`, inside the `AdminMenu` object:

```json
    "reviewsPanelTitle": "Customer Reviews",
    "noReviewsForItem": "No reviews yet for this item.",
    "replyPlaceholder": "Write a public reply…",
    "replyButton": "Reply",
    "replySubmitError": "Couldn't post reply — please try again.",
    "shopReplyLabel": "Shop reply",
```

In `messages/vi.json`, inside the same `AdminMenu` object:

```json
    "reviewsPanelTitle": "Đánh giá của khách hàng",
    "noReviewsForItem": "Món này chưa có đánh giá nào.",
    "replyPlaceholder": "Viết phản hồi công khai…",
    "replyButton": "Phản hồi",
    "replySubmitError": "Không thể đăng phản hồi — vui lòng thử lại.",
    "shopReplyLabel": "Phản hồi từ quán",
```

- [ ] **Step 4: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/menu-item-reviews-panel.tsx components/admin/menu-item-form.tsx messages/en.json messages/vi.json
git commit -m "Add manager/admin public-reply panel to the Menu Management item editor"
```

---

### Task 11: Delete the mock reviews module and do final verification

**Files:**
- Delete: `lib/mock-data/reviews.ts`

**Interfaces:**
- None — cleanup + verification only.

- [ ] **Step 1: Confirm nothing else references the mock module**

Run: `grep -rn "mock-data/reviews" --include="*.tsx" --include="*.ts" .`
Expected: no output (Task 9 already removed the only import, in `product-detail.tsx`).

- [ ] **Step 2: Delete the file**

```bash
git rm lib/mock-data/reviews.ts
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including the new `orders-data.test.ts` and `reviews-data.test.ts`.

- [ ] **Step 4: Run the full build**

Run: `npm run build`
Expected: succeeds with no TypeScript or lint errors.

- [ ] **Step 5: Commit**

```bash
git commit -m "Remove mock reviews data now that Product Detail uses real reviews"
```

- [ ] **Step 6: Push and live-verify on Vercel**

Push to `main` (auto-deploys). Once deployed, verify on `https://phadincafe.vercel.app` per this project's explicit convention (verify live, not just localhost):

1. As admin, upload a real photo for a menu item in Menu Management, save, hard-refresh, and confirm the photo persists and now shows at the larger size on `/menu` (112px thumbnail) and in the admin form's own preview (96px).
2. As a logged-in customer with a real `completed` order, open that order's detail page (`/orders/[orderId]`), tap "Rate & Review" under one of its items, submit a rating + comment, and confirm it appears on that item's Product Detail page with the real aggregate rating/count updated.
3. Attempt to review an item from an order that is not yet `completed` (or one never ordered) — confirm the RPC rejects it (surfaced as the submit error).
4. As manager/admin, open that same item in Menu Management, reply to the review, and confirm the reply renders publicly under it on Product Detail — including when logged out (guest view).
5. Re-open the same item's "Rate & Review" form as that same customer — confirm it's pre-filled with their existing rating/comment (edit path), and re-submitting updates the same review rather than creating a duplicate.
