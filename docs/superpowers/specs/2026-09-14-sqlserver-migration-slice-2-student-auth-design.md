# SQL Server Migration — Slice 2: Student Credential-less Auth + Lab IP Gate

**Date:** 2026-09-14
**Status:** Design approved, implementation pending
**Owner:** DNLCodess
**Parent design:** `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md`
**Prior slices:** Slice 0 (infra skeleton, schema, seed) and Slice 1 (staff auth core)
are merged into `sqlserver-migration`.

---

## 1. Scope

This slice ports the two credential-less student verification flows and adds
the lab IP allowlist security control, per the parent design's §3.1
(FR-AUTH-6..10) and §3.4a (FR-LAB-1..6). It is a **port**, not new design:
`lib/actions/studentAuth.js` (Supabase/Postgres, 279 lines) and the full UI
(`LabCodeEntry`, `MatricEntryForm`, `CheckResultForm`, `EndSessionButton`)
already implement this feature. The Prisma schema for everything this slice
needs (`Session`, `VerificationAttempt`, `LabIpAllowlist`,
`Exam.access_code_mode/access_code_revoked_at/enforce_ip_allowlist`) and the
`exam_entry_ip_blocked` audit action were already added in Slice 0.

### In scope
- Matric number + access code exam entry (FR-AUTH-6).
- Matric number + date of birth result lookup (FR-AUTH-7).
- Channel-gated sessions: an `exam_access` session can only act on its
  `verified_exam_id`; a `result_lookup` session can't start/save/submit an
  attempt (FR-AUTH-8).
- Rate limiting: 5 failed verifications per matric number / 15 min → 15 min
  block, backed by `VerificationAttempt` (FR-AUTH-9).
- Kiosk hygiene: "End session" control on both post-auth stub pages
  (FR-AUTH-10).
- Lab IP allowlist: schema-backed CRUD at the repo layer, `TRUST_PROXY`-aware
  client IP resolution, enforcement on exam-entry verification (FR-LAB-1,
  FR-LAB-2, FR-LAB-5).
- Per-exam `enforce_ip_allowlist` override, already a column — read, not yet
  writable from any UI (FR-LAB-3; the toggle UI is Slice 5).
- Fail-closed behavior when the allowlist is empty and enforcement is on
  (FR-LAB-4).
- Access-code revocation check (FR-EXAM-7) and revoked-codes-excluded
  uniqueness assumption (FR-EXAM-9 — enforced by the DB's filtered unique
  index from Slice 0; this slice only needs to *read* `access_code_revoked_at`,
  not create the index).
- Every allowlist rejection logged to `admin_action_log`
  (`exam_entry_ip_blocked`) with the attempted IP in `meta` (FR-LAB-6).
- Minimal stub landing pages after successful verification (see §4).

### Explicitly out of scope (deferred to a later slice, per the parent plan)
- `exam_access` per-student allow-list enforcement (FR-EXAM-3) — this lived
  in Postgres RLS checked at `startExam` time, not in student auth; belongs
  to Slice 6 (Attempts).
- Lab IP allowlist **admin UI** (the "add range" bulk helper, `is_active`
  toggle page) — Slice 3. This slice seeds allowlist rows via
  `prisma/seed.mjs` only.
- Real exam detail, question counts, attempt resume, and results data —
  Slices 5 and 6 own those repos and pages.
- Removing `/check-result/[slug]` and `/[slug]/login` (legacy multi-tenant
  routes, still Supabase-backed, left untouched and unreachable via any new
  link) — Slice 3, matching the precedent Slice 1 set for `/[slug]/login`.
- The `enforce_ip_allowlist` toggle UI and access-code generate/revoke UI —
  Slice 5.

---

## 2. New modules

### `lib/security/clientIp.js`
Pure functions, no DB access:
- `resolveClientIp(headers)` — reads `TRUST_PROXY` from env.
  `TRUST_PROXY=0` (default): return the direct socket remote address only;
  `X-Forwarded-For` is never read. `TRUST_PROXY=1`: return the **rightmost**
  entry of `X-Forwarded-For` (the hop closest to the trusted proxy).
