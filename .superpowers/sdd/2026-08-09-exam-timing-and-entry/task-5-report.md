# Task 5: Server-side duration enforcement in saveAnswer

## Summary

Successfully implemented server-side enforcement of per-student exam duration limits in the `saveAnswer` function using a TDD cycle.

## What Was Done

1. **Added two failing tests** to `lib/actions/attempts.test.js` in the `describe('saveAnswer', ...)` block:
   - `"rejects a save once the attempt is past its deadline plus grace period"` — verifies that saveAnswer rejects with `{ error: 'Time is up — submitting your exam…', timeExpired: true }` when time has expired
   - `"still allows a save within the grace period just past the deadline"` — verifies that saveAnswer still works within the 60-second grace period after the deadline

2. **Updated the existing happy-path test** in `describe('saveAnswer', ...)` to include the new required fields:
   - Added `started_at` (relative timestamp 30 min ago)
   - Added `exams: { duration_minutes: 60 }` in the mock attempt object

3. **Added the `isAttemptOverdue` helper** in `lib/actions/attempts.js`:
   - Helper function: `isAttemptOverdue(startedAt, durationMinutes) => boolean`
   - Returns `true` once `now > startedAt + durationMinutes*60000 + 60000`
   - Module-private (not exported); used by this task and Task 6
   - Includes explanatory comments about the server-side backstop and grace period

4. **Updated `saveAnswer` function** in `lib/actions/attempts.js`:
   - Modified the `.select()` statement to fetch `started_at` and the exam's `duration_minutes` via the `exams:exam_id ( duration_minutes )` relationship
   - Added a time-expiration check: if `isAttemptOverdue(attempt.started_at, attempt.exams.duration_minutes)`, return early with `{ error: 'Time is up — submitting your exam…', timeExpired: true }`
   - Check happens after status check but before attempting to save the response

## Deviations from Brief

None. The implementation followed the brief exactly, including:
- Exact test code copied verbatim
- Exact helper function implementation verbatim
- Exact saveAnswer changes verbatim
- All existing tests continued to pass (no pre-existing test failures were found that needed fixing beyond updating the mock shape in the happy-path test)

## Test Results

### Initial test run (Step 2: Verify failing tests)
```bash
npx vitest run lib/actions/attempts.test.js -t "deadline"
```
Result: Tests initially attempted to proceed to responses insertion (as expected, since the check didn't exist yet).

### Final test run (Step 5: Verify all tests pass)
```bash
npx vitest run lib/actions/attempts.test.js
```
Result:
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  21:58:52
   Duration  184ms
```

All 14 tests in the file pass, including:
- 2 new deadline/grace-period tests
- 12 existing tests (including the updated happy-path test with new mock fields)

## Commit

**Hash:** `b009fca`

**Message:** `feat: enforce per-student exam duration server-side in saveAnswer`

## Files Modified

- `lib/actions/attempts.js` — Added `isAttemptOverdue` helper and updated `saveAnswer`
- `lib/actions/attempts.test.js` — Added 2 new tests + updated existing happy-path test mock

---

# Fix: Flaky Test Timing Boundary

## Issue

The test "rejects a save once the attempt is past its deadline plus grace period" had a zero-margin timing boundary. It set `startedAt` to exactly `61 * 60 * 1000` ms ago (61 minutes), which is exactly the deadline for a 60-minute exam with a 60-second grace period. This created a race condition where `Date.now() > deadline` could evaluate to either true or false depending on sub-millisecond timing jitter, causing the test to fail ~5 out of 6 runs when the overdue check evaluated false and the code fell through to the responses upsert path (which had no mock response queued).

## Fix Applied

Changed `lib/actions/attempts.test.js` line 113:
- **From:** `const startedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString() // 61 min ago`
- **To:** `const startedAt = new Date(Date.now() - 62 * 60 * 1000).toISOString() // 62 min ago`

This gives the test one full minute of margin past the 61-minute deadline, eliminating the timing race.

## Verification: 5 Consecutive Runs

All runs passed consistently after the fix:

**Run 1:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  22:03:02
   Duration  185ms
```

**Run 2:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  22:03:06
   Duration  224ms
```

**Run 3:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  22:03:10
   Duration  233ms
```

**Run 4:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  22:03:13
   Duration  174ms
```

**Run 5:**
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  22:03:16
   Duration  179ms
```

## Full Suite Test

Ran full test suite after the fix:
```
 Test Files  12 passed (12)
      Tests  111 passed (111)
   Start at  22:03:20
   Duration  620ms
```

All tests pass, no regressions detected.

## Commit

**Hash:** `[will be determined after commit]`

**Message:** `fix: eliminate flaky timing boundary in deadline grace-period test`
