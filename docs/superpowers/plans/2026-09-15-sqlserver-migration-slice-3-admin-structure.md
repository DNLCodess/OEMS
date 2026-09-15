# SQL Server Migration — Slice 3: Admin & Structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port faculties/departments/courses/users admin management and institution settings off Supabase onto Prisma/SQL Server; add the lab IP allowlist admin UI (FR-LAB-1); collapse `/super-admin/*` into one shared `/admin/*` surface now that the platform is single-tenant; remove legacy `/[slug]/*` multi-tenant routing.

**Architecture:** Five repository files (three new: `institution.js`, `structure.js`; three extended: `users.js`, `labIpAllowlist.js`, `auditLog.js`) back a rewritten `lib/actions/admin.js`. Existing `/admin/*` pages get their role gate widened and their data layer swapped from Supabase to Prisma; two new pages (`/admin/settings`, `/admin/lab-network`) are added. `/super-admin/*` and the legacy `/[slug]/*` routes are deleted outright, along with the components that only they used.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma (`sqlserver` provider), Vitest, `@node-rs/argon2` (via Slice 1's `lib/auth/password.js`).

**Spec:** `docs/superpowers/specs/2026-09-15-sqlserver-migration-slice-3-admin-structure-design.md`

## Global Constraints

- `email` and `matric_number` have **no unique constraint** at the DB level (confirmed in `prisma/schema.prisma`) — unlike the old Supabase Auth version, which relied on Supabase's own unique-email index. "Already registered" checks are therefore explicit application-level lookups (`findUserByEmailForAuth` / `findStudentByMatric`), not caught DB errors. `Faculty`/`Department`/`Course` **do** have compound `@@unique` indexes — those creates catch Prisma error code `P2002`.
- Invited staff get a fresh `crypto.randomBytes(18)` temp password (never a shared convention), hashed with `hashPassword()` before storage, `must_change_password: true` — same security property Slice 1 established for the seeded super-admin.
- Students never get a password (`password_hash: null`) — they authenticate credential-less (Slice 2).
- All new/extended repo files: `import 'server-only'`, import `prisma` from `@/lib/db/client`, one file per aggregate — matches Slices 1–2.
- Role gate on every shared admin page/action: `requireRole('school_admin', 'super_admin')`. `super_admin`-only actions (`updateInstitutionSettings`) use `requireRole('super_admin')` alone.
- Run `npm test` after every task; all tests must stay green.
- The `/admin/dashboard` rewrite (Task 7) is **partial**: exam/result counts stay on Supabase because exams/attempts/results aren't ported until Slices 5–6 — only user/structure counts move to Prisma. This is a deliberate, documented seam, not an oversight.

---

## Task 1: `lib/db/repositories/institution.js`

**Files:**
- Create: `lib/db/repositories/institution.js`
- Test: `lib/db/repositories/institution.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces: `getInstitution(): Promise<University>`, `updateInstitution({ name, logoUrl, primaryColor }): Promise<University>`. Task 6's `admin.js` calls both.

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/institution.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import { getInstitution, updateInstitution } from './institution'

describe('repositories/institution', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('getInstitution returns the single university row', async () => {
    const created = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const found = await getInstitution()
    expect(found.id).toBe(created.id)
  })

  it('getInstitution returns null when no row exists', async () => {
    expect(await getInstitution()).toBeNull()
  })

  it('updateInstitution updates name, logo, and color', async () => {
    await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const updated = await updateInstitution({ name: 'PCU Updated', logoUrl: '/pcu/logo.png', primaryColor: '#112233' })
    expect(updated.name).toBe('PCU Updated')
    expect(updated.logo_url).toBe('/pcu/logo.png')
    expect(updated.primary_color).toBe('#112233')
  })

  it('updateInstitution clears logo/color when passed null', async () => {
    await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu', logo_url: '/x.png', primary_color: '#000000' } })
    const updated = await updateInstitution({ name: 'PCU', logoUrl: null, primaryColor: null })
    expect(updated.logo_url).toBeNull()
    expect(updated.primary_color).toBeNull()
  })

  it('updateInstitution throws when no institution row exists', async () => {
    await expect(updateInstitution({ name: 'X', logoUrl: null, primaryColor: null })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/institution.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/institution.js
import 'server-only'
import { prisma } from '@/lib/db/client'

export async function getInstitution() {
  return prisma.university.findFirst()
}

export async function updateInstitution({ name, logoUrl, primaryColor }) {
  const institution = await prisma.university.findFirst({ select: { id: true } })
  if (!institution) throw new Error('No institution row exists')
  return prisma.university.update({
    where: { id: institution.id },
    data: { name, logo_url: logoUrl || null, primary_color: primaryColor || null },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/institution.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/institution.js lib/db/repositories/institution.test.js
git commit -m "feat(db): institution settings repo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/db/repositories/structure.js`

**Files:**
- Create: `lib/db/repositories/structure.js`
- Test: `lib/db/repositories/structure.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces: `listFaculties()`, `createFaculty(universityId, name)`, `listDepartments()`, `createDepartment({ universityId, facultyId, name })`, `listCourses()` (includes `department.faculty`), `createCourse({ universityId, courseCode, courseTitle, departmentId, creditUnits, level, semester })`. Task 6's `admin.js` calls all six; Task 7's dashboard rewrite calls `listCourses`/`listDepartments`; Task 8's `/admin/structure` and `/admin/courses` pages call the `list*` functions.

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/structure.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import {
  listFaculties, createFaculty, listDepartments, createDepartment, listCourses, createCourse,
} from './structure'

describe('repositories/structure', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createFaculty then listFaculties returns it', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    await createFaculty(uni.id, 'Science')
    const rows = await listFaculties()
    expect(rows.map(f => f.name)).toEqual(['Science'])
  })

  it('createFaculty rejects a duplicate name for the same university', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    await createFaculty(uni.id, 'Science')
    await expect(createFaculty(uni.id, 'Science')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('createDepartment then listDepartments returns it', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    const rows = await listDepartments()
    expect(rows.map(d => d.name)).toEqual(['Computer Science'])
  })

  it('createDepartment rejects a duplicate name within the same faculty', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    await expect(createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('createCourse then listCourses returns it with department and faculty', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    const dept = await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    await createCourse({
      universityId: uni.id, courseCode: 'CSC 301', courseTitle: 'Data Structures',
      departmentId: dept.id, creditUnits: 3, level: '300', semester: 'first',
    })
    const rows = await listCourses()
    expect(rows).toHaveLength(1)
    expect(rows[0].course_code).toBe('CSC 301')
    expect(rows[0].department.name).toBe('Computer Science')
    expect(rows[0].department.faculty.name).toBe('Science')
  })

  it('createCourse rejects a duplicate course code for the same university', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    const dept = await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    const data = { universityId: uni.id, courseCode: 'CSC 301', courseTitle: 'X', departmentId: dept.id, creditUnits: 3, level: '300', semester: 'first' }
    await createCourse(data)
    await expect(createCourse({ ...data, courseTitle: 'Y' })).rejects.toMatchObject({ code: 'P2002' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/structure.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/structure.js
import 'server-only'
import { prisma } from '@/lib/db/client'

export async function listFaculties() {
  return prisma.faculty.findMany({ orderBy: { name: 'asc' } })
}

export async function createFaculty(universityId, name) {
  return prisma.faculty.create({ data: { university_id: universityId, name } })
}

export async function listDepartments() {
  return prisma.department.findMany({ orderBy: { name: 'asc' } })
}

export async function createDepartment({ universityId, facultyId, name }) {
  return prisma.department.create({ data: { university_id: universityId, faculty_id: facultyId, name } })
}

export async function listCourses() {
  return prisma.course.findMany({
    orderBy: { course_code: 'asc' },
    include: { department: { include: { faculty: true } } },
  })
}

export async function createCourse({ universityId, courseCode, courseTitle, departmentId, creditUnits, level, semester }) {
  return prisma.course.create({
    data: {
      university_id: universityId, course_code: courseCode, course_title: courseTitle,
      department_id: departmentId, credit_units: creditUnits, level, semester,
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/structure.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/structure.js lib/db/repositories/structure.test.js
git commit -m "feat(db): faculties/departments/courses repo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Extend `lib/db/repositories/users.js`

**Files:**
- Modify: `lib/db/repositories/users.js`
- Modify: `lib/db/repositories/users.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client` (already imported in this file).
- Produces (new, added alongside the existing `findUserByEmailForAuth`/`findUserById`/`setUserPassword`): `listStaffAndStudents({ excludeUserId } = {})`, `createStaffUser({ universityId, email, fullName, role, departmentId, facultyId, passwordHash })`, `createStudentUser({ universityId, email, fullName, matricNumber, level, dateOfBirth, departmentId, facultyId })`, `setUserActive(id, isActive)`, `markUserRemoved(id)`. Task 6's `admin.js` imports all five; `findUserById` (existing) is reused for the toggle/remove self-action and already-removed checks.

- [ ] **Step 1: Write the failing tests** (append to `lib/db/repositories/users.test.js` — read the existing file first to match its `aUser`-style helpers if present; if the file doesn't exist yet, create it with just these tests)

```js
// Add to lib/db/repositories/users.test.js (or create it with this content
// plus the existing findUserByEmailForAuth/findUserById/setUserPassword
// tests already in the file, if any — check before overwriting).
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import {
  listStaffAndStudents, createStaffUser, createStudentUser, setUserActive, markUserRemoved,
} from './users'

describe('repositories/users — admin management', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createStaffUser creates a staff account with a hashed password and must_change_password', async () => {
    const { university } = await seedMinimalStructure()
    const staff = await createStaffUser({
      universityId: university.id, email: 'new@pcu.edu', fullName: 'New Staff', role: 'lecturer',
      departmentId: null, facultyId: null, passwordHash: 'HASH',
    })
    expect(staff.email).toBe('new@pcu.edu')
    expect(staff.password_hash).toBe('HASH')
    expect(staff.must_change_password).toBe(true)
  })

  it('createStudentUser creates a student with no password', async () => {
    const { university } = await seedMinimalStructure()
    const student = await createStudentUser({
      universityId: university.id, email: 's@internal', fullName: 'A Student',
      matricNumber: 'CSC/2021/001', level: '300', dateOfBirth: new Date('2003-05-14'),
      departmentId: null, facultyId: null,
    })
    expect(student.matric_number).toBe('CSC/2021/001')
    expect(student.password_hash).toBeNull()
  })

  it('listStaffAndStudents returns staff and student roles, excluding a given id', async () => {
    const { university } = await seedMinimalStructure()
    const a = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const b = await createStaffUser({ universityId: university.id, email: 'b@pcu.edu', fullName: 'B', role: 'school_admin', passwordHash: 'H' })
    const rows = await listStaffAndStudents({ excludeUserId: b.id })
    expect(rows.map(r => r.id)).toEqual([a.id])
  })

  it('setUserActive flips is_active', async () => {
    const { university } = await seedMinimalStructure()
    const u = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const updated = await setUserActive(u.id, false)
    expect(updated.is_active).toBe(false)
  })

  it('markUserRemoved sets is_active false and removed_at', async () => {
    const { university } = await seedMinimalStructure()
    const u = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const updated = await markUserRemoved(u.id)
    expect(updated.is_active).toBe(false)
    expect(updated.removed_at).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/users.test.js`
Expected: FAIL — the new functions don't exist yet (existing tests in the file, if any, still pass).

- [ ] **Step 3: Add the implementation** (append to `lib/db/repositories/users.js`, after the existing `setUserPassword`)

```js
export async function listStaffAndStudents({ excludeUserId } = {}) {
  return prisma.user.findMany({
    where: {
      role: { in: ['super_admin', 'school_admin', 'lecturer', 'student'] },
      ...(excludeUserId && { id: { not: excludeUserId } }),
    },
    select: { ...SAFE_USER_SELECT, created_at: true, department: { select: { name: true } } },
    orderBy: [{ role: 'asc' }, { full_name: 'asc' }],
  })
}

export async function createStaffUser({ universityId, email, fullName, role, departmentId = null, facultyId = null, passwordHash }) {
  return prisma.user.create({
    data: {
      university_id: universityId, email, full_name: fullName, role,
      department_id: departmentId, faculty_id: facultyId,
      password_hash: passwordHash, must_change_password: true,
    },
  })
}

export async function createStudentUser({ universityId, email, fullName, matricNumber, level, dateOfBirth = null, departmentId = null, facultyId = null }) {
  return prisma.user.create({
    data: {
      university_id: universityId, email, full_name: fullName, role: 'student',
      matric_number: matricNumber, level, date_of_birth: dateOfBirth,
      department_id: departmentId, faculty_id: facultyId,
    },
  })
}

export async function setUserActive(id, isActive) {
  return prisma.user.update({
    where: { id },
    data: { is_active: isActive },
    select: { id: true, is_active: true, university_id: true },
  })
}

export async function markUserRemoved(id) {
  return prisma.user.update({
    where: { id },
    data: { is_active: false, removed_at: new Date() },
    select: { id: true, university_id: true, removed_at: true },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/users.test.js`
Expected: PASS (all tests, existing + new).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/repositories/users.js lib/db/repositories/users.test.js
git commit -m "feat(db): admin user-management functions (create staff/student, activate, remove)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Extend `lib/db/repositories/labIpAllowlist.js` + `lib/security/clientIp.js`

**Files:**
- Modify: `lib/security/clientIp.js` (add `isValidEntry`)
- Modify: `lib/security/clientIp.test.js`
- Modify: `lib/db/repositories/labIpAllowlist.js`
- Modify: `lib/db/repositories/labIpAllowlist.test.js`

**Interfaces:**
- `isValidEntry(entry): boolean` — validates IPv4-or-CIDR *shape* (not allowlist membership). Task 6's `admin.js` imports it for form validation.
- `listAllEntries(universityId)`, `setEntryActive(id, isActive)`, `addRange({ universityId, startIp, endIp, label, createdBy })` — added to the existing `labIpAllowlist.js` alongside Slice 2's `listActiveEntries`/`createEntry` (unchanged). `addRange` caps at 1024 hosts and skips any host already present for the university rather than failing the whole batch.

- [ ] **Step 1: Write the failing test for `isValidEntry`** (append to `lib/security/clientIp.test.js`)

```js
// Add to lib/security/clientIp.test.js — update the import line to also
// pull in isValidEntry:
// import { resolveClientIp, isIpAllowed, isValidEntry } from './clientIp'

describe('isValidEntry', () => {
  it('accepts a plain IPv4 address', () => {
    expect(isValidEntry('192.168.1.11')).toBe(true)
  })
  it('accepts a CIDR range', () => {
    expect(isValidEntry('192.168.1.0/24')).toBe(true)
  })
  it('rejects a malformed address', () => {
    expect(isValidEntry('not-an-ip')).toBe(false)
  })
  it('rejects an out-of-range octet', () => {
    expect(isValidEntry('192.168.1.999')).toBe(false)
  })
  it('rejects an out-of-range CIDR suffix', () => {
    expect(isValidEntry('192.168.1.0/33')).toBe(false)
  })
  it('rejects empty input', () => {
    expect(isValidEntry('')).toBe(false)
    expect(isValidEntry(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/security/clientIp.test.js -t isValidEntry`
Expected: FAIL — `isValidEntry` is not exported.

- [ ] **Step 3: Add `isValidEntry` to `lib/security/clientIp.js`** (after `isIpAllowed`, reusing the file's existing private `ipv4ToInt`)

```js
export function isValidEntry(entry) {
  if (!entry) return false
  const [ip, bits] = entry.split('/')
  if (ipv4ToInt(ip) === null) return false
  if (bits === undefined) return true
  const n = Number(bits)
  return Number.isInteger(n) && n >= 0 && n <= 32
}
```

- [ ] **Step 4: Run clientIp tests to verify they pass**

Run: `npx vitest run lib/security/clientIp.test.js`
Expected: PASS (19 tests: 13 existing + 6 new).

- [ ] **Step 5: Write the failing tests for the allowlist repo extensions** (append to `lib/db/repositories/labIpAllowlist.test.js`)

```js
// Add to lib/db/repositories/labIpAllowlist.test.js — update the import
// line to also pull in listAllEntries, setEntryActive, addRange.

it('listAllEntries includes both active and inactive rows', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  const row = await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
  await prisma.labIpAllowlist.update({ where: { id: row.id }, data: { is_active: false } })
  const rows = await listAllEntries(university.id)
  expect(rows).toHaveLength(1)
  expect(rows[0].is_active).toBe(false)
})

it('setEntryActive flips is_active', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  const row = await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
  const updated = await setEntryActive(row.id, false)
  expect(updated.is_active).toBe(false)
})

it('addRange creates one row per host in the range', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  const created = await addRange({ universityId: university.id, startIp: '192.168.1.10', endIp: '192.168.1.12', label: 'Lab A', createdBy: admin.id })
  expect(created).toHaveLength(3)
  const rows = await listAllEntries(university.id)
  expect(rows.map(r => r.entry).sort()).toEqual(['192.168.1.10', '192.168.1.11', '192.168.1.12'])
})

it('addRange skips hosts already present instead of erroring', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
  const created = await addRange({ universityId: university.id, startIp: '192.168.1.10', endIp: '192.168.1.12', label: null, createdBy: admin.id })
  expect(created).toHaveLength(2)
  const rows = await listAllEntries(university.id)
  expect(rows).toHaveLength(3)
})

it('addRange rejects a range where start is after end', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  await expect(addRange({ universityId: university.id, startIp: '192.168.1.20', endIp: '192.168.1.10', label: null, createdBy: admin.id })).rejects.toThrow()
})

it('addRange rejects a range larger than 1024 hosts', async () => {
  const { university } = await seedMinimalStructure()
  const admin = await aUser(university.id)
  await expect(addRange({ universityId: university.id, startIp: '10.0.0.0', endIp: '10.0.4.255', label: null, createdBy: admin.id })).rejects.toThrow()
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run lib/db/repositories/labIpAllowlist.test.js`
Expected: 4 existing tests pass, 6 new tests FAIL — functions not exported.

- [ ] **Step 7: Add the implementation** (append to `lib/db/repositories/labIpAllowlist.js`)

```js
export async function listAllEntries(universityId) {
  return prisma.labIpAllowlist.findMany({
    where: { university_id: universityId },
    orderBy: { created_at: 'desc' },
  })
}

export async function setEntryActive(id, isActive) {
  return prisma.labIpAllowlist.update({ where: { id }, data: { is_active: isActive } })
}

const MAX_RANGE_HOSTS = 1024

function ipToInt(ip) {
  return ip.split('.').map(Number).reduce((acc, o) => (acc << 8) + o, 0) >>> 0
}
function intToIp(n) {
  return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')
}

// Expands a start-end IPv4 range into individual per-host rows — the
// "add range" bulk helper FR-LAB-1 describes for the ~50-PC per-host
// approach. Skips any host already present for this university rather
// than erroring the whole batch on one collision.
export async function addRange({ universityId, startIp, endIp, label, createdBy }) {
  const startInt = ipToInt(startIp)
  const endInt = ipToInt(endIp)
  if (startInt > endInt) throw new Error('Range start must not be after range end')
  if (endInt - startInt + 1 > MAX_RANGE_HOSTS) throw new Error(`Range too large (max ${MAX_RANGE_HOSTS} hosts)`)

  const existing = await prisma.labIpAllowlist.findMany({
    where: { university_id: universityId },
    select: { entry: true },
  })
  const existingSet = new Set(existing.map((e) => e.entry))

  const created = []
  for (let n = startInt; n <= endInt; n++) {
    const ip = intToIp(n)
    if (existingSet.has(ip)) continue
    created.push(await prisma.labIpAllowlist.create({
      data: { university_id: universityId, entry: ip, label, created_by: createdBy },
    }))
  }
  return created
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/labIpAllowlist.test.js`
Expected: PASS (10 tests).

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/security/clientIp.js lib/security/clientIp.test.js lib/db/repositories/labIpAllowlist.js lib/db/repositories/labIpAllowlist.test.js
git commit -m "feat(db): lab IP allowlist admin operations (range add, toggle, list all)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Extend `lib/db/repositories/auditLog.js`

**Files:**
- Modify: `lib/db/repositories/auditLog.js`
- Modify: `lib/db/repositories/auditLog.test.js`

**Interfaces:**
- Produces (new): `listRecentActions(limit = 100)` → rows with `{ id, action, created_at, target_identifier, meta, actor: { full_name }, target: { full_name } }`. Task 9's `/admin/logs` page calls it.

- [ ] **Step 1: Write the failing test** (append to `lib/db/repositories/auditLog.test.js`)

```js
// Add to lib/db/repositories/auditLog.test.js
import { listRecentActions } from './auditLog' // add to the existing import line

it('listRecentActions returns rows newest-first with actor/target names', async () => {
  const { university } = await seedMinimalStructure()
  const actor = await prisma.user.create({ data: { university_id: university.id, role: 'school_admin', email: 'a@pcu.edu', full_name: 'Actor' } })
  const target = await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'Target' } })
  await recordAuthEvent({ action: 'activated', actor_id: actor.id, target_user_id: target.id, university_id: university.id })
  await new Promise((r) => setTimeout(r, 5))
  await recordAuthEvent({ action: 'deactivated', actor_id: actor.id, target_user_id: target.id, university_id: university.id })

  const rows = await listRecentActions(10)
  expect(rows).toHaveLength(2)
  expect(rows[0].action).toBe('deactivated')
  expect(rows[0].actor.full_name).toBe('Actor')
  expect(rows[0].target.full_name).toBe('Target')
})

it('listRecentActions respects the limit', async () => {
  const { university } = await seedMinimalStructure()
  for (let i = 0; i < 3; i++) {
    await recordAuthEvent({ action: 'login_failed', target_identifier: `x${i}`, university_id: university.id })
  }
  const rows = await listRecentActions(2)
  expect(rows).toHaveLength(2)
})
```

Note: `auditLog.test.js` likely already imports `testPrisma`/`resetDb`/`seedMinimalStructure` and `recordAuthEvent` — read the existing file first and add only the missing import (`listRecentActions`) to its import line rather than duplicating imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db/repositories/auditLog.test.js`
Expected: existing tests pass, 2 new tests FAIL — `listRecentActions` not exported.

- [ ] **Step 3: Add the implementation** (append to `lib/db/repositories/auditLog.js`)

```js
export async function listRecentActions(limit = 100) {
  return prisma.adminActionLog.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true, action: true, created_at: true, target_identifier: true, meta: true,
      actor: { select: { full_name: true } },
      target: { select: { full_name: true } },
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/auditLog.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/repositories/auditLog.js lib/db/repositories/auditLog.test.js
git commit -m "feat(db): listRecentActions for the merged admin logs page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `lib/actions/admin.js`

**Files:**
- Modify: `lib/actions/admin.js` (full rewrite)
- Modify: `lib/actions/admin.test.js` (full rewrite)

**Interfaces:**
- Consumes: everything built in Tasks 1–5, plus `hashPassword` from `@/lib/auth/password` (Slice 1), `requireRole` from `@/lib/dal`, `findUserByEmailForAuth`/`findUserById` from `@/lib/db/repositories/users` (existing), `findStudentByMatric` from `@/lib/db/repositories/students` (Slice 2), `recordAuthEvent` from `@/lib/db/repositories/auditLog`, `isValidEntry` from `@/lib/security/clientIp` (Task 4), `isDarkEnoughForWhiteText` from `@/lib/universityTheme` (existing, unchanged).
- Produces: `inviteUser`, `bulkUploadStudents`, `createFaculty`, `createDepartment`, `createCourse` (same names/signatures the existing forms already call — no page/component changes needed for these five), plus new: `updateInstitutionSettings`, `toggleUserActive`, `removeUser`, `addLabIpAllowlistEntry`, `addLabIpAllowlistRange`, `toggleLabIpAllowlistEntry`. Tasks 8–10's pages/forms call the new ones.

- [ ] **Step 1: Write the failing tests** (full replacement of `lib/actions/admin.test.js`)

```js
// lib/actions/admin.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'HASHED') }))
vi.mock('@/lib/db/repositories/users', () => ({
  findUserByEmailForAuth: vi.fn(),
  findUserById: vi.fn(),
  createStaffUser: vi.fn(),
  createStudentUser: vi.fn(),
  setUserActive: vi.fn(),
  markUserRemoved: vi.fn(),
}))
vi.mock('@/lib/db/repositories/students', () => ({ findStudentByMatric: vi.fn() }))
vi.mock('@/lib/db/repositories/structure', () => ({
  createFaculty: vi.fn(),
  createDepartment: vi.fn(),
  createCourse: vi.fn(),
}))
vi.mock('@/lib/db/repositories/institution', () => ({ updateInstitution: vi.fn() }))
vi.mock('@/lib/db/repositories/labIpAllowlist', () => ({
  createEntry: vi.fn(),
  addRange: vi.fn(),
  setEntryActive: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))
vi.mock('@/lib/security/clientIp', () => ({ isValidEntry: vi.fn(() => true) }))

import { requireRole } from '@/lib/dal'
import { findUserByEmailForAuth, findUserById, createStaffUser, createStudentUser, setUserActive, markUserRemoved } from '@/lib/db/repositories/users'
import { findStudentByMatric } from '@/lib/db/repositories/students'
import { createFaculty, createDepartment, createCourse } from '@/lib/db/repositories/structure'
import { updateInstitution } from '@/lib/db/repositories/institution'
import { createEntry, addRange, setEntryActive } from '@/lib/db/repositories/labIpAllowlist'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { isValidEntry } from '@/lib/security/clientIp'
import {
  inviteUser, bulkUploadStudents, createFaculty as createFacultyAction, createDepartment as createDepartmentAction,
  createCourse as createCourseAction, updateInstitutionSettings, toggleUserActive, removeUser,
  addLabIpAllowlistEntry, addLabIpAllowlistRange, toggleLabIpAllowlistEntry,
} from './admin'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
const ADMIN = { id: 'admin-1', university_id: 'uni-1', role: 'school_admin' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(ADMIN)
  isValidEntry.mockReturnValue(true)
})

describe('inviteUser', () => {
  it('rejects an already-registered email', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'existing' })
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'A', role: 'lecturer' }))
    expect(r.errors.email[0]).toMatch(/already registered/i)
    expect(createStaffUser).not.toHaveBeenCalled()
  })

  it('creates a staff user with a hashed temp password and returns it once', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    createStaffUser.mockResolvedValue({ id: 'new-1' })
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'A', role: 'lecturer' }))
    expect(r.ok).toBe(true)
    expect(r.email).toBe('a@pcu.edu')
    expect(typeof r.tempPassword).toBe('string')
    expect(createStaffUser).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'HASHED', role: 'lecturer' }))
  })

  it('rejects an invalid role', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'A', role: 'student' }))
    expect(r.errors.role).toBeDefined()
    expect(createStaffUser).not.toHaveBeenCalled()
  })
})

