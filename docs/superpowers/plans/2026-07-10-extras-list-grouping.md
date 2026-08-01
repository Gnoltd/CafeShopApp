# Extras List Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Product Detail and the quick-add popup, group all single-option "extras" (Extra Shot, Extra Milk, etc.) into one "Extras" list with prices shown, instead of each rendering as its own titled section; also show prices on regular multi-choice modifier options.

**Architecture:** Pure rendering change in two files (`product-detail.tsx`, `quick-add-popup.tsx`, kept identical to each other per this codebase's existing convention). Each file splits `item.modifierGroups` into `extraGroups` (`options.length === 1`) and `otherGroups` (`options.length > 1`) — the same heuristic `menu-item-form.tsx` already uses — and renders `extraGroups` as one combined list, `otherGroups` unchanged in structure but with prices added.

**Tech Stack:** Next.js client components, next-intl, Tailwind.

## Global Constraints

- No changes to `selectedModifiers` state shape, add-to-cart logic, or price calculation — this is a rendering split of an existing loop, not a data/logic change.
- New i18n keys (`extrasLabel`, `freeLabel`) go in **both** `messages/en.json` and `messages/vi.json`, in **both** the `ProductDetail` namespace (used by `product-detail.tsx`) and the `Menu` namespace (used by `quick-add-popup.tsx`).
- Verify against `https://phadincafe.vercel.app`, not just `next build`.
- No new npm dependencies; reuse the existing `Check` icon and `formatVND` helper (both already imported in both files).

---

### Task 1: i18n keys

**Files:**
- Modify: `messages/en.json` (`ProductDetail` namespace, line ~296-304; `Menu` namespace, line ~131-144)
- Modify: `messages/vi.json` (same namespaces, same line ranges)

**Interfaces:**
- Produces: `ProductDetail.extrasLabel`, `ProductDetail.freeLabel`, `Menu.extrasLabel`, `Menu.freeLabel` — Tasks 2 and 3 call these via `tProduct("extrasLabel")`/`tProduct("freeLabel")` and `t("extrasLabel")`/`t("freeLabel")` respectively.

- [ ] **Step 1: Add keys to `messages/en.json`'s `ProductDetail` namespace**

Change:

```json
  "ProductDetail": {
    "addToCart": "Add to Cart",
    "reviewsTitle": "Reviews",
    "reviewCount": "{count, plural, one {# review} other {# reviews}}",
    "daysAgo": "{days, plural, one {# day ago} other {# days ago}}",
    "noReviewsYet": "No reviews yet.",
    "shopReplyLabel": "Shop reply",
    "anonymousReviewer": "Customer"
  },
```

to:

```json
  "ProductDetail": {
    "addToCart": "Add to Cart",
    "reviewsTitle": "Reviews",
    "reviewCount": "{count, plural, one {# review} other {# reviews}}",
    "daysAgo": "{days, plural, one {# day ago} other {# days ago}}",
    "noReviewsYet": "No reviews yet.",
    "shopReplyLabel": "Shop reply",
    "anonymousReviewer": "Customer",
    "extrasLabel": "Extras",
    "freeLabel": "Free"
  },
```

- [ ] **Step 2: Add keys to `messages/en.json`'s `Menu` namespace**

Change:

```json
  "Menu": {
    "searchPlaceholder": "Search items...",
    "allCategories": "All",
    "size": "Size",
    "add": "Add",
    "close": "Close",
    "confirm": "Confirm",
    "noteLabel": "Note (optional)",
    "notePlaceholder": "e.g. less sugar, extra ice...",
    "popular": "Popular",
    "outOfStock": "Out of Stock",
    "viewCart": "View Cart",
    "itemCount": "{count, plural, one {# item} other {# items}}",
    "emptyResults": "No matching items found."
  },
```

to:

```json
  "Menu": {
    "searchPlaceholder": "Search items...",
    "allCategories": "All",
    "size": "Size",
    "add": "Add",
    "close": "Close",
    "confirm": "Confirm",
    "noteLabel": "Note (optional)",
    "notePlaceholder": "e.g. less sugar, extra ice...",
    "popular": "Popular",
    "outOfStock": "Out of Stock",
    "viewCart": "View Cart",
    "itemCount": "{count, plural, one {# item} other {# items}}",
    "emptyResults": "No matching items found.",
    "extrasLabel": "Extras",
    "freeLabel": "Free"
  },
```

- [ ] **Step 3: Add keys to `messages/vi.json`'s `ProductDetail` namespace**

Change:

```json
  "ProductDetail": {
    "addToCart": "Thêm Vào Giỏ",
    "reviewsTitle": "Đánh Giá",
    "reviewCount": "{count} đánh giá",
    "daysAgo": "{days} ngày trước",
    "noReviewsYet": "Chưa có đánh giá nào.",
    "shopReplyLabel": "Phản hồi từ quán",
    "anonymousReviewer": "Khách hàng"
  },
```

to:

```json
  "ProductDetail": {
    "addToCart": "Thêm Vào Giỏ",
    "reviewsTitle": "Đánh Giá",
    "reviewCount": "{count} đánh giá",
    "daysAgo": "{days} ngày trước",
    "noReviewsYet": "Chưa có đánh giá nào.",
    "shopReplyLabel": "Phản hồi từ quán",
    "anonymousReviewer": "Khách hàng",
    "extrasLabel": "Món Thêm",
    "freeLabel": "Miễn phí"
  },
```

- [ ] **Step 4: Add keys to `messages/vi.json`'s `Menu` namespace**

Change:

```json
  "Menu": {
    "searchPlaceholder": "Tìm kiếm món...",
    "allCategories": "Tất Cả",
    "size": "Kích Cỡ",
    "add": "Thêm",
    "close": "Đóng",
    "confirm": "Xác Nhận",
    "noteLabel": "Ghi Chú (không bắt buộc)",
    "notePlaceholder": "VD: ít đường, nhiều đá...",
    "popular": "Phổ Biến",
    "outOfStock": "Hết Hàng",
    "viewCart": "Xem Giỏ Hàng",
    "itemCount": "{count} món",
    "emptyResults": "Không tìm thấy món phù hợp."
  },
```

to:

```json
  "Menu": {
    "searchPlaceholder": "Tìm kiếm món...",
    "allCategories": "Tất Cả",
    "size": "Kích Cỡ",
    "add": "Thêm",
    "close": "Đóng",
    "confirm": "Xác Nhận",
    "noteLabel": "Ghi Chú (không bắt buộc)",
    "notePlaceholder": "VD: ít đường, nhiều đá...",
    "popular": "Phổ Biến",
    "outOfStock": "Hết Hàng",
    "viewCart": "Xem Giỏ Hàng",
    "itemCount": "{count} món",
    "emptyResults": "Không tìm thấy món phù hợp.",
    "extrasLabel": "Món Thêm",
    "freeLabel": "Miễn phí"
  },
```

- [ ] **Step 5: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json')); JSON.parse(require('fs').readFileSync('messages/vi.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "Add extrasLabel/freeLabel translation keys"
```

---

### Task 2: `product-detail.tsx` — group extras, show prices

**Files:**
- Modify: `components/customer/product-detail.tsx:73` (add derived consts), `:144-180` (replace the modifier-groups render block)

**Interfaces:**
- Consumes: `tProduct("extrasLabel")`, `tProduct("freeLabel")` from Task 1.
- Produces: no new exports — internal rendering change only.

- [ ] **Step 1: Add `extraGroups`/`otherGroups` derived consts**

In `components/customer/product-detail.tsx`, right after line 73 (`const price = item.basePrice + sizeDelta + modifierDelta`), add:

```tsx
  const extraGroups = item.modifierGroups?.filter((g) => g.options.length === 1) ?? []
  const otherGroups = item.modifierGroups?.filter((g) => g.options.length > 1) ?? []
```

- [ ] **Step 2: Replace the modifier-groups render block**

Replace lines 144-180:

```tsx
        {item.modifierGroups?.map((group) => (
          <section key={group.id} className="mt-6 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </PressFeedback>
                )
              })}
            </div>
          </section>
        ))}