- `isIpAllowed(ip, entries)` — `entries` is `{ entry: string }[]` from the
  allowlist repo. Matches an exact IPv4 string or tests membership in a CIDR
  (`a.b.c.d/n`). Returns `false` on a malformed `ip` or `entry` (fail closed,
  never throw across this boundary).

### `lib/db/repositories/labIpAllowlist.js`
- `listActiveEntries(universityId)` — active rows only, for enforcement checks.
- `createEntry({ universityId, entry, label, createdBy })` — used by this
  slice's tests and by Slice 3's admin UI later; not exposed through any
  Server Action yet.

### `lib/db/repositories/verificationAttempts.js`
Direct port of the Supabase version's three functions onto Prisma:
- `isRateLimited(matricNumber)` — count rows for this matric number in the
  last 15 minutes, `>= 5` → true.
- `recordFailedAttempt(matricNumber, ip)`.
- `clearFailedAttempts(matricNumber)` — called on every successful
  verification.

### `lib/db/repositories/students.js`
- `findStudentByMatric(matricNumber)` — `role='student'`, returns
  `{ id, email, is_active, university_id }`.
- `findStudentByMatricAndDob(matricNumber, dateOfBirth)` — same shape;
  single-tenant, so no university scoping needed (unlike the old
  Supabase version's slug-scoped ambiguous-match handling).

### `lib/db/repositories/exams.js` (minimal, entry-only)
Only what exam-entry verification and the post-auth stub need — **not** a
general exams repo (Slice 5 owns that):
- `findExamByAccessCode(code)` → `{ id, university_id, status, go_live_at,
  entry_window_minutes, access_code_revoked_at, enforce_ip_allowlist, title,
  duration_minutes }`.
- `findInProgressAttempt(examId, studentId)` → `{ id } | null`, reading the
  existing `Attempt` table just for the entry-window escape hatch
  (FR-ATT-1's recovery case: a student mid-attempt must always get back in).

### `lib/auth/session.js` addition
`readSessionUser()` keeps its existing return shape (the user profile only —
40+ staff call sites depend on this). A new **`readStudentSession()`** is
added alongside it, returning `{ user, channel, verifiedExamId } | null`, so
FR-AUTH-8's channel gate can be checked without touching the staff path.

---

## 3. `lib/actions/studentAuth.js` rewrite

Same three exports, same external error-message contract (`GENERIC_ERROR`,
`RATE_LIMITED_ERROR`, `EXAM_NOT_OPEN_ERROR`, `ENTRY_CLOSED_ERROR` — unchanged
copy, still costing/not-costing a rate-limit charge exactly as documented in
the current file's comments).

**`verifyExamAccess(prevState, formData)`** — order of checks:
1. Parse/validate matric number + 6-char access code (unchanged Zod schema).
2. Resolve client IP (`resolveClientIp`).
3. Look up the exam by access code. If not found → existing not-found path
   (rate-limited + logged, unchanged).
4. **New:** if `enforce_ip_allowlist` is true for this exam, load active
   allowlist entries; if empty → fail closed for everyone (FR-LAB-4); else
   check `isIpAllowed`. On mismatch: **do not rate-limit**, log
   `exam_entry_ip_blocked` with `target_identifier=matric_number,
   meta={ip}`, return a distinct "not an approved exam machine" message.
5. **New:** if `access_code_revoked_at` is set → treat as not-found (same
   message/rate-limit behavior as an unknown code — a revoked code must not
   be distinguishable from a wrong one).
6. Rate-limit check (unchanged position relative to the exam-not-open check
   below — matches the current file: only rate-limited *after* IP+revocation
   pass, since those aren't credential-shaped failures).
7. Exam must be `live` → `EXAM_NOT_OPEN_ERROR` (no rate-limit charge,
   unchanged).
8. Find student by matric number, must be active → not-found path
   (rate-limited + logged, unchanged).
9. Entry-window check with the in-progress-attempt escape hatch (unchanged
   logic, now reading `findInProgressAttempt`).
10. Mint session: `createSession({ userId: student.id, channel:
    'exam_access', verifiedExamId: exam.id, clientIp })`.
11. Clear rate-limit history, log `logged_in`, redirect to `/lab/{code}`.

**`verifyResultAccess(prevState, formData)`** — same shape, minus
`university_slug` handling (single-tenant; FR-INST-3 is already locked in).
No IP allowlist check (FR-LAB-2 explicitly exempts result lookup).

**`endStudentSession(code, returnTo)`** — reads the session via
`readStudentSession()`, logs `logged_out` (university_id comes from the
returned user, no extra query needed), calls `destroySession()`, then the
existing `isSafeReturnPath` allowlist redirect logic (unchanged).

---

## 4. Pages

- **`app/lab/page.js`, `LabCodeEntry`** — unchanged; already
  backend-agnostic.
- **`app/lab/[code]/page.js`** — replaced. Pre-auth: unchanged
  `MatricEntryForm`. Post-auth (session channel `exam_access` verified for
  this exam): a stub showing exam title + duration (from
  `findExamByAccessCode`) and "Your exam will begin shortly" copy, plus
  `EndSessionButton`. No question count, no instructions, no attempt/resume
  logic — Slice 6 replaces this page's post-auth branch entirely.
- **`app/check-result/page.js`** — replaced. Pre-auth: `CheckResultForm`
  without the `universitySlug` prop. Post-auth (session channel
  `result_lookup`): a stub reading real released `Result` rows if trivial via
  a direct Prisma query scoped to this student (no repo abstraction needed
  for one query used in one place); otherwise "No results yet." Includes an
  end-session control.
- **Untouched:** `app/check-result/[slug]/page.js`, `app/(auth)/[slug]/*` —
  still Supabase-backed, unreachable via any new link, removed in Slice 3.

---

## 5. Testing

- `lib/security/clientIp.test.js` (NFR-TEST-5): exact IPv4 match/non-match,
  CIDR match/non-match, `TRUST_PROXY=0` ignores `X-Forwarded-For`,
  `TRUST_PROXY=1` reads the rightmost hop, malformed input fails closed.
- Repo tests for `labIpAllowlist.js`, `verificationAttempts.js`,
  `students.js`, `exams.js` (allow/deny paths, matching Slice 1's pattern).
- `lib/actions/studentAuth.test.js` rewritten against the Prisma test
  client (Slice 1's approach), covering: happy path both flows, rate
  limiting (and its clearing on success), revoked code treated as
  not-found, non-live exam, entry-window-closed-but-in-progress-attempt
  escape hatch, IP-blocked (and that it does **not** burn a rate-limit
  charge), empty-allowlist-with-enforcement-on fails closed,
  `enforce_ip_allowlist=false` skips the check entirely.
- Seed additions (`prisma/seed.mjs`, dev-only): a sample `live` exam with a
  known access code, a demo student, and a couple of
  `LabIpAllowlist` entries (`127.0.0.1`, `::1`) so `curl`/browser
  verification from the dev machine passes the allowlist.
- Manual UAT additions (NFR-TEST-4): entry from a non-allowlisted IP is
  refused with the distinct message; revoking a code blocks new entry but
  not an already-in-progress attempt.

---

## 6. Self-review

**Placeholder scan:** none — every module and check above has concrete
inputs/outputs; no "TBD".

**Internal consistency:** the check ordering in §3 matches the current
Supabase file's documented rationale (why IP/revocation don't cost a
rate-limit charge, why the exam-not-open check doesn't either) — verified
against `lib/actions/studentAuth.js:68-157` line by line.

**Scope check:** focused enough for one implementation plan. The
minimal-entry-only `exams.js` repo (rather than a full one) is the one
place scope could silently balloon; the plan must explicitly cap its
exported functions to the two listed in §2.

**Ambiguity check:** "reads real released results if trivial" (§4) was
tightened to "a direct Prisma query scoped to this student, no repo
abstraction" — removing the earlier open-ended phrasing.