describe('bulkUploadStudents', () => {
  it('creates new students and reports already-registered ones as failed', async () => {
    findStudentByMatric.mockImplementation(async (m) => (m === 'CSC/2021/001' ? { id: 'exists' } : null))
    createStudentUser.mockResolvedValue({ id: 'new' })
    const roster = 'CSC/2021/001,Existing Student,300\nCSC/2021/002,New Student,200'
    const r = await bulkUploadStudents(undefined, fd({ roster }))
    expect(r.ok).toBe(true)
    expect(r.createdCount).toBe(1)
    expect(r.failed).toEqual([{ matric_number: 'CSC/2021/001', reason: 'Already registered' }])
  })

  it('rejects an empty roster', async () => {
    const r = await bulkUploadStudents(undefined, fd({ roster: '' }))
    expect(r.errors._form).toBeDefined()
  })
})

describe('createFaculty / createDepartment / createCourse', () => {
  it('createFaculty maps a P2002 to a field error', async () => {
    createFaculty.mockRejectedValue({ code: 'P2002' })
    const r = await createFacultyAction(undefined, fd({ name: 'Science' }))
    expect(r.errors.name[0]).toMatch(/already exists/i)
  })

  it('createFaculty happy path', async () => {
    createFaculty.mockResolvedValue({ id: 'f1' })
    const r = await createFacultyAction(undefined, fd({ name: 'Science' }))
    expect(r.ok).toBe(true)
  })

  it('createDepartment maps a P2002 to a field error', async () => {
    createDepartment.mockRejectedValue({ code: 'P2002' })
    const r = await createDepartmentAction(undefined, fd({ name: 'CS', faculty_id: 'f1' }))
    expect(r.errors.name[0]).toMatch(/already exists/i)
  })

  it('createCourse maps a P2002 to a field error', async () => {
    createCourse.mockRejectedValue({ code: 'P2002' })
    const r = await createCourseAction(undefined, fd({
      course_code: 'CSC 301', course_title: 'X', department_id: 'd1', credit_units: '3', level: '300', semester: 'first',
    }))
    expect(r.errors.course_code[0]).toMatch(/already exists/i)
  })

  it('createCourse happy path', async () => {
    createCourse.mockResolvedValue({ id: 'c1' })
    const r = await createCourseAction(undefined, fd({
      course_code: 'CSC 301', course_title: 'X', department_id: 'd1', credit_units: '3', level: '300', semester: 'first',
    }))
    expect(r.ok).toBe(true)
  })
})

