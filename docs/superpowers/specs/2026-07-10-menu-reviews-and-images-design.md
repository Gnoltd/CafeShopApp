# Design: Real Reviews + Real/Bigger Menu Images

Date: 2026-07-10

## Context

Two related, independent gaps in the customer menu experience:

1. **Reviews are entirely mock.** `lib/mock-data/reviews.ts` (plus shared
   fake `MOCK_RATING`/`MOCK_REVIEW_COUNT`) backs the review list and
   rating summary shown on `components/customer/product-detail.tsx`.
   No `reviews` table exists in any of the 26 applied migrations.
2. **Admin-uploaded menu images never actually persist**, and the
   images that do exist are displayed too small. In
   `components/admin/menu-item-form.tsx`, selecting a file only creates
   a local `URL.createObjectURL()` blob preview; on save,
   `imageUrl: imagePreviewUrl?.startsWith("blob:") ? null : imagePreviewUrl`
   explicitly discards any blob URL, so nothing is ever uploaded
   anywhere and the menu item's `image_url` stays `null`. There is no
   Supabase Storage bucket in this project (`list_storage_buckets`
   confirms empty) and no `supabase.storage.from(...).upload(...)` call
   anywhere in the codebase. Separately, once real images exist, the
   menu list's `h-20 w-20` (80px) thumbnails are too small.

## Feature A — Real reviews (verified-purchase, with shop replies)

### Data model

New migration `0027_menu_item_reviews.sql`:

```
menu_item_reviews
  id             uuid pk default gen_random_uuid()
  menu_item_id   uuid not null references menu_items(id)
  customer_id    uuid not null references profiles(id)
  rating         smallint not null check (rating between 1 and 5)
  comment        text not null
  staff_reply    text
  staff_reply_at timestamptz
  replied_by     uuid references profiles(id)
  created_at     timestamptz not null default now()
  updated_at     timestamptz not null default now()
  unique (menu_item_id, customer_id)
```

`comment` is plain text (not bilingual columns) — it's the customer's
own words, never admin-authored/translated content like menu item
names.

RLS: `select` open (`USING (true)`) — Product Detail is guest-browsable,
reviews and shop replies are public read. No direct `insert`/`update`
grant to authenticated users — all writes go through the two RPCs
below, matching this project's existing convention of pushing business
rules (verified purchase, role checks) into `security definer`
functions rather than expressing them as RLS predicates.

### RPCs (same migration)

- **`submit_menu_item_review(item_id uuid, rating smallint, comment text)`**
  `security definer`. Requires `auth.uid()` to have at least one
  `completed` order containing `item_id` (joins `orders`/`order_items`
  filtered to `customer_id = auth.uid()` and `status = 'completed'`).
  Upserts on the `(menu_item_id, customer_id)` unique key — this is
  what makes "one review per item, editable" work: a second call from
  the same customer for the same item updates their existing row
  (`updated_at` refreshed) instead of erroring or creating a second row.
  No verified purchase → raises an exception the client surfaces as an
  error toast.
- **`reply_to_review(review_id uuid, reply_text text)`** `security
  definer`. Requires `current_user_role()` to be `manager` or `admin`
  (mirrors every other admin-only RPC in this project). Sets
  `staff_reply`, `staff_reply_at = now()`, `replied_by = auth.uid()`.

### Query layer

`lib/supabase/reviews-data.ts` (new, DI'd — takes `SupabaseClient` as
first arg, following every other `lib/supabase/*.ts` module):

- `getReviewsForItem(supabase, itemId)` — real review rows (reviewer
  name via a join to `profiles`, rating, comment, staff reply,
  timestamps) plus a computed aggregate (`avg(rating)`, `count(*)`)
  for that item, replacing `MOCK_RATING`/`MOCK_REVIEW_COUNT` outright.
- `submitReview(supabase, itemId, rating, comment)` — thin wrapper
  around the RPC.
- `replyToReview(supabase, reviewId, replyText)` — thin wrapper around
  the RPC (called from wherever staff review-reply UI lives — see
  below).

`lib/mock-data/reviews.ts` is deleted; nothing else references it.

### UI surfaces

- **Product Detail page** (`product-detail.tsx`): swaps the mock
  review list/rating summary for `getReviewsForItem`. Each review
  renders as today (avatar initial, name, days-ago, stars, comment)
  plus, when `staff_reply` is present, an indented "Shop reply" block
  underneath. No submission form on this page.