```

with:

```tsx
        {extraGroups.length > 0 && (
          <section className="mt-6 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tProduct("extrasLabel")}
            </span>
            <div className="flex flex-col gap-2">
              {extraGroups.map((group) => {
                const option = group.options[0]
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={group.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Check className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-transparent")} />
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    </div>
                    <span className={selected ? "text-primary" : "text-muted-foreground"}>
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : tProduct("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </section>
        )}

        {otherGroups.map((group) => (
          <section key={group.id} className="mt-6 flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : tProduct("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </section>
        ))}
```

- [ ] **Step 3: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/customer/product-detail.tsx
git commit -m "Group extras into one list with prices on Product Detail"
```

---

### Task 3: `quick-add-popup.tsx` — mirror Task 2 exactly

**Files:**
- Modify: `components/customer/quick-add-popup.tsx:45` (add derived consts), `:103-139` (replace the modifier-groups render block)

**Interfaces:**
- Consumes: `t("extrasLabel")`, `t("freeLabel")` from Task 1 (`Menu` namespace — this file uses `t = useTranslations("Menu")`, not `tProduct`).
- Produces: no new exports — internal rendering change only.

- [ ] **Step 1: Add `extraGroups`/`otherGroups` derived consts**

In `components/customer/quick-add-popup.tsx`, right after line 45 (`const price = item.basePrice + sizeDelta + modifierDelta`), add:

```tsx
  const extraGroups = item.modifierGroups.filter((g) => g.options.length === 1)
  const otherGroups = item.modifierGroups.filter((g) => g.options.length > 1)
```

- [ ] **Step 2: Replace the modifier-groups render block**

Replace lines 103-139:

```tsx
        {item.modifierGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        ))}
```

with:

```tsx
        {extraGroups.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("extrasLabel")}
            </span>
            <div className="flex flex-col gap-2">
              {extraGroups.map((group) => {
                const option = group.options[0]
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={group.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Check className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-transparent")} />
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                    </div>
                    <span className={selected ? "text-primary" : "text-muted-foreground"}>
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : t("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        )}

        {otherGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "vi" ? group.nameVi : group.nameEn}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => {
                const selected = selectedModifiers[group.id] === option.id
                return (
                  <PressFeedback
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedModifiers((prev) => {
                        if (!group.required && prev[group.id] === option.id) {
                          const next = { ...prev }
                          delete next[group.id]
                          return next
                        }
                        return { ...prev, [group.id]: option.id }
                      })
                    }
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/10 font-semibold text-card-foreground"
                        : "border-border text-card-foreground"
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span>{locale === "vi" ? option.nameVi : option.nameEn}</span>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {option.priceDelta > 0 ? `+${formatVND(option.priceDelta)}` : t("freeLabel")}
                    </span>
                  </PressFeedback>
                )
              })}
            </div>
          </div>
        ))}
```

- [ ] **Step 3: Build to catch type errors**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/customer/quick-add-popup.tsx
git commit -m "Group extras into one list with prices in the quick-add popup"
```

---

### Task 4: Full verification, deploy, live-verify

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all existing tests still pass (this change touches no query-layer code, so no count change expected).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Live-verify on `https://phadincafe.vercel.app`**

1. Open an item with multiple extras (e.g. via Menu Management, confirm which item has 2+ single-option extras — or add a second extra to an existing item like Butter Croissant if only one exists) on its Product Detail page: confirm one "Extras" section shows all extras as a vertical list, each with a price (or "Free"), and that tapping one toggles it (border/bg highlight + Check turns from transparent to visible) without affecting the others — multiple extras selectable at once.
2. Same item via the Menu page's quick-add "+" popup: confirm identical layout/behavior.
3. If any item has a real multi-choice group (e.g. a Size-like modifier with more than one option and a nonzero price on at least one option), confirm each option in that group's grid now shows its price under the name, and the existing single-select/required-group behavior is unchanged.
4. Confirm the running total price at the bottom still updates correctly when toggling extras and other options.
5. Confirm an item with neither extras nor other modifier groups (e.g. Egg Coffee) shows neither section, same as before this change.

- [ ] **Step 5: Commit any final fixes if live verification caught something, otherwise done**