describe('updateInstitutionSettings', () => {
  it('requires super_admin', async () => {
    await updateInstitutionSettings(undefined, fd({ name: 'PCU' }))
    expect(requireRole).toHaveBeenCalledWith('super_admin')
  })

  it('happy path updates the institution', async () => {
    updateInstitution.mockResolvedValue({ id: 'uni-1' })
    const r = await updateInstitutionSettings(undefined, fd({ name: 'PCU', primary_color: '#112233', logo_url: '/x.png' }))
    expect(r.ok).toBe(true)
    expect(updateInstitution).toHaveBeenCalledWith({ name: 'PCU', logoUrl: '/x.png', primaryColor: '#112233' })
  })

  it('rejects a name shorter than 3 chars', async () => {
    const r = await updateInstitutionSettings(undefined, fd({ name: 'PC' }))
    expect(r.errors.name).toBeDefined()
    expect(updateInstitution).not.toHaveBeenCalled()
  })
})

describe('toggleUserActive', () => {
  it('refuses to act on your own account', async () => {
    const r = await toggleUserActive('admin-1')
    expect(r.error).toMatch(/cannot deactivate your own/i)
    expect(setUserActive).not.toHaveBeenCalled()
  })

  it('refuses on a removed user', async () => {
    findUserById.mockResolvedValue({ id: 'u2', is_active: false, removed_at: new Date(), university_id: 'uni-1' })
    const r = await toggleUserActive('u2')
    expect(r.error).toMatch(/removed/i)
  })

  it('flips active state and logs the event', async () => {
    findUserById.mockResolvedValue({ id: 'u2', is_active: true, removed_at: null, university_id: 'uni-1' })
    const r = await toggleUserActive('u2')
    expect(r.ok).toBe(true)
    expect(r.is_active).toBe(false)
    expect(setUserActive).toHaveBeenCalledWith('u2', false)
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivated', target_user_id: 'u2' }))
  })
})

