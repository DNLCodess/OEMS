# Credential-less Student Authentication — Design

## Problem

Students are currently onboarded the same way as staff: an exam officer opens
`InviteUserModal` and fills in one student at a time (name, email, matric
number, level), which creates an `auth.users` row with a shared hardcoded
temporary password (`ChangeMe123!`) via `inviteUser()`
(`lib/actions/admin.js`).

This doesn't hold up against how the system is actually used:

- A single course exam can have hundreds of students; a department across a
  semester, thousands. No exam officer will fill out that modal one student
  at a time, every semester, for every cohort — there is no bulk import
  anywhere in the app today.
- This is a CBT platform with no ongoing engagement: students show up, sit
  one exam, leave. A persistent password account is the wrong primitive for
  that relationship — it's a SaaS onboarding pattern applied to what is
  really a per-exam access problem.
- A student's real identity in a Nigerian university is their matric number,
  not an email address. Email is secondary and often unreliable, especially
  under exam-day time pressure.
- The shared static temp password (`ChangeMe123!`) with no forced reset is a
  live security gap independent of all of the above.

## Goal

Remove passwords from the student experience entirely — not hide them, not
auto-generate them, genuinely not have them. Students authenticate with data
the university already has (matric number) plus a per-exam access code or,
for checking an already-released result later, matric number + date of
birth. Staff (lecturer / school_admin / super_admin) are unaffected — they
keep the existing email + password invite flow (a separate, smaller ticket
adds forced-password-change-on-first-login for that flow).

This design covers **authentication only**. Eligibility logic (which
students can access which exam — `exam_access` allow-list, course/level/
department matching) is unchanged and reused as-is.

## Non-goals

- Changing how staff (lecturer/school_admin/super_admin) authenticate.
- Changing exam eligibility computation.
- A general-purpose student portal / browsable dashboard for the
  credential-less flow (see "Session scope" below) — out of scope for v1.
- Migrating existing student accounts — confirmed pre-launch, only demo/test
  data exists (`seeding.md`), so there is nothing to migrate.

## Session-minting mechanism

`public.users.id` is a hard foreign key to `auth.users.id`
(`supabase/schema.sql`), so every student still needs a real `auth.users`
row — that's not avoidable without discarding the existing RLS model (~30
policies keyed off `auth.uid()` via `auth_role()`/`auth_university_id()`),
which is the actual hard-won part of this system and out of scope to redo.

**Chosen approach: passwordless, server-side magic-link verification.**

- At roster upload, an `auth.users` row is created per student via the
  admin/service-role client (`email_confirm: true`), using a synthetic
  internal email (`<matric_number>@<university-subdomain>.oems.internal`)
  the student never sees or uses. No password is set in any meaningful
  sense — Supabase's create-user call may require *a* value internally, but
  it is generated, never stored, never surfaced, and never used to sign in.
- When a student verifies (matric + access code, or matric + DOB), the
  server — using the admin client — calls
  `supabase.auth.admin.generateLink({ type: 'magiclink', email })`, then
  immediately verifies the resulting token server-side
  (`supabase.auth.verifyOtp({ type: 'magiclink', token_hash })`) using the
  request-scoped SSR client, establishing a real session cookie in the same
  request. This is entirely invisible to the student.
- Everything downstream — `requireRole('student')`, `lib/dal.js`, every RLS
  policy — is unchanged. This design only changes how the session gets
  established, not what it looks like once established.

**Rejected alternatives:**
- *Service-role `signInWithPassword` with a hidden auto-generated password*
  — to log the student in later, the server would need to know that
  password, meaning it's either stored somewhere (recreating the exact
  shared-secret problem this design removes) or reset every time
  (pointless indirection around the chosen approach).
- *Hand-crafted JWT set directly as the session cookie* — still requires
  the same `auth.users` row, forfeits Supabase's session refresh/expiry
  handling, and repeats the pattern that caused the RLS-recursion bug this
  team already hit once (`20260419130000_fix_exam_rls_recursion.sql`).
  Reimplementing an auth primitive by hand has already proven risky here.

## Data model changes

- `users`: add `date_of_birth DATE`, nullable, students-only (mirrors the
  existing `matric_number`/`level` columns and their
  `students_have_matric`-style CHECK pattern). A roster row that omits it
  simply can't use result self-lookup until backfilled — doesn't block
  upload.
- `users.email`: for students, the synthetic internal address described
  above, set at roster-upload time.
- `exams.lab_code` → renamed to `exams.access_code`; the implicit
  lab-mode-only usage is dropped — every exam (`remote` or `lab`) gets a
  code. One migration; update references in
  `components/exams/LabCodePanel.js`, `lib/actions/exams.js`, and the
  lecturer exam detail page.
- New `verification_attempts` table: `(matric_number, ip, created_at)` — a
  cheap DB-backed throttle for both verification endpoints. Date of birth
  in particular has low entropy as a shared secret; this is a low-stakes
  but not zero-stakes read path and needs basic guarding.

## Flows

Both entry points are unauthenticated, public routes. They replace
`/lab/[code]` as the general entry surface — lab vs. remote exam mode no
longer needs separate entry UX, since the code-entry step is now identical
either way.

**Enter exam** (matric number + access code):
1. Validate the exam is `live` and the code matches.
2. Validate the matric number exists in that university's roster and is
   eligible (existing `exam_access`/course-level-department logic,
   unchanged).
3. Mint a session (see above).
4. Land directly in that one exam — the existing attempt start/resume logic
   in `app/lab/[code]/page.js` is reused as-is, just reached differently.

**Check result** (matric number + date of birth):
1. Validate the matric number + DOB pair matches a roster record.
2. Mint a session.
3. Land directly on that one released result. Nothing else browsable.

**Session scope:** single-purpose by design. Neither flow grants access to
a general student dashboard — no browsing other exams or other results.
This matches the "show up, take one exam, leave" shape of the system and
limits what a shared/lab-kiosk session exposes if left open.

**Session hygiene:** before minting a new session, explicitly sign out any
existing session in that browser context first, to prevent session bleed
between students sharing a kiosk machine. Sign out again after exam
submission or after leaving the result view.

## Error handling / edge cases

- Wrong matric number, wrong code/DOB, exam not live, or not eligible: a
  single generic error message ("check your details and try again") in all
  cases — don't reveal which field was wrong, to avoid leaking which matric
  numbers are valid/registered.
- Rate limiting via `verification_attempts`: e.g. 5 failed attempts per
  `(matric_number, ip)` per 15 minutes, then a short lockout. Blunts
  brute-forcing either the access code or the DOB.
- Disconnect mid-exam: re-entering the same matric + code re-verifies and
  resumes the existing `in_progress` attempt — this already works today via
  the existing attempt lookup in `app/lab/[code]/page.js`, unchanged.
- Staff accounts are entirely untouched by this design.

## Testing

- Unit tests for the new verification logic (matric/code/DOB validation,
  eligibility check reuse, rate-limit table interaction) following the
  Supabase-mock pattern established in `tests/helpers/supabaseMock.js`
  (see `2026-08-04-testing-setup-design.md`).
- The actual session-minting call (`generateLink` + `verifyOtp`) is a real
  Supabase Auth interaction and is best covered by manual/integration
  verification against a linked Supabase project rather than mocked unit
  tests, consistent with how this codebase already treats RLS/SQL
  correctness (manual migration review, not unit-testable).
