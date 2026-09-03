# Task 1 report — Make table checkout and settings safe

Date: 2026-09-02; review follow-up: 2026-09-03

## Status

Implemented locally. No Edge Function was deployed, no migration was applied to the hosted project, no branch was pushed, and no other external state was changed.

## Implementation

- Added the checked-in anonymous posture for `checkout-table-session` with `verify_jwt = false`.
- Added `checkout_attempt_id`, `checkout_started_at`, and an attempt-scoped JSON snapshot of each covered order's prior payment method to table sessions.
- Recreated `checkout_table_session(...)` so Stripe/VNPay locks receive and return a fresh `checkoutAttemptId`; cash checkouts return a null attempt identifier.
- Added `release_table_checkout(p_qr_token text, p_attempt_id uuid)`. It locks the active session row and releases only a matching `payment_pending` attempt. A mismatched/stale attempt and a completed attempt return `false` without changing session, promo, or order state.
- Recovery also returns the failed attempt's reserved promo use, restores each still-pending order's exact pre-attempt payment method (including an existing cash selection or null), and resets checkout metadata.
- Updated the Edge Function to call the matching release RPC for missing Stripe/VNPay configuration, Stripe rejection, Stripe fetch/parse/timeout exceptions, and VNPay signing exceptions. Successful gateway setup is not released. A resolved `{ error }` or thrown recovery-RPC failure is logged internally with the attempt ID while the client continues to receive only the generic gateway failure.
- Narrowed both settings UPDATE policies from `manager|admin` to `admin` in `USING` and `WITH CHECK`.
- Added idempotently-created Postgres checks for tax `0..1` storage (`0..100` in the UI), earning rate `> 0`, and redemption value `>= 0`.
- Added query-layer validation before Supabase writes, inclusive boundary coverage, integer validation for the integer-backed loyalty fields, and translated field-level form errors with `aria-invalid`/`aria-describedby`.

## Files

- `.superpowers/sdd/daily/task-1-report.md`
- `components/admin/settings-view.tsx`
- `lib/supabase/settings-data.ts`
- `lib/supabase/settings-data.test.ts`
- `messages/en.json`
- `messages/vi.json`
- `supabase/config.toml`
- `supabase/functions/checkout-table-session/index.ts`
- `supabase/functions/checkout-table-session/index.test.ts`
- `supabase/migrations/0083_table_checkout_recovery.sql`
- `supabase/migrations/0084_settings_authorization_constraints.sql`
- `supabase/tests/0083_table_checkout_recovery.test.sql`
- `supabase/tests/0084_settings_authorization_constraints.test.sql`

The other session's dirty Task 6 files were not modified, staged, or committed by this task.

## TDD evidence

### RED

Command:

```text
npx vitest run lib/supabase/settings-data.test.ts supabase/functions/checkout-table-session/index.test.ts --reporter=verbose
```

Observed before implementation: exit 1; 18 failed, 10 passed. The failures showed that invalid tax/loyalty values reached the Supabase update chain, gateway configuration was not checked, and Stripe/VNPay failure paths made no `release_table_checkout` call. The pre-existing successful-Stripe no-release behavior passed.

Review follow-up RED command:

```text
npx vitest run supabase/functions/checkout-table-session/index.test.ts --reporter=verbose
```

Observed before inspecting the recovery result: exit 1; 1 failed, 6 passed. The new test showed that a resolved recovery RPC `{ error }` produced no internal error signal. The pgTAP regression for cash → failed Stripe checkout → cash preserved was written before replacing the lossy SQL reset; this checkout still has no local database runtime in which to execute its RED phase.

### GREEN

Same focused command after implementation and review follow-up: exit 0; 2 files passed, 32 tests passed. Covered:

- tax inclusive boundaries plus below-range, above-range, NaN, and Infinity;
- earning rate zero, negative, fractional, NaN, and Infinity;
- redemption value negative, fractional, NaN, and Infinity;
- minimum valid earning/redemption values;
- missing Stripe/VNPay secrets;
- Stripe gateway rejection and thrown timeout;
- VNPay thrown gateway/signing error;
- exact attempt id forwarded to recovery;
- resolved recovery-RPC errors logged without exposing their detail in the HTTP response;
- successful Stripe checkout not released.

Database pgTAP coverage was added for the database-only contracts: mismatched attempt refusal, matching unfinished release, completed-attempt refusal, returned/persisted gateway attempt id, cash restored after a failed gateway attempt, manager update denial, admin update success, and all three constraints.

## Full verification

- `npx eslint lib/supabase/settings-data.ts lib/supabase/settings-data.test.ts components/admin/settings-view.tsx supabase/functions/checkout-table-session/index.test.ts` — exit 0; review follow-up targeted lint also exited 0.
- `git diff --check` — exit 0.
- `npx tsc --noEmit` — exit 0.
- Initial `npm test` — exit 1 with 257 passed and 1 concurrent Task 6 failure. Fresh review-follow-up `npm test` after Task 6 landed — exit 0 with 34 files and 263 tests passed.
- The pgTAP files could not be executed because this checkout has no Supabase CLI, `psql`, or Docker runtime. Per the task restriction, they were not run against the hosted database.

The existing Vitest native-config warning remains and is already assigned to remediation Task 7.

## Self-review

- Attempt scoping is enforced in the atomic database transition, not trusted to Edge Function timing.
- The release function acquires the same table-session row lock used by checkout, checks `payment_pending`, and compares the UUID with `IS DISTINCT FROM` before any compensating write.
- A second recovery call is harmless; a stale ID cannot decrement a promo or clear a newer attempt.
- Completed payment is protected by `payment_pending = false` (and commonly a closed session), so its attempt metadata is retained for audit instead of being cleared.
- Every gateway attempt snapshots payment methods only after locking the session and covered orders. Matching recovery restores only order IDs present in that snapshot, so prior cash signals survive while originally-null methods return to null.
- The new `SECURITY DEFINER` function uses an empty search path with fully qualified relations, revokes default/public execution, and grants only the guest roles required by the QR-token interface.
- The replaced checkout function preserves the existing session/order/promo lock sequence and business calculations.
- Postgres constraints are idempotent via `pg_constraint` plus `conrelid`; no applied migration was edited.
- UI validation mirrors the database units correctly: percent is divided by 100 only after validating `0..100`; loyalty values must be whole numbers because their columns are integers.
- Edge tests exercise the registered real handler and mock only the external database/gateway boundaries.
- Recovery failures are observable in server logs without logging the QR token or returning database details to the guest.
- `git status` and the explicit staging list were checked to keep Task 6 files out of this commit.

## Concerns and follow-up

- Required live checks remain pending by explicit instruction: apply migrations 0083/0084, deploy `checkout-table-session`, prove an anonymous invocation reaches the handler, exercise guest recovery plus manager/admin writes, and run Supabase security advisors afterward.
- Immediately inspect `information_schema.role_routine_grants` after the live migration. This project has a documented platform auto-regrant history for new functions, so the checked-in revoke/grant statements still need live confirmation.
- Run `supabase test db` in an environment with the local Supabase stack before applying the migrations, using the two new pgTAP files.