describe('removeUser', () => {
  it('refuses to act on your own account', async () => {
    const r = await removeUser('admin-1')
    expect(r.error).toMatch(/cannot remove your own/i)
    expect(markUserRemoved).not.toHaveBeenCalled()
  })

  it('refuses on an already-removed user', async () => {
    findUserById.mockResolvedValue({ id: 'u2', removed_at: new Date(), university_id: 'uni-1' })
    const r = await removeUser('u2')
    expect(r.error).toMatch(/already been removed/i)
  })

  it('happy path marks removed and logs the event', async () => {
    findUserById.mockResolvedValue({ id: 'u2', removed_at: null, university_id: 'uni-1' })
    const r = await removeUser('u2')
    expect(r.ok).toBe(true)
    expect(markUserRemoved).toHaveBeenCalledWith('u2')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'removed', target_user_id: 'u2' }))
  })
})

describe('lab IP allowlist actions', () => {
  it('addLabIpAllowlistEntry rejects a malformed entry', async () => {
    isValidEntry.mockReturnValue(false)
    const r = await addLabIpAllowlistEntry(undefined, fd({ entry: 'nope' }))
    expect(r.errors.entry).toBeDefined()
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('addLabIpAllowlistEntry happy path', async () => {
    const r = await addLabIpAllowlistEntry(undefined, fd({ entry: '192.168.1.11', label: 'Lab A' }))
    expect(r.ok).toBe(true)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ entry: '192.168.1.11', universityId: 'uni-1' }))
  })

  it('addLabIpAllowlistRange happy path', async () => {
    addRange.mockResolvedValue([{}, {}, {}])
    const r = await addLabIpAllowlistRange(undefined, fd({ start_ip: '192.168.1.10', end_ip: '192.168.1.12' }))
    expect(r.ok).toBe(true)
    expect(r.count).toBe(3)
  })

  it('addLabIpAllowlistRange surfaces a repo error as a form error', async () => {
    addRange.mockRejectedValue(new Error('Range too large (max 1024 hosts)'))
    const r = await addLabIpAllowlistRange(undefined, fd({ start_ip: '10.0.0.0', end_ip: '10.0.4.255' }))
    expect(r.errors._form).toMatch(/too large/i)
  })

  it('toggleLabIpAllowlistEntry calls the repo', async () => {
    const r = await toggleLabIpAllowlistEntry('entry-1', false)
    expect(r.ok).toBe(true)
    expect(setEntryActive).toHaveBeenCalledWith('entry-1', false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: FAIL — the rewritten action module doesn't exist yet (old Supabase version still in place).

- [ ] **Step 3: Write the implementation** (full replacement of `lib/actions/admin.js`)

```js
'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/dal'
import { hashPassword } from '@/lib/auth/password'
import {
  findUserByEmailForAuth, findUserById, createStaffUser, createStudentUser, setUserActive, markUserRemoved,
} from '@/lib/db/repositories/users'
import { findStudentByMatric } from '@/lib/db/repositories/students'
// Aliased: this file exports its own createFaculty/createDepartment/createCourse
// actions with the same names — importing the repo functions unaliased would
// shadow them.
import {
  createFaculty as createFacultyRepo,
  createDepartment as createDepartmentRepo,
  createCourse as createCourseRepo,
} from '@/lib/db/repositories/structure'
import { updateInstitution } from '@/lib/db/repositories/institution'
import { createEntry, addRange, setEntryActive } from '@/lib/db/repositories/labIpAllowlist'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { isValidEntry } from '@/lib/security/clientIp'
import { isDarkEnoughForWhiteText } from '@/lib/universityTheme'

const ADMIN_ROLES = ['school_admin', 'super_admin']

// A single hardcoded temp password shared by every invited account is a
// standing credential — anyone who knows the convention could sign in to
// any invited-but-not-yet-reset account. Generate a fresh one per invite;
// it's shown once to the admin who created the account.
function generateTempPassword() {
  return randomBytes(18).toString('base64url')
}

function isUniqueConstraintError(e) {
  return e?.code === 'P2002'
}

// ─── User management ─────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email:         z.string().email('Valid email required'),
  full_name:     z.string().min(2, 'Full name required'),
  role:          z.enum(['lecturer', 'school_admin']),
  department_id: z.string().uuid().optional().or(z.literal('')),
  faculty_id:    z.string().uuid().optional().or(z.literal('')),
})

export async function inviteUser(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = inviteSchema.safeParse({
    email:         formData.get('email')?.trim(),
    full_name:     formData.get('full_name')?.trim(),
    role:          formData.get('role'),
    department_id: formData.get('department_id') || undefined,
    faculty_id:    formData.get('faculty_id') || undefined,
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  const { email, full_name, role, department_id, faculty_id } = parsed.data

  // No unique constraint on `email` at the DB level (see Global Constraints) —
  // this check is the only thing standing between two invites colliding.
  if (await findUserByEmailForAuth(email)) {
    return { errors: { email: ['This email is already registered.'] } }
  }

  const tempPassword = generateTempPassword()
  // No audit-log entry here — the original Supabase version never logged
  // invites either (only activate/deactivate/remove/login events are
  // tracked in admin_action_log; inventing a new use of an existing action
  // like 'activated' for this would misrepresent what actually happened).
  await createStaffUser({
    universityId: admin.university_id, email, fullName: full_name, role,
    departmentId: department_id || null, facultyId: faculty_id || null,
    passwordHash: await hashPassword(tempPassword),
  })

  revalidatePath('/admin/users')
  return { ok: true, email, tempPassword }
}

// ─── Bulk student roster upload ───────────────────────────────────────────────

const studentRowSchema = z.object({
  matric_number: z.string().min(1, 'Matric number required').transform(s => s.toUpperCase()),
  full_name:     z.string().min(2, 'Full name required'),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional().or(z.literal('')),
})

function parseRosterText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [matric_number, full_name, level, date_of_birth] = line.split(',').map(s => s?.trim())
      return { matric_number, full_name, level, date_of_birth }
    })
}

// Students never get a password — they authenticate via matric number + a
// per-exam access code (lib/actions/studentAuth.js), never via email.
export async function bulkUploadStudents(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const rosterText    = formData.get('roster') ?? ''
  const department_id = formData.get('department_id') || null
  const faculty_id     = formData.get('faculty_id') || null

  const rows = parseRosterText(rosterText)
  if (rows.length === 0) {
    return { errors: { _form: 'Paste at least one student row (matric number, full name, level).' } }
  }

  const created = []
  const failed  = []

  for (const row of rows) {
    const parsed = studentRowSchema.safeParse(row)
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid row'
      failed.push({ matric_number: row.matric_number || '(blank)', reason: firstError })
      continue
    }

    const { matric_number, full_name, level, date_of_birth } = parsed.data

    // No unique constraint on `matric_number` at the DB level — same
    // reasoning as the email check above.
    if (await findStudentByMatric(matric_number)) {
      failed.push({ matric_number, reason: 'Already registered' })
      continue
    }

    const localPart = matric_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    const email = `${localPart}@${admin.university_id}.students.pcu-cbt.internal`

    await createStudentUser({
      universityId: admin.university_id, email, fullName: full_name,
      matricNumber: matric_number, level,
      dateOfBirth: date_of_birth ? new Date(date_of_birth) : null,
      departmentId: department_id, facultyId: faculty_id,
    })
    created.push(matric_number)
  }

  revalidatePath('/admin/users')
  return { ok: true, createdCount: created.length, failed }
}

export async function toggleUserActive(userId) {
  const admin = await requireRole(...ADMIN_ROLES)
  if (userId === admin.id) return { error: 'You cannot deactivate your own account.' }

  const target = await findUserById(userId)
  if (!target) return { error: 'User not found.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active
  await setUserActive(userId, nextActive)
  await recordAuthEvent({
    action: nextActive ? 'activated' : 'deactivated',
    actor_id: admin.id, target_user_id: userId, university_id: target.university_id,
  })

  revalidatePath('/admin/users')
  return { ok: true, is_active: nextActive }
}

export async function removeUser(userId) {
  const admin = await requireRole(...ADMIN_ROLES)
  if (userId === admin.id) return { error: 'You cannot remove your own account.' }

  const target = await findUserById(userId)
  if (!target) return { error: 'User not found.' }
  if (target.removed_at) return { error: 'This user has already been removed.' }

  await markUserRemoved(userId)
  await recordAuthEvent({
    action: 'removed', actor_id: admin.id, target_user_id: userId, university_id: target.university_id,
  })

  revalidatePath('/admin/users')
  return { ok: true }
}

// ─── Academic structure ───────────────────────────────────────────────────────

export async function createFaculty(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const name = formData.get('name')?.trim()
  if (!name || name.length < 2) return { errors: { name: ['Faculty name must be at least 2 characters.'] } }

  try {
    await createFacultyRepo(admin.university_id, name)
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { name: ['A faculty with this name already exists.'] } }
    throw e
  }

  revalidatePath('/admin/structure')
  return { ok: true }
}

export async function createDepartment(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const name       = formData.get('name')?.trim()
  const faculty_id = formData.get('faculty_id')
  if (!name || name.length < 2) return { errors: { name: ['Department name required.'] } }
  if (!faculty_id) return { errors: { faculty_id: ['Select a faculty.'] } }

  try {
    await createDepartmentRepo({ universityId: admin.university_id, facultyId: faculty_id, name })
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { name: ['A department with this name already exists in this faculty.'] } }
    throw e
  }

  revalidatePath('/admin/structure')
  return { ok: true }
}

const courseSchema = z.object({
  course_code:   z.string().min(2, 'Course code required').toUpperCase(),
  course_title:  z.string().min(2, 'Course title required'),
  department_id: z.string().uuid('Select a department'),
  credit_units:  z.coerce.number().int().min(1).max(6),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']),
  semester:      z.enum(['first', 'second']),
})

export async function createCourse(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = courseSchema.safeParse({
    course_code:   formData.get('course_code')?.trim(),
    course_title:  formData.get('course_title')?.trim(),
    department_id: formData.get('department_id'),
    credit_units:  formData.get('credit_units'),
    level:         formData.get('level'),
    semester:      formData.get('semester'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  try {
    await createCourseRepo({
      universityId: admin.university_id, courseCode: parsed.data.course_code, courseTitle: parsed.data.course_title,
      departmentId: parsed.data.department_id, creditUnits: parsed.data.credit_units,
      level: parsed.data.level, semester: parsed.data.semester,
    })
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { course_code: ['This course code already exists.'] } }
    throw e
  }

  revalidatePath('/admin/courses')
  return { ok: true }
}

// ─── Institution settings (FR-INST-1) ────────────────────────────────────────

const institutionSchema = z.object({
  name: z.string().min(3, 'Institution name required'),
  primary_color: z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid hex color')
    .refine(isDarkEnoughForWhiteText, 'This color is too light for white button text to stay readable — try a darker shade.')
    .optional().or(z.literal('')),
  logo_url: z.string()
    .refine(s => /^https?:\/\//.test(s) || s.startsWith('/'), 'Enter a full URL (https://...) or a path starting with /')
    .optional().or(z.literal('')),
})

export async function updateInstitutionSettings(prevState, formData) {
  await requireRole('super_admin')

  const parsed = institutionSchema.safeParse({
    name:          formData.get('name')?.trim(),
    primary_color: formData.get('primary_color')?.trim() || '',
    logo_url:      formData.get('logo_url')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  await updateInstitution({
    name: parsed.data.name,
    logoUrl: parsed.data.logo_url || null,
    primaryColor: parsed.data.primary_color || null,
  })

  revalidatePath('/admin/settings')
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

// ─── Lab IP allowlist (FR-LAB-1) ──────────────────────────────────────────────

const singleEntrySchema = z.object({
  entry: z.string().min(7, 'Enter an IPv4 address or CIDR range'),
  label: z.string().optional().or(z.literal('')),
})

export async function addLabIpAllowlistEntry(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = singleEntrySchema.safeParse({
    entry: formData.get('entry')?.trim(),
    label: formData.get('label')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  if (!isValidEntry(parsed.data.entry)) {
    return { errors: { entry: ['Enter a valid IPv4 address or CIDR (e.g. 192.168.1.11 or 192.168.1.0/24).'] } }
  }

  await createEntry({ universityId: admin.university_id, entry: parsed.data.entry, label: parsed.data.label || null, createdBy: admin.id })
  revalidatePath('/admin/lab-network')
  return { ok: true }
}

const rangeSchema = z.object({
  start_ip: z.string(),
  end_ip: z.string(),
  label: z.string().optional().or(z.literal('')),
})

export async function addLabIpAllowlistRange(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = rangeSchema.safeParse({
    start_ip: formData.get('start_ip')?.trim(),
    end_ip: formData.get('end_ip')?.trim(),
    label: formData.get('label')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  if (!isValidEntry(parsed.data.start_ip) || parsed.data.start_ip.includes('/')) {
    return { errors: { start_ip: ['Enter a plain IPv4 address, not a range.'] } }
  }
  if (!isValidEntry(parsed.data.end_ip) || parsed.data.end_ip.includes('/')) {
    return { errors: { end_ip: ['Enter a plain IPv4 address, not a range.'] } }
  }

  try {
    const created = await addRange({
      universityId: admin.university_id, startIp: parsed.data.start_ip, endIp: parsed.data.end_ip,
      label: parsed.data.label || null, createdBy: admin.id,
    })
    revalidatePath('/admin/lab-network')
    return { ok: true, count: created.length }
  } catch (e) {
    return { errors: { _form: e.message } }
  }
}

export async function toggleLabIpAllowlistEntry(entryId, isActive) {
  await requireRole(...ADMIN_ROLES)
  await setEntryActive(entryId, isActive)
  revalidatePath('/admin/lab-network')
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: PASS (all tests). If any fail on mock-call-shape mismatches, check the alias note above was applied correctly.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/admin.js lib/actions/admin.test.js
git commit -m "feat(admin): port admin actions to Prisma, add institution settings + lab IP allowlist management

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Rewrite `/admin/dashboard`, `/admin/users` pages

**Files:**
- Modify: `app/admin/dashboard/page.js`
- Modify: `app/admin/users/page.js`
- Create: `app/admin/users/RemoveUserButton.js`

**Interfaces:**
- Consumes: `listCourses`/`listDepartments` (Task 2), `listStaffAndStudents` (Task 3), `removeUser`/`toggleUserActive` (Task 6).
- Produces: nothing new consumed elsewhere — leaf pages/components.

- [ ] **Step 1: Rewrite `app/admin/dashboard/page.js`**

Role gate widens to both admin roles. Lecturer/student/course/department
counts and the department breakdown move to Prisma. Exam counts, recent
exams, and pass-rate stay on Supabase — exams/attempts/results aren't
ported until Slices 5–6, so their SQL Server tables are empty; querying
them there would silently show zero everywhere. The "Sign-in link" section
is deleted outright (FR-INST-2 — no more per-institution subdomain URL).

```js
import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { listCourses, listDepartments } from '@/lib/db/repositories/structure'
import { listStaffAndStudents } from '@/lib/db/repositories/users'
import { TopBar } from '@/components/shared/TopBar'
import { Badge } from '@/components/ui/Badge'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import {
  Users, ClipboardList, BookOpen, GraduationCap, ArrowRight,
  AlertTriangle, Building2,
} from 'lucide-react'

export const metadata = { title: 'Dashboard' }

export default async function AdminDashboardPage() {
  const user     = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  // Prisma-backed: users and structure are ported this slice.
  const [allUsers, departments, courses] = await Promise.all([
    listStaffAndStudents({ excludeUserId: user.id }),
    listDepartments(),
    listCourses(),
  ])
  const lecturerCount = allUsers.filter(u => u.role === 'lecturer' && u.is_active).length
  const studentCount  = allUsers.filter(u => u.role === 'student' && u.is_active).length

  // Supabase-backed: exams/attempts/results aren't ported until Slices 5–6 —
  // their SQL Server tables exist but are empty, so these counts must keep
  // reading the pre-migration data source for now.
  const [
    { count: activeExamCount, error: activeExamCountError },
    { data: recentExams, error: recentExamsError },
    { data: closedExams, error: closedExamsError },
  ] = await Promise.all([
    supabase.from('exams').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id).in('status', ['scheduled', 'live']),
    supabase.from('exams')
      .select('id, title, status, created_at, courses!course_id ( course_code ), users:created_by ( full_name )')
      .eq('university_id', user.university_id)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('exams').select('id').eq('university_id', user.university_id).eq('status', 'closed'),
  ])

  const uniExamIds = (closedExams ?? []).map(e => e.id)
  const { data: uniResults, error: uniResultsError } = uniExamIds.length
    ? await supabase.from('results').select('passed').in('exam_id', uniExamIds)
    : { data: [] }

  const dashboardError = activeExamCountError || recentExamsError || closedExamsError || uniResultsError
  if (dashboardError) console.error('[AdminDashboardPage]', dashboardError)

  const deptMap = {}
  for (const u of allUsers) {
    if (!u.department?.name) continue
    // department relation only gives us the name here, not the id — group
    // by name (department names are unique within their own faculty, and
    // this dashboard doesn't need cross-faculty disambiguation).
    const key = u.department.name
    if (!deptMap[key]) deptMap[key] = { students: 0, lecturers: 0 }
    if (u.role === 'student')  deptMap[key].students++
    if (u.role === 'lecturer') deptMap[key].lecturers++
  }
  const enrichedDepts = departments
    .map(d => ({ ...d, ...(deptMap[d.name] ?? { students: 0, lecturers: 0 }) }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 6)

  const passRate = (uniResults ?? []).length > 0
    ? Math.round(((uniResults ?? []).filter(r => r.passed).length / uniResults.length) * 100)
    : null

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Welcome back, ${user.full_name}`} />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={GraduationCap}  label="Lecturers"     value={lecturerCount} href="/admin/users" />
          <StatCard icon={Users}          label="Students"      value={studentCount}  href="/admin/users" />
          <StatCard icon={BookOpen}       label="Courses"       value={courses.length} href="/admin/courses" />
          <StatCard icon={ClipboardList}  label="Active Exams"  value={activeExamCount ?? 0} href="/admin/exams" />
        </div>

        {dashboardError ? (
          <QueryErrorBanner message="Failed to load some dashboard data. Please refresh." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Recent Exams</h2>
                <Link href="/admin/exams" className="text-xs text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              {(recentExams ?? []).length === 0 ? (
                <div className="bg-surface border border-border rounded-xl p-8 text-center">
                  <ClipboardList size={32} className="text-text-muted mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No exams yet.</p>
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-xl divide-y divide-border">
                  {recentExams.map(exam => (
                    <div key={exam.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono text-xs text-text-muted">{exam.courses?.course_code}</span>
                          <Badge variant={exam.status} />
                        </div>
                        <p className="text-sm font-medium text-text-primary">{exam.title}</p>
                        <p className="text-xs text-text-muted">by {exam.users?.full_name ?? '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="bg-surface border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-4">Institution Health</h2>
                <div className="space-y-3">
                  {[
                    { label: 'Departments', value: departments.length },
                    { label: 'Courses',     value: courses.length },
                    { label: 'Pass rate',   value: passRate !== null ? `${passRate}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <span className="text-xs text-text-muted">{s.label}</span>
                      <span className="text-sm font-semibold text-text-primary tabular-nums">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {enrichedDepts.length > 0 && (
                <div className="bg-surface border border-border rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-text-primary mb-4">Top Departments</h2>
                  <div className="space-y-2">
                    {enrichedDepts.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">{d.name}</span>
                        <span className="text-text-muted">{d.students} students · {d.lecturers} lecturers</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}

function StatCard({ icon: Icon, label, value, href }) {
  const content = (
    <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 transition-colors">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-light shrink-0">
        <Icon className="size-5 text-primary" />
      </span>
      <div>
        <p className="text-2xl font-bold tabular-nums text-text-primary">{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}
```

- [ ] **Step 2: Create `app/admin/users/RemoveUserButton.js`**

```js
'use client'

import { useState, useTransition } from 'react'
import { removeUser } from '@/lib/actions/admin'
import { toast } from 'sonner'

export function RemoveUserButton({ userId }) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  function handleClick() {
    if (!confirming) { setConfirming(true); return }
    startTransition(async () => {
      const result = await removeUser(userId)
      if (result?.error) toast.error(result.error)
      else toast.success('User removed.')
      setConfirming(false)
    })
  }

  return (
    <button
      onClick={handleClick}
      onBlur={() => setConfirming(false)}
      disabled={pending}
      className={[
        'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ml-1',
        confirming ? 'text-white bg-danger' : 'text-danger hover:bg-danger-light',
      ].join(' ')}
    >
      {pending ? '…' : confirming ? 'Confirm?' : 'Remove'}
    </button>
  )
}
```

- [ ] **Step 3: Rewrite `app/admin/users/page.js`**

```js
import { requireRole } from '@/lib/dal'
import { listStaffAndStudents } from '@/lib/db/repositories/users'
import { listFaculties, listDepartments } from '@/lib/db/repositories/structure'
import { TopBar } from '@/components/shared/TopBar'
import { InviteUserModal } from './InviteUserModal'
import { BulkUploadStudentsModal } from './BulkUploadStudentsModal'
import { ToggleActiveButton } from './ToggleActiveButton'
import { RemoveUserButton } from './RemoveUserButton'

export const metadata = { title: 'Users — PCU CBT' }

const ROLE_LABELS = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer',
  student:      'Student',
}

export default async function AdminUsersPage() {
  const user = await requireRole('school_admin', 'super_admin')

  const [users, faculties, departments] = await Promise.all([
    listStaffAndStudents({ excludeUserId: user.id }),
    listFaculties(),
    listDepartments(),
  ])

  const grouped = { super_admin: [], school_admin: [], lecturer: [], student: [] }
  for (const u of users) {
    if (grouped[u.role]) grouped[u.role].push(u)
  }

  return (
    <>
      <TopBar
        title="User Management"
        subtitle="Invite and manage lecturers, students, and exam officers"
        actions={
          <div className="flex items-center gap-2">
            <BulkUploadStudentsModal faculties={faculties} departments={departments} />
            <InviteUserModal faculties={faculties} departments={departments} />
          </div>
        }
      />
      <main className="flex-1 p-6 space-y-8">
        {Object.entries(grouped).map(([role, roleUsers]) => (
          roleUsers.length === 0 && role === 'super_admin' ? null : (
            <section key={role}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-text-primary">{ROLE_LABELS[role]}s</h2>
                <span className="text-xs text-text-muted bg-page border border-border rounded-full px-2 py-0.5">
                  {roleUsers.length}
                </span>
              </div>

              {roleUsers.length === 0 ? (
                <p className="text-sm text-text-muted py-4 text-center border border-dashed border-border rounded-xl">
                  No {ROLE_LABELS[role].toLowerCase()}s yet.
                </p>
              ) : (
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-page">
                        <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Name</th>
                        <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Email</th>
                        {role === 'student' && (
                          <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">Matric / Level</th>
                        )}
                        <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden lg:table-cell">Department</th>
                        <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {roleUsers.map(u => (
                        <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                          <td className="px-4 py-3 font-medium text-text-primary">{u.full_name}</td>
                          <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">
                            {role === 'student'
                              ? <span className="text-text-muted italic">No email (matric login)</span>
                              : u.email}
                          </td>
                          {role === 'student' && (
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="font-mono text-xs text-text-secondary">{u.matric_number}</span>
                              {u.level && <span className="text-xs text-text-muted ml-2">{u.level}L</span>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-text-muted text-xs hidden lg:table-cell">
                            {u.department?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                              u.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                            }`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <ToggleActiveButton userId={u.id} isActive={u.is_active} />
                            <RemoveUserButton userId={u.id} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        ))}
      </main>
    </>
  )
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass (no new tests for these pages — no precedent for page tests in this codebase; this step confirms nothing else broke, e.g. a stale import).

- [ ] **Step 5: Commit**

```bash
git add app/admin/dashboard/page.js app/admin/users/page.js app/admin/users/RemoveUserButton.js
git commit -m "feat(admin): rewrite dashboard and users pages against Prisma repos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Widen role gates on `/admin/structure`, `/admin/courses`, `/admin/logs`; rewrite their data layer

**Files:**
- Modify: `app/admin/structure/page.js`
- Modify: `app/admin/courses/page.js`
- Modify: `app/admin/logs/page.js`

**Interfaces:**
- Consumes: `listFaculties`/`listDepartments`/`listCourses` (Task 2), `listRecentActions` (Task 5).

- [ ] **Step 1: Update `app/admin/structure/page.js`**

Replace the `requireRole('school_admin')` call and the Supabase queries:

```js
import { requireRole } from '@/lib/dal'
import { listFaculties, listDepartments } from '@/lib/db/repositories/structure'
import { TopBar } from '@/components/shared/TopBar'
import { CreateFacultyForm, CreateDepartmentForm } from './StructureForms'
import { Building2, ChevronRight } from 'lucide-react'

export const metadata = { title: 'Faculties & Departments — PCU CBT' }

export default async function AdminStructurePage() {
  await requireRole('school_admin', 'super_admin')

  const [faculties, departments] = await Promise.all([listFaculties(), listDepartments()])

  const deptsByFaculty = {}
  for (const d of departments) {
    if (!deptsByFaculty[d.faculty_id]) deptsByFaculty[d.faculty_id] = []
    deptsByFaculty[d.faculty_id].push(d)
  }

  return (
    <>
      <TopBar title="Faculties & Departments" subtitle="Define your institution's academic structure" />
      <main className="flex-1 p-6">
        <div className="max-w-4xl grid lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Add Structure</h2>
            <CreateFacultyForm />
            <CreateDepartmentForm faculties={faculties} />
          </div>

          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Current Structure
              <span className="ml-2 text-xs font-normal text-text-muted">
                {faculties.length} {faculties.length === 1 ? 'faculty' : 'faculties'} · {departments.length} departments
              </span>
            </h2>

            {!faculties.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
                <Building2 size={32} className="text-text-muted mb-3" />
                <p className="text-sm font-medium text-text-primary mb-1">No structure yet</p>
                <p className="text-xs text-text-muted">Add your first faculty to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {faculties.map(faculty => (
                  <div key={faculty.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-primary-light border-b border-primary/10">
                      <Building2 size={15} className="text-primary shrink-0" />
                      <span className="text-sm font-semibold text-primary">{faculty.name}</span>
                    </div>
                    {(deptsByFaculty[faculty.id] ?? []).length === 0 ? (
                      <p className="text-xs text-text-muted px-4 py-3">No departments yet.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {(deptsByFaculty[faculty.id] ?? []).map(dept => (
                          <li key={dept.id} className="flex items-center gap-2 px-4 py-2.5">
                            <ChevronRight size={13} className="text-text-muted shrink-0" />
                            <span className="text-sm text-text-primary">{dept.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 2: Update `app/admin/courses/page.js`**

```js
import { requireRole } from '@/lib/dal'
import { listCourses, listDepartments } from '@/lib/db/repositories/structure'
import { TopBar } from '@/components/shared/TopBar'
import { CreateCourseForm } from './CreateCourseForm'
import { BookOpen } from 'lucide-react'

export const metadata = { title: 'Courses — PCU CBT' }

const LEVEL_LABELS = { '100': '100L', '200': '200L', '300': '300L', '400': '400L', '500': '500L', PG: 'PG' }

export default async function AdminCoursesPage() {
  await requireRole('school_admin', 'super_admin')

  const [courses, departments] = await Promise.all([listCourses(), listDepartments()])

  return (
    <>
      <TopBar title="Courses" subtitle={`${courses.length} courses registered`} />
      <main className="flex-1 p-6 max-w-5xl space-y-6">
        <CreateCourseForm departments={departments} />

        {!courses.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <BookOpen size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No courses yet</p>
            <p className="text-xs text-text-muted">Add your first course using the form above.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Code</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Title</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">Department</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Level</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Semester</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden lg:table-cell">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {courses.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-primary bg-primary-light px-2 py-0.5 rounded">
                        {c.course_code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-primary font-medium">{c.course_title}</td>
                    <td className="px-4 py-3 text-text-secondary hidden md:table-cell">
                      <div>{c.department?.name}</div>
                      <div className="text-xs text-text-muted">{c.department?.faculty?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{LEVEL_LABELS[c.level] ?? c.level}</td>
                    <td className="px-4 py-3 text-text-secondary capitalize hidden sm:table-cell">{c.semester}</td>
                    <td className="px-4 py-3 text-text-muted hidden lg:table-cell">{c.credit_units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 3: Rewrite `app/admin/logs/page.js`**

This replaces both the old `/admin/logs` and `/super-admin/logs` (Task 11
deletes the latter's directory) with one page.

```js
import { requireRole } from '@/lib/dal'
import { listRecentActions } from '@/lib/db/repositories/auditLog'
import { TopBar } from '@/components/shared/TopBar'
import { format } from 'date-fns'

export const metadata = { title: 'Activity Log — PCU CBT' }

const ACTION_LABELS = {
  activated: 'Activated', deactivated: 'Deactivated', removed: 'Removed',
  logged_in: 'Signed in', logged_out: 'Signed out', login_failed: 'Sign-in failed',
  exam_entry_ip_blocked: 'Exam entry blocked (IP)',
}

export default async function AdminLogsPage() {
  await requireRole('school_admin', 'super_admin')
  const logs = await listRecentActions(200)

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions and sign-ins at your institution" />
      <main className="flex-1 p-6">
        {!logs.length ? (
          <p className="text-sm text-text-muted py-8 text-center">No activity yet.</p>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Actor</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Target</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-text-primary font-medium">{ACTION_LABELS[log.action] ?? log.action}</td>
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{log.target?.full_name ?? log.target_identifier ?? '—'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{format(new Date(log.created_at), 'PPp')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/admin/structure/page.js app/admin/courses/page.js app/admin/logs/page.js
git commit -m "feat(admin): widen structure/courses/logs pages to both admin roles, port to Prisma

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: New `/admin/settings` page (institution branding)

**Files:**
- Create: `app/admin/settings/page.js`
- Create: `app/admin/settings/InstitutionSettingsForm.js`

**Interfaces:**
- Consumes: `getInstitution` (Task 1), `updateInstitutionSettings` (Task 6).

- [ ] **Step 1: Create `app/admin/settings/InstitutionSettingsForm.js`**

```js
'use client'

import { useActionState } from 'react'
import { updateInstitutionSettings } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function InstitutionSettingsForm({ institution }) {
  const [state, formAction] = useActionState(updateInstitutionSettings, null)

  return (
    <form action={formAction} className="space-y-4 max-w-md">
      <Input
        id="name" name="name" label="Institution Name"
        defaultValue={institution?.name ?? ''} required
        error={state?.errors?.name?.[0]}
      />
      <Input
        id="primary_color" name="primary_color" label="Primary Color (hex, optional)"
        placeholder="#1a56db" defaultValue={institution?.primary_color ?? ''}
        error={state?.errors?.primary_color?.[0]}
      />
      <Input
        id="logo_url" name="logo_url" label="Logo URL or path (optional)"
        placeholder="/pcu/logo.png" defaultValue={institution?.logo_url ?? ''}
        error={state?.errors?.logo_url?.[0]}
      />
      {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}
      <SubmitButton loadingText="Saving…">Save Settings</SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: Create `app/admin/settings/page.js`**

```js
import { requireRole } from '@/lib/dal'
import { getInstitution } from '@/lib/db/repositories/institution'
import { TopBar } from '@/components/shared/TopBar'
import { InstitutionSettingsForm } from './InstitutionSettingsForm'

export const metadata = { title: 'Settings — PCU CBT' }

export default async function AdminSettingsPage() {
  await requireRole('super_admin')
  const institution = await getInstitution()

  return (
    <>
      <TopBar title="Institution Settings" subtitle="Name, logo, and branding color" />
      <main className="flex-1 p-6">
        <InstitutionSettingsForm institution={institution} />
      </main>
    </>
  )
}
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/admin/settings
git commit -m "feat(admin): institution settings page (FR-INST-1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: New `/admin/lab-network` page (lab IP allowlist admin UI)

**Files:**
- Create: `app/admin/lab-network/page.js`
- Create: `app/admin/lab-network/AddEntryForm.js`
- Create: `app/admin/lab-network/AddRangeForm.js`
- Create: `app/admin/lab-network/ToggleEntryButton.js`

**Interfaces:**
- Consumes: `listAllEntries` (Task 4), `addLabIpAllowlistEntry`/`addLabIpAllowlistRange`/`toggleLabIpAllowlistEntry` (Task 6).

- [ ] **Step 1: Create `app/admin/lab-network/AddEntryForm.js`**

```js
'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { addLabIpAllowlistEntry } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function AddEntryForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(addLabIpAllowlistEntry, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Single Entry</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <Input
            id="entry" name="entry" label="IP Address or CIDR"
            placeholder="192.168.1.11 or 192.168.1.0/24" required
            error={state?.errors?.entry?.[0]}
          />
          <Input id="label" name="label" label="Label (optional)" placeholder="Lab A, row 1" />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          <SubmitButton loadingText="Adding…" className="w-full">Add Entry</SubmitButton>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/admin/lab-network/AddRangeForm.js`**

```js
'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { addLabIpAllowlistRange } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function AddRangeForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(addLabIpAllowlistRange, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Range (bulk)</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <div className="grid grid-cols-2 gap-3">
            <Input id="start_ip" name="start_ip" label="Start IP" placeholder="192.168.1.11" required error={state?.errors?.start_ip?.[0]} />
            <Input id="end_ip" name="end_ip" label="End IP" placeholder="192.168.1.60" required error={state?.errors?.end_ip?.[0]} />
          </div>
          <Input id="range_label" name="label" label="Label (optional, applies to all)" placeholder="Lab A" />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">{state.count} host(s) added.</p>}
          <SubmitButton loadingText="Adding…" className="w-full">Add Range</SubmitButton>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `app/admin/lab-network/ToggleEntryButton.js`**

```js
'use client'

import { useTransition } from 'react'
import { toggleLabIpAllowlistEntry } from '@/lib/actions/admin'
import { toast } from 'sonner'

export function ToggleEntryButton({ entryId, isActive }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await toggleLabIpAllowlistEntry(entryId, !isActive)
      toast.success(isActive ? 'Entry deactivated.' : 'Entry activated.')
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={[
        'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50',
        isActive ? 'text-danger hover:bg-danger-light' : 'text-success hover:bg-success-light',
      ].join(' ')}
    >
      {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
```

- [ ] **Step 4: Create `app/admin/lab-network/page.js`**

```js
import { requireRole } from '@/lib/dal'
import { listAllEntries } from '@/lib/db/repositories/labIpAllowlist'
import { TopBar } from '@/components/shared/TopBar'
import { AddEntryForm } from './AddEntryForm'
import { AddRangeForm } from './AddRangeForm'
import { ToggleEntryButton } from './ToggleEntryButton'
import { Wifi } from 'lucide-react'

export const metadata = { title: 'Lab Network — PCU CBT' }

export default async function AdminLabNetworkPage() {
  const user = await requireRole('school_admin', 'super_admin')
  const entries = await listAllEntries(user.university_id)
  const activeCount = entries.filter(e => e.is_active).length

  return (
    <>
      <TopBar
        title="Lab Network"
        subtitle="IP addresses and ranges allowed to enter and answer exams"
      />
      <main className="flex-1 p-6 max-w-4xl space-y-6">
        {activeCount === 0 && (
          <div className="bg-danger-light border border-danger/20 rounded-xl p-4">
            <p className="text-sm text-danger font-medium">
              No active entries. Exam entry will fail closed for every student until at least
              one entry is active.
            </p>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-3">
          <AddEntryForm />
          <AddRangeForm />
        </div>

        {!entries.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Wifi size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No entries yet</p>
            <p className="text-xs text-text-muted">Add the lab's PC addresses above.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Entry</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Label</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map(e => (
                  <tr key={e.id} className={e.is_active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 font-mono text-text-primary">{e.entry}</td>
                    <td className="px-4 py-3 text-text-secondary">{e.label ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                        e.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                      }`}>
                        {e.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ToggleEntryButton entryId={e.id} isActive={e.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/admin/lab-network
git commit -m "feat(admin): lab IP allowlist admin page (FR-LAB-1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Delete `/super-admin/*`, update Sidebar and admin layout

**Files:**
- Delete: `app/super-admin/**` (entire directory)
- Modify: `components/shared/Sidebar.js`
- Modify: `app/admin/layout.js`

**Interfaces:**
- Consumes: nothing new. `app/admin/layout.js` already fetches institution branding via Supabase today — leave that query as-is for now (institution branding *display* on the layout isn't in this slice's repo list; Task 1's `institution.js` repo exists for the settings page's read/write, but swapping every branding-read call site is broader than this task needs — note as a follow-up, not required here since the layout's existing Supabase read of `primary_color`/`logo_url` still works unchanged and both write paths, old admin.js's deleted `updateUniversityBranding` and the new `updateInstitutionSettings`, target the same underlying row).

- [ ] **Step 1: Delete the entire `/super-admin` route tree**

```bash
git rm -r app/super-admin
```

- [ ] **Step 2: Update `components/shared/Sidebar.js`**

Replace the `super_admin` nav array and add `Lab Network` to `school_admin`'s:

```js
const NAV = {
  super_admin: [
    { label: 'Dashboard',         href: '/admin/dashboard',  icon: LayoutDashboard },
    { label: 'Users',             href: '/admin/users',       icon: Users },
    { label: 'Faculties & Depts', href: '/admin/structure',   icon: Building2 },
    { label: 'Courses',           href: '/admin/courses',     icon: BookOpen },
    { label: 'Exam Oversight',    href: '/admin/exams',       icon: ClipboardList },
    { label: 'Lab Network',       href: '/admin/lab-network', icon: Settings },
    { label: 'Settings',          href: '/admin/settings',    icon: Settings },
    { label: 'Logs',              href: '/admin/logs',        icon: History },
  ],
  school_admin: [
    { label: 'Dashboard',         href: '/admin/dashboard',  icon: LayoutDashboard },
    { label: 'Users',             href: '/admin/users',       icon: Users },
    { label: 'Faculties & Depts', href: '/admin/structure',   icon: Building2 },
    { label: 'Courses',           href: '/admin/courses',     icon: BookOpen },
    { label: 'Exam Oversight',    href: '/admin/exams',       icon: ClipboardList },
    { label: 'Lab Network',       href: '/admin/lab-network', icon: Settings },
    { label: 'Logs',              href: '/admin/logs',        icon: History },
  ],
  lecturer: [
    { label: 'Dashboard',     href: '/lecturer/dashboard', icon: LayoutDashboard },
    { label: 'Question Bank', href: '/lecturer/questions', icon: FileQuestion },
    { label: 'Exams',         href: '/lecturer/exams',     icon: ScrollText },
    { label: 'Results',       href: '/lecturer/results',   icon: BarChart2 },
  ],
}
```

`ROLE_LABEL`'s `super_admin: 'Platform Admin'` entry stays unchanged — it's
still an accurate label for the role, just no longer tied to a separate
route tree. The `Building2` icon import is already present (used above);
no import list changes needed since every icon referenced above was already
imported for one nav array or the other.

- [ ] **Step 3: Update `app/admin/layout.js`**

Widen the role gate — everything else in this file (the Supabase branding
read, `Sidebar` usage) is unchanged:

```js
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shared/Sidebar'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export default async function AdminLayout({ children }) {
  const user     = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  const { data: university } = await supabase
    .from('universities')
    .select('primary_color, logo_url')
    .eq('id', user.university_id)
    .maybeSingle()

  return (
    <div className="flex h-screen overflow-hidden" style={getUniversityThemeStyle(university)}>
      <Sidebar user={user} logoUrl={university?.logo_url} />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A app/super-admin components/shared/Sidebar.js app/admin/layout.js
git commit -m "feat(admin): delete /super-admin in favor of unified /admin/*, widen layout role gate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Remove legacy multi-tenant routing (FR-INST-2)

**Files:**
- Delete: `app/(auth)/[slug]/login/page.js`, `app/(auth)/[slug]/forgot-password/page.js`
- Delete: `app/check-result/[slug]/page.js`, `app/check-result/CheckAnotherResultButton.js`
- Delete: `components/shared/UniversityBadge.js`, `components/admin/SignInLinkCard.js`
- Modify: `proxy.js`

**Interfaces:** none — pure removal, no new interfaces.

- [ ] **Step 1: Verify each deletion target has no other consumer**

```bash
grep -rln "UniversityBadge" app components lib
grep -rln "SignInLinkCard" app components lib
grep -rln "CheckAnotherResultButton" app components lib
```

Expected: `UniversityBadge` matches only inside the three files being
deleted in this task (the two `[slug]` pages) — confirm before deleting.
`SignInLinkCard` and `CheckAnotherResultButton` should already have zero
matches, since Task 7 removed the dashboard's sign-in-link section and
Slice 2 already stopped importing `CheckAnotherResultButton` from the
plain `/check-result` page (it was deliberately left in place only for
the `[slug]` page being deleted here). If any of these greps show an
unexpected consumer, stop and investigate before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm "app/(auth)/[slug]/login/page.js" "app/(auth)/[slug]/forgot-password/page.js"
git rm "app/check-result/[slug]/page.js" app/check-result/CheckAnotherResultButton.js
git rm components/shared/UniversityBadge.js components/admin/SignInLinkCard.js
# Remove the now-empty [slug] directories if git left them behind
rmdir "app/(auth)/[slug]" "app/check-result/[slug]" 2>/dev/null || true
```

- [ ] **Step 3: Remove the legacy regex from `proxy.js`**

```js
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/constants'

const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/dev', '/lab', '/check-result']

const isPublic = (pathname) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))

export function proxy(request) {
  const { pathname } = request.nextUrl

  if (!request.cookies.has(SESSION_COOKIE) && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass (`proxy.test.js` doesn't exercise the removed
regex directly, so no test changes are needed here).

- [ ] **Step 5: Commit**

```bash
git add -A "app/(auth)/[slug]" "app/check-result/[slug]" app/check-result/CheckAnotherResultButton.js components/shared/UniversityBadge.js components/admin/SignInLinkCard.js proxy.js
git commit -m "feat: remove legacy multi-tenant subdomain routing (FR-INST-2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Manual end-to-end verification

**Files:** none (verification only, no commits unless a bug is found).

- [ ] **Step 1: Start SQL Server + seeded app**

```bash
docker start pcucbt-sql
SEED_SAMPLE_DATA=1 node prisma/seed.mjs
npm run dev
```

- [ ] **Step 2: Sign in as the seeded super_admin**

Confirm: `/admin/dashboard` loads with lecturer/student/course counts;
sidebar shows Dashboard, Users, Faculties & Depts, Courses, Exam
Oversight, Lab Network, Settings, Logs — no "Universities" or "All Users"
platform-wide items.

- [ ] **Step 3: `/admin/settings`**

Update the institution name and a hex color; confirm it saves and the
sidebar/login page branding reflects the new color after a refresh.

- [ ] **Step 4: `/admin/lab-network`**

Add a single entry (e.g. `192.168.1.50`), add a range (e.g. `192.168.1.60`
to `192.168.1.65`, confirm 6 rows appear), deactivate one entry, confirm
the "no active entries" warning appears only when ALL entries are
inactive (temporarily deactivate all to check, then reactivate).

- [ ] **Step 5: `/admin/users`**

Invite a lecturer, confirm the one-time temp password modal appears;
bulk-upload two students (one new, one re-using an existing matric
number) and confirm the "already registered" row shows up in the
failures list; deactivate then reactivate a user; remove a user and
confirm they disappear from the active list and can no longer be
reactivated (the Activate/Deactivate button should reflect their removed
state, or the row should indicate removal — check current behavior
against the design's "removed_at" semantics from Slice 1).

- [ ] **Step 6: Old routes are gone**

Visit `/super-admin/dashboard`, `/super-admin/universities`, a
`/{anything}/login` URL, and `/check-result/{anything}` — confirm none of
these render the old multi-tenant UI (they should 404 or redirect to
`/login`, not error with a stack trace).

- [ ] **Step 7: `school_admin` sees the same surface minus super-admin-only pages**

Sign in as a `school_admin` (create one via the invite flow if none
exists), confirm `/admin/settings` redirects away (role gate is
`super_admin`-only) while every other `/admin/*` page works identically
to the super_admin view.

- [ ] **Step 8: Report results to the user**

Summarize pass/fail for each step. Do not commit anything for this task
unless a bug is found and fixed — matching Slices 1–2's precedent.

---

## Self-Review

**Spec coverage:**
- FR-INST-1 (institution settings, super_admin only) — Task 9. ✅
- FR-INST-2 (remove subdomain/[slug] routing) — Task 12. ✅
- FR-INST-3 (school_admin/super_admin share pages, role only gates extras) — Tasks 7, 8, 11 (widened role gates throughout; `updateInstitutionSettings` stays super_admin-only per Task 6). ✅
- FR-INST-4 (faculties/departments/courses CRUD unchanged) — Tasks 2, 8. ✅
- FR-LAB-1 (allowlist storage + admin page + add-range bulk helper) — Tasks 4, 10. ✅
- Institution branding still themes the login/admin layout — untouched Supabase read in `app/admin/layout.js`, noted explicitly in Task 11 as an intentional non-change (both write paths land on the same row).

**Explicitly deferred (correct, matches spec §1):**
- `enforce_ip_allowlist` per-exam toggle UI, access-code UI — Slice 5.
- Question bank — Slice 4.
- `/lecturer/*` — untouched, later slices.
- Removing `@supabase/*` — Slice 7.

**Placeholder scan:** no "TBD"/"handle appropriately" — every step has literal code or an exact command. Task 11's Step 1 note about the layout's branding read is an explicit "leave unchanged, here's why," not a deferred decision.

**Type consistency check:** `createStaffUser`/`createStudentUser`/`setUserActive`/`markUserRemoved` (Task 3) signatures match their Task 6 call sites exactly (camelCase params, matching field names). `listStaffAndStudents({ excludeUserId })` used consistently in Tasks 7 and 6's tests. `listCourses()`'s `department.faculty` include shape matches its usage in Task 8's courses page (`c.department?.name`, `c.department?.faculty?.name}`) and Task 7's dashboard doesn't touch course internals beyond `.length`, so no shape mismatch there. `addRange({ universityId, startIp, endIp, label, createdBy })` (Task 4) matches Task 6's `addLabIpAllowlistRange` call exactly.

**Known limitation to mention when done:** `/admin/dashboard`'s exam-related numbers (active exam count, recent exams, pass rate) still read Supabase and will silently diverge from the new Prisma-side courses/departments once those start changing post-cutover (e.g. a course renamed via the new admin UI won't be reflected in `recentExams`' `course_code` join, which reads Supabase's frozen copy) — expected and resolved when Slice 5/6 port exams/attempts/results. Same seam Slice 2 documented for `/lab/[code]` and `/check-result`.