- **Order History page** (customer's own `/orders`, not Staff Order
  History): each line item on a `completed` order gets a "Write a
  review" action opening a small rating (stars) + comment form; if
  that item already has a review from this customer, the action reads
  "Edit review" and opens pre-filled. Calls `submitReview`.
- **Staff reply surface**: gated to manager/admin (matching Menu
  Management's existing role gate). Simplest fit: an inline "Reply"
  action next to each review shown in the admin Menu Management item
  editor, calling `replyToReview`. Kept minimal — no separate
  moderation dashboard.
- New `messages/vi.json`/`messages/en.json` keys for all new labels
  ("Write a review", "Edit review", "Verified Purchase", "Shop reply",
  "Reply", validation/error text) — comment text itself is never
  translated, only surrounding UI chrome.

### Out of scope

- Photo attachments on reviews (explicitly declined — text + rating
  only).
- Guest reviews (explicitly declined — requires login, matching every
  other identity-linked feature: loyalty, order history).
- Multiple reviews per item per customer over repeat orders (declined
  — one editable review per item).
- A dedicated reviews moderation/reporting dashboard.

## Feature B — Real image upload + bigger menu images

### Storage

New public Supabase Storage bucket `menu-item-images` (none exists
today). Public read (menu images must be visible to guests browsing
`/menu` with no login). Write (insert/update/delete) restricted to
`manager`/`admin` via a storage RLS policy keyed on
`current_user_role()`, matching this project's existing role-gating
convention for admin-only mutations.

### Fixing the upload

`components/admin/menu-item-form.tsx`:

- Keep today's behavior of showing an instant local blob preview when
  a file is picked (unchanged — good UX, no reason to lose it).
- On Save, if a new file was selected, actually upload it:
  `supabase.storage.from('menu-item-images').upload(path, file)`, then
  use the resulting public URL as `imageUrl` — replacing the current
  line that discards any `blob:`-prefixed URL and sends `null` instead.
- Basic client-side validation before upload: image MIME type only,
  reasonable size cap (5MB).
- Out of scope, explicitly: replacing an existing item's image does
  **not** delete the old file from the bucket. This only leaves unused
  files behind (a storage-cost/tidiness concern, not a correctness
  one) — not worth the added complexity now; revisit only if it
  becomes an actual problem.

### Bigger, consistent images

Every menu item image becomes a consistent **square (1:1) crop**
(`object-cover`), the standard treatment in F&B list UIs (GrabFood,
ShopeeFood, Starbucks) so photos of any original shape line up neatly:

- `components/customer/menu-browser.tsx`'s `ItemImage`: `h-20 w-20`
  (80px) → `h-28 w-28` (112px). This is the main visual change —
  today's row layout (image left, name/price/description right) is
  kept as-is, just with a meaningfully larger image and the row height
  growing to match.
- `components/admin/menu-item-form.tsx`'s preview thumbnail: `h-16
  w-16` → `h-24 w-24`, so what the admin sees while uploading matches
  the new real display size.

### Explicitly unchanged

- `components/admin/menu-management.tsx`'s admin table thumbnail
  (`h-10 w-10`) — a dense data table, not the customer-facing surface
  this request is about.
- `product-detail.tsx`'s hero image (`h-64`/`sm:h-80`, full width) —
  already a large banner; growing it further was explicitly declined.

## Migrations

- `0027_menu_item_reviews.sql` — table, RLS, both RPCs.
- `0028_menu_item_images_bucket.sql` — storage bucket + its RLS policy
  (via `apply_migration` — bucket creation is a real schema change even
  though it targets `storage.objects`/`storage.buckets` rather than
  `public`).

## Testing / verification

No Deno/component test harness exists for RPCs or storage in this
project (matches existing convention — Edge Functions and DB functions
here are verified live, not with automated tests). Verify live on
`https://phadincafe.vercel.app`, per this project's explicit
"deploy, don't test on localhost" convention:

- Upload a real image via admin Menu Management, confirm it persists
  after a hard refresh and appears at the new larger size on `/menu`.
- As a customer with a real completed order containing an item, submit
  a review from Order History, confirm it appears on that item's
  Product Detail page with the real aggregate rating updated.
- Attempt to review an item never actually ordered (or only ordered
  but not yet `completed`) — confirm the RPC rejects it.
- As manager/admin, reply to a review, confirm the reply renders
  publicly under it, including for a logged-out guest view.
