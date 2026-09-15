# SQL Server Migration — Slice 3: Admin & Structure (single-tenant consolidation)

**Date:** 2026-09-15
**Status:** Design approved, implementation pending
**Owner:** DNLCodess
**Parent design:** `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md`
**Prior slices:** Slice 0 (infra), Slice 1 (staff auth), Slice 2 (student
credential-less auth + lab IP gate) are merged into `sqlserver-migration`.

---

## 1. Scope

Per the parent design's §6 slice plan: `lib/actions/admin.js`, institution
settings, faculties/departments/courses/users repos + pages, the lab IP
allowlist admin page, and dropping subdomain routing / `/[slug]/*` pages
(FR-INST-1..4, FR-LAB-1, FR-LAB-3's UI half).

### The consolidation decision

Exploring the current code surfaced a structural fact the parent design's
slice list didn't spell out: `/super-admin/*` today is an **entire
multi-tenant platform-admin surface** — a universities list, a
cross-university dashboard, a platform-wide users table — that only exists
*because* of multi-tenancy. FR-INST-3 already locks in the single-tenant
collapse ("`super_admin` collapses to a single top-level admin role");
this slice is where that collapse actually happens in the UI, not just the
data model.

**Decision (confirmed with the user):** delete `/super-admin/universities`,
`/super-admin/dashboard`, and `/super-admin/users` entirely.
`super_admin` and `school_admin` share one `/admin/*` route tree.
`super_admin` gets a strict superset of permissions inside it — institution
branding, the lab IP allowlist, removing any user — rather than a parallel
dashboard. `/admin/logs` and the old `/super-admin/logs` were already
near-identical (diff showed only a university-name column and the role
gate); this is the general shape of the whole surface once multi-tenancy is
gone.

### In scope

- **FR-INST-1**: institution settings (name, logo, primary color) editable
  by `super_admin`, on a new `/admin/settings` page.
- **FR-INST-3**: `school_admin` and `super_admin` share the admin pages;
  role only gates the extra capabilities listed above.
- **FR-INST-4**: faculties/departments/courses CRUD — unchanged behavior,
  ported to Prisma.
- **FR-LAB-1**: lab IP allowlist admin page (`/admin/lab-network`) — list,
  add a single entry, the "add range" bulk helper (expands a start–end IP
  span into per-host entries), activate/deactivate toggle. Built by both
  roles per the parent design's exact wording.
- **FR-LAB-3**'s UI half: nothing new here — the `enforce_ip_allowlist`
  per-exam toggle lives on the exam edit page, which is Slice 5. This slice
  only ships the allowlist *management* page.
- User management: invite staff (lecturer/school_admin), bulk student
  roster upload, activate/deactivate, and (new, unified) remove any user —
  available to both roles, minus each admin acting on themselves.
- Removing legacy multi-tenant routing: `/[slug]/login`,
  `/[slug]/forgot-password`, `/check-result/[slug]`, and the matching
  regex in `proxy.js` (FR-INST-2).

### Explicitly out of scope

- `enforce_ip_allowlist` per-exam override UI, access-code generate/revoke
  UI — Slice 5 (exams).
- Question bank — Slice 4.
- Anything under `/lecturer/*` — untouched, still Supabase-backed, ported
  in later slices as those own areas are reached.
- Removing `@supabase/*` / `lib/supabase/*` — Slice 7 (other areas still
  depend on it until their own slices land).

---

## 2. New / extended repositories

All new files follow the Slice 1/2 convention: `import 'server-only'`,
import `prisma` from `@/lib/db/client`, one file per aggregate.

- **`lib/db/repositories/institution.js`** (new) — `getInstitution()`
  (the single `University` row — there is always exactly one, seeded in
  Slice 0), `updateInstitution({ name, logoUrl, primaryColor })`.
- **`lib/db/repositories/structure.js`** (new) — `listFaculties()`,
  `createFaculty(name)`, `listDepartments()`,
  `createDepartment({ name, facultyId })`, `listCourses()`,
  `createCourse({ courseCode, courseTitle, departmentId, creditUnits,
  level, semester })`. Unique-constraint violations (Prisma error code
  `P2002`) map to the same field-level errors the Supabase version
  returned on Postgres code `23505`.
- **`lib/db/repositories/users.js`** (extends Slice 1's file) —
  `listStaffAndStudents()` (one query for the merged users page — replaces
  both the old university-scoped and platform-wide versions, since there's
  one university now), `createStaffUser({...})`, `createStudentUser({...})`
  (both take a pre-hashed or null `password_hash` — see §3 on invites),
  `setUserActive(id, isActive)`, `removeUser(id)` (sets `is_active=false`,
  `removed_at=now`).
- **`lib/db/repositories/labIpAllowlist.js`** (extends Slice 2's file) —
  adds `addRange({ universityId, startIp, endIp, label, createdBy })`
  (expands to one row per host), `setEntryActive(id, isActive)`,
  `listAllEntries(universityId)` (active + inactive, for the admin table —
  Slice 2's `listActiveEntries` is unchanged and stays the one enforcement
  reads).
- **`lib/db/repositories/auditLog.js`** (extends Slice 1's file) — adds
  `listRecentActions(limit)` for `/admin/logs`.

---

## 3. `lib/actions/admin.js` rewrite

**Deleted outright** (multi-tenant-only, no single-tenant equivalent):
`createUniversity`, `inviteExamOfficer`, `updateUniversityBranding`,
`superAdminToggleUserActive`, `superAdminRemoveUser`,
`RESERVED_SUBDOMAINS`, `universitySchema`, `brandingSchema`.

**Ported to Prisma, same validation and behavior, role gate widened to
`requireRole('school_admin', 'super_admin')`:** `inviteUser`,
`bulkUploadStudents`, `createFaculty`, `createDepartment`, `createCourse`.
The temp-password-per-invite security property (a fresh
`crypto.randomBytes(18)` password per invite, shown once, never a shared
convention) is preserved exactly — `generateTempPassword()` carries over
unchanged. Since staff/student accounts are now rows this app inserts
directly (no Supabase Auth `createUser` call), the invite functions hash
the temp password with `lib/auth/password.js`'s `hashPassword()` (Slice 1)
and set `must_change_password: true` — closing the same gap Slice 1 closed
for the seeded super-admin, now for every invited account too.

**New:**
- `updateInstitutionSettings(prevState, formData)` — `super_admin` only.
- `toggleUserActive(userId)`, `removeUser(userId)` — unified, no
  separate super-admin copies. Both available to `school_admin` and
  `super_admin`; both refuse to act on the caller's own account (preserved
  from the original).
- `addLabIpAllowlistEntry(prevState, formData)`,
  `addLabIpAllowlistRange(prevState, formData)`,
  `toggleLabIpAllowlistEntry(entryId)` — `school_admin` + `super_admin`
  (FR-LAB-1's exact wording).

---

## 4. Pages

- **`/admin/dashboard`, `/admin/users`, `/admin/structure`,
  `/admin/courses`, `/admin/logs`** — role gate widened to
  `requireRole('school_admin', 'super_admin')`; queries drop their
  `university_id` filters (single-tenant, same precedent Slice 2 set).
  `/admin/users` gains a "Remove" action next to the existing
  activate/deactivate toggle, and a `super_admin: 'Platform Admin'` entry
  in its role-label map (so a co-admin displays correctly instead of
  falling through to `undefined`).
- **New `/admin/settings`** — institution name/logo/primary-color form.
  `super_admin` only (`requireRole('super_admin')` — a stricter gate than
  the shared pages above, not the shared one).
- **New `/admin/lab-network`** — the FR-LAB-1 admin UI: a table of all
  entries (active and inactive, with the "add range" helper's expanded
  rows collapsible or just listed flatly — flat list is simpler and this
  slice doesn't need more), a single-entry add form, a range add form
  (start IP, end IP, label — expands server-side), and an active/inactive
  toggle per row. Both roles.
- **`components/shared/Sidebar.js`**: `super_admin`'s nav array becomes
  the same `/admin/*` set `school_admin` uses, plus `Settings` and
  `Lab Network`. `school_admin`'s nav gains `Lab Network`.
- **Deleted:** `app/super-admin/**` in full, including
  `CreateUniversityForm.js`, `UniversityRow.js`, `SuperAdminUserActions.js`.

---

## 5. Legacy multi-tenant routing removal (FR-INST-2)

- Delete `app/(auth)/[slug]/login/page.js`,
  `app/(auth)/[slug]/forgot-password/page.js`,
  `app/check-result/[slug]/page.js`.
- Delete `app/check-result/CheckAnotherResultButton.js` — its only
  consumer was the `[slug]` check-result page being deleted above (Slice 2
  deliberately left it in place for exactly this reason).
- Remove the legacy slug regex from `proxy.js`
  (`/^\/[a-z0-9-]+\/(login|forgot-password)$/i`) and its explanatory
  comment.
- Grep for other components whose only remaining consumer is one of the
  deleted pages (e.g. `UniversityBadge`) and delete those too — but keep
  `lib/universityTheme.js` / `getUniversityThemeStyle`, which the single
  institution's branding (logo/color) still uses on `/admin/layout.js` and
  the login page.

---

## 6. Testing

- Repo tests (real Prisma test DB, `testPrisma`/`resetDb`/
  `seedMinimalStructure`) for all five repository files — allow/deny and
  uniqueness-violation paths, matching Slices 1–2's pattern.
- Action tests (fully mocked repos via `vi.mock`) for the rewritten
  `admin.js` — one test per branch: role-gate rejection, validation
  failure, uniqueness conflict, happy path, self-action refusal on
  toggle/remove.
- No new page-level tests — no precedent for them anywhere in this
  codebase (confirmed: zero `.test.js` files under `app/`).
- Manual UAT: sign in as `school_admin`, confirm `/admin/settings` and
  `/admin/lab-network`'s super-admin-only actions are inaccessible or
  hidden as appropriate; sign in as `super_admin`, confirm the full
  `/admin/*` surface works including the new pages; confirm
  `/super-admin/*` and `/[slug]/*` URLs now 404 or redirect sanely rather
  than error.

---

## 7. Self-review

**Placeholder scan:** none.

**Internal consistency:** the "unify vs keep separate" decision for
user-management actions is applied consistently — `toggleUserActive` and
`removeUser` each have exactly one definition, used by both roles, matching
§1's stated decision and not contradicted anywhere else in this doc.

**Scope check:** focused enough for one implementation plan. The
`/admin/lab-network` page is the one place scope could balloon (a
full IP-management UI could grow indefinitely); §4 caps it explicitly to
list + single-add + range-add + toggle, no edit-in-place, no delete (matches
FR-LAB-1's description exactly, nothing more).

**Ambiguity check:** "collapsible... or just listed flatly" in §4 was
resolved in-line to flat listing — no open question left for the
implementation plan to trip over.
