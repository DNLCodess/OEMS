# SQL Server Migration — Slice 1: Auth Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth for **staff** (`super_admin` / `school_admin` / `lecturer`) with custom session-cookie auth backed by the `sessions` table — email + password login, logout, forced first-password-change — with `getAuthUser()` / `requireRole()` keeping their exact signatures so the 40 downstream call sites need no changes.

**Architecture:** A new `lib/auth/` boundary (password hashing, session lifecycle) sits on top of a new `lib/db/repositories/` layer (all SQL for users, sessions, audit log). `lib/dal.js` is rewritten to read the session cookie instead of Supabase, keeping its public API. `proxy.js` becomes a dependency-free cookie-presence gate (no DB). Student credential-less auth is **out of scope** — Slice 2.

**Tech Stack:** `@node-rs/argon2` (prebuilt argon2id, no native compile), Prisma (from Slice 0), Next.js Server Actions + `next/headers` cookies, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md` — §3.1 (FR-AUTH-1..5, 11, 12), §2 (module boundaries), §5.4 (NFR-SEC-6, 7).

## Global Constraints

- **Branch:** all work lands on the `sqlserver-migration` integration branch (created from `main` in Task 0), via a `slice-1-auth` sub-branch. **Not** `main`.
- **Commits:** message is `<type>: <subject>` + optional body. **No `Co-Authored-By` / AI-attribution trailer** — project rule.
- **Scope — staff only.** Student sessions, the `exam_access` / `result_lookup` channels, IP allowlist, `verified_exam_id` population — all Slice 2. Slice 1 only ever creates `channel = 'password'` sessions.
- **Do not touch** (later slices): `lib/actions/studentAuth.js`, `lib/actions/admin.js`, `lib/actions/attempts.js`, `lib/actions/exams.js`, `lib/actions/questions.js`, `app/(auth)/[slug]/**`, `app/lab/**`, `app/check-result/**`, any `lib/supabase/*` file (they keep working for the not-yet-migrated flows).
- **`getAuthUser()` / `requireRole(...roles)` / `roleHome(role)`** keep their current signatures and return shape (`{ id, email, full_name, role, university_id, matric_number, level, department_id, faculty_id, is_active }` — plus `must_change_password`, `removed_at` now available). `password_hash` must **never** be in the returned object.
- **Session token:** 32 random bytes → base64url string in the cookie; its SHA-256 hex (64 chars) is the `sessions.id` primary key. The raw token is never stored.
- **Session lifetimes** (FR-AUTH-3): 12 h idle (sliding `last_seen_at` / `expires_at`), 7 days absolute (from `created_at`).
- **Cookie** (FR-AUTH-2): name `pcu-cbt_session`, `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` only when `SESSION_COOKIE_SECURE === '1'` (off by default — plain-HTTP LAN, spec §8 Q6).
- **argon2id params** (NFR-SEC-6): `memoryCost: 19456` (KiB), `timeCost: 2`, `parallelism: 1`.
- **Enum values** come from `lib/db/enums.js` (Slice 0). Auth uses `SESSION_CHANNELS`, `ADMIN_LOG_ACTIONS`.
- **Tests:** `npx vitest run` stays green. DB-touching test files (`lib/db/**`, `lib/auth/**`, `prisma/**`) run in the serial `db` vitest project; pure-unit test files stay in `unit`.
- **Prisma field names** are snake_case (Slice 0 convention).

---

## Prerequisites recap (Slice 0, already done)

- `pcu_cbt` SQL Server container running; `.env` has `DATABASE_URL`.
- `prisma/schema.prisma` has the `Session`, `User` (with `password_hash`, `must_change_password`, `removed_at`), `AdminActionLog` models.
- `lib/db/client.js` exports `prisma`.
- `tests/helpers/db.js` exports `testPrisma`, `resetDb`, `seedMinimalStructure`.
- `vitest.config.mjs` has `unit` + `db` projects.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/auth/constants.js` | `SESSION_COOKIE` name only — dependency-free, importable from `proxy.js` (edge) | 1 |
| `lib/auth/password.js` | `hashPassword()` / `verifyPassword()` (argon2id) | 1 |
| `lib/auth/password.test.js` | roundtrip, wrong password, tamper | 1 |
| `lib/db/repositories/sessions.js` | all `sessions` SQL | 2 |
| `lib/db/repositories/sessions.test.js` | CRUD + expiry sweep (real DB) | 2 |
| `lib/db/repositories/users.js` | auth-relevant `users` SQL (`findByEmail`, `findById`, `setPassword`) | 3 |
| `lib/db/repositories/users.test.js` | real DB | 3 |
| `lib/db/repositories/auditLog.js` | `recordAuthEvent()` → `admin_action_log` | 3 |
| `lib/db/repositories/auditLog.test.js` | real DB | 3 |
| `lib/auth/session.js` | `createSession()` / `readSessionUser()` / `destroySession()` — cookie + repo glue | 4 |
| `lib/auth/session.test.js` | real DB + mocked `next/headers` | 4 |
| `lib/dal.js` | **rewrite** — `getAuthUser` / `requireRole` / `roleHome` on sessions | 5 |
| `lib/dal.test.js` | **rewrite** — mock `@/lib/auth/session` | 5 |
| `proxy.js` | **rewrite** — cookie-presence gate, no DB | 6 |
| `proxy.test.js` | **new** — redirect logic | 6 |
| `lib/actions/auth.js` | **rewrite** — `signIn` / `signOut` / `updatePassword`; **remove** `forgotPassword` | 7 |
| `lib/actions/auth.test.js` | **rewrite** — mock repos / password / session | 7 |
| `lib/validations/auth.js` | drop `forgotPasswordSchema`; keep `loginSchema`, `resetPasswordSchema` | 8 |
| `app/(auth)/update-password/page.js` | use `getAuthUser()` (not `requireRole`) to avoid the forced-change redirect loop | 8 |
| `app/(auth)/login/page.js` | redirect an already-authenticated visitor to their dashboard | 8 |
| `app/(auth)/forgot-password/page.js` | **replace** with a static "contact your exam officer" notice | 9 |
| `app/(auth)/forgot-password/ForgotPasswordForm.js` | **delete** | 9 |
| `app/(auth)/[slug]/forgot-password/page.js` | render the same static notice | 9 |
| `prisma/seed.mjs` | hash `SEED_SUPER_ADMIN_PASSWORD`; keep `must_change_password: true` | 10 |
| `prisma/seed.test.js` | assert `password_hash` is set now | 10 |
| `.env` / `.env.local.example` | `SEED_SUPER_ADMIN_PASSWORD`, `SESSION_COOKIE_SECURE`; restore the example file | 11 |
| `vitest.config.mjs` | add `lib/auth/**/*.test.js` to the `db` project glob | 4 |
| `docs/db/README.md` | short "Auth (Slice 1)" section | 11 |

---

## Task 0: Integration branch

**Files:** none (git only)

- [ ] **Step 1: From `main`, create the integration branch and the slice branch**

```bash
git checkout main
git pull --ff-only    # no-op if origin/main is behind; fine
git checkout -b sqlserver-migration
git checkout -b slice-1-auth
```

- [ ] **Step 2: Confirm starting state**

Run: `npx vitest run`
Expected: 270 passing (Slice 0 baseline).

---

## Task 1: Password hashing + shared cookie constant

**Files:**
- Create: `lib/auth/constants.js`
- Create: `lib/auth/password.js`
- Create: `lib/auth/password.test.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces:
  - `lib/auth/constants.js` → `export const SESSION_COOKIE = 'pcu-cbt_session'`
  - `lib/auth/password.js` → `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>` (returns `false`, never throws, on a malformed hash)

- [ ] **Step 1: Install argon2**

Run: `npm install @node-rs/argon2@^2`
Expected: installs with a platform-specific optional dep (e.g. `@node-rs/argon2-darwin-arm64`). No compiler invoked.

- [ ] **Step 2: Write the shared constant**

Create `lib/auth/constants.js`:
```js
// Kept dependency-free so proxy.js (edge runtime) can import it.
export const SESSION_COOKIE = 'pcu-cbt_session'
```

- [ ] **Step 3: Write the failing test**

Create `lib/auth/password.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

describe('lib/auth/password', () => {
  it('hashes to an argon2id string and verifies the same password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-value')
    expect(await verifyPassword(hash, 's3cret-Value')).toBe(false)
  })

  it('produces a different hash each call (random salt)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false)
  })
})
```

- [ ] **Step 4: Run it — expect failure**

Run: `npx vitest run lib/auth/password.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `lib/auth/password.js`**

```js
import { hash, verify } from '@node-rs/argon2'

// OWASP argon2id minimum (spec NFR-SEC-6). Staff-login only, low volume.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export async function hashPassword(plain) {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(hashString, plain) {
  try {
    return await verify(hashString, plain, OPTIONS)
  } catch {
    // Malformed/foreign hash string — treat as a non-match, never crash a login.
    return false
  }
}
```

- [ ] **Step 6: Run it — expect pass**

Run: `npx vitest run lib/auth/password.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Full suite**

Run: `npx vitest run`
Expected: 274 passing.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/auth/constants.js lib/auth/password.js lib/auth/password.test.js
git commit -m "feat(auth): argon2id password hashing + session cookie constant"
```

---

## Task 2: `sessions` repository

**Files:**
- Create: `lib/db/repositories/sessions.js`
- Create: `lib/db/repositories/sessions.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces (all async):
  - `createSessionRow({ id, user_id, channel, verified_exam_id, client_ip, created_at, last_seen_at, expires_at }): Promise<void>`
  - `findSessionWithUser(id): Promise<{ id, created_at, last_seen_at, expires_at, channel, verified_exam_id, user: SafeUser | null } | null>` where `SafeUser = { id, email, full_name, role, university_id, matric_number, level, department_id, faculty_id, is_active, removed_at, must_change_password }` (**no `password_hash`**)
  - `touchSession(id, last_seen_at, expires_at): Promise<void>`
  - `deleteSession(id): Promise<void>`
  - `deleteExpiredSessions(now): Promise<number>` (count deleted)

- [ ] **Step 1: Write the failing test**

Create `lib/db/repositories/sessions.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import {
  createSessionRow, findSessionWithUser, touchSession, deleteSession, deleteExpiredSessions,
} from '@/lib/db/repositories/sessions'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', ...extra },
  })
}

const H = (c) => c.repeat(64)

describe('repositories/sessions', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates and reads back a session joined to a safe user projection', async () => {
    const u = await aUser()
    const now = new Date()
    await createSessionRow({
      id: H('a'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null,
      created_at: now, last_seen_at: now, expires_at: new Date(now.getTime() + 3600_000),
    })
    const row = await findSessionWithUser(H('a'))
    expect(row.user.id).toBe(u.id)
    expect(row.user).not.toHaveProperty('password_hash')
    expect(row.channel).toBe('password')
  })

  it('returns null for an unknown id', async () => {
    expect(await findSessionWithUser(H('z'))).toBeNull()
  })

  it('touch updates last_seen_at and expires_at', async () => {
    const u = await aUser()
    const t0 = new Date('2026-01-01T00:00:00Z')
    await createSessionRow({
      id: H('b'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null,
      created_at: t0, last_seen_at: t0, expires_at: new Date('2026-01-01T12:00:00Z'),
    })
    const t1 = new Date('2026-01-01T06:00:00Z')
    await touchSession(H('b'), t1, new Date('2026-01-01T18:00:00Z'))
    const row = await findSessionWithUser(H('b'))
    expect(row.last_seen_at.toISOString()).toBe(t1.toISOString())
    expect(row.expires_at.toISOString()).toBe('2026-01-01T18:00:00.000Z')
  })

  it('deleteSession removes exactly one row', async () => {
    const u = await aUser()
    const now = new Date()
    await createSessionRow({ id: H('c'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date(now.getTime() + 1000) })
    await deleteSession(H('c'))
    expect(await findSessionWithUser(H('c'))).toBeNull()
  })

  it('deleteExpiredSessions removes only rows past expires_at', async () => {
    const u = await aUser()
    const now = new Date('2026-06-01T00:00:00Z')
    await createSessionRow({ id: H('d'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date('2026-05-01T00:00:00Z') })
    await createSessionRow({ id: H('e'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date('2026-07-01T00:00:00Z') })
    const removed = await deleteExpiredSessions(now)
    expect(removed).toBe(1)
    expect(await findSessionWithUser(H('e'))).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run lib/db/repositories/sessions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/db/repositories/sessions.js`**

```js
import 'server-only'
import { prisma } from '@/lib/db/client'

// Columns safe to hand to React components — never password_hash.
const SAFE_USER_SELECT = {
  id: true, email: true, full_name: true, role: true, university_id: true,
  matric_number: true, level: true, department_id: true, faculty_id: true,
  is_active: true, removed_at: true, must_change_password: true,
}

export async function createSessionRow(data) {
  await prisma.session.create({ data })
}

export async function findSessionWithUser(id) {
  return prisma.session.findUnique({
    where: { id },
    select: {
      id: true, created_at: true, last_seen_at: true, expires_at: true,
      channel: true, verified_exam_id: true,
      user: { select: SAFE_USER_SELECT },
    },
  })
}

export async function touchSession(id, last_seen_at, expires_at) {
  await prisma.session.update({ where: { id }, data: { last_seen_at, expires_at } })
}

export async function deleteSession(id) {
  await prisma.session.deleteMany({ where: { id } }) // deleteMany = no throw if already gone
}

export async function deleteExpiredSessions(now) {
  const { count } = await prisma.session.deleteMany({ where: { expires_at: { lt: now } } })
  return count
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run lib/db/repositories/sessions.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/sessions.js lib/db/repositories/sessions.test.js
git commit -m "feat(db): sessions repository"
```

---

## Task 3: `users` + `auditLog` repositories

**Files:**
- Create: `lib/db/repositories/users.js`, `lib/db/repositories/users.test.js`
- Create: `lib/db/repositories/auditLog.js`, `lib/db/repositories/auditLog.test.js`

**Interfaces:**
- `lib/db/repositories/users.js`:
  - `findUserByEmailForAuth(email): Promise<{ id, email, role, university_id, is_active, removed_at, must_change_password, password_hash } | null>` — includes `password_hash` (used only inside `signIn`, never returned to a component)
  - `findUserById(id): Promise<SafeUser | null>` (same projection as `SAFE_USER_SELECT`)
  - `setUserPassword(id, password_hash): Promise<void>` — also sets `must_change_password = false`
- `lib/db/repositories/auditLog.js`:
  - `recordAuthEvent({ action, actor_id?, university_id?, target_user_id?, target_identifier?, subject_role?, meta? }): Promise<void>` — `action` must be in `ADMIN_LOG_ACTIONS`; swallows and `console.error`s DB failures (logging must never break a login, matching today's behaviour)

- [ ] **Step 1: Write the failing users test**

Create `lib/db/repositories/users.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findUserByEmailForAuth, findUserById, setUserPassword } from '@/lib/db/repositories/users'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: {
      university_id: university.id, role: 'school_admin',
      email: 'admin@pcu.edu', full_name: 'Admin', password_hash: 'HASH', ...extra,
    },
  })
}

describe('repositories/users', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findUserByEmailForAuth returns the hash and auth flags, case-insensitively', async () => {
    await aUser({ email: 'Admin@PCU.edu' })
    const u = await findUserByEmailForAuth('admin@pcu.edu')
    expect(u.password_hash).toBe('HASH')
    expect(u.role).toBe('school_admin')
  })

  it('findUserByEmailForAuth returns null for an unknown email', async () => {
    expect(await findUserByEmailForAuth('nobody@pcu.edu')).toBeNull()
  })

  it('findUserById returns a safe projection without password_hash', async () => {
    const created = await aUser()
    const u = await findUserById(created.id)
    expect(u.email).toBe('admin@pcu.edu')
    expect(u).not.toHaveProperty('password_hash')
  })

  it('setUserPassword updates the hash and clears must_change_password', async () => {
    const created = await aUser({ must_change_password: true })
    await setUserPassword(created.id, 'NEWHASH')
    const row = await prisma.user.findUnique({ where: { id: created.id } })
    expect(row.password_hash).toBe('NEWHASH')
    expect(row.must_change_password).toBe(false)
  })
})
```

> **Note on case-insensitivity:** the DB collation set in Slice 0 (`Latin1_General_100_CI_AI`, spec NFR-DB-5) makes `WHERE email = ?` case-insensitive automatically. The test above documents that. If Slice 0 shipped with a case-sensitive collation, add `email: { equals: email, mode: 'insensitive' }` — but Prisma's `mode` is unsupported on SQL Server, so instead lowercase on write (a separate change) — flag this to the user rather than guessing.

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run lib/db/repositories/users.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/db/repositories/users.js`**

```js
import 'server-only'
import { prisma } from '@/lib/db/client'

const SAFE_USER_SELECT = {
  id: true, email: true, full_name: true, role: true, university_id: true,
  matric_number: true, level: true, department_id: true, faculty_id: true,
  is_active: true, removed_at: true, must_change_password: true,
}

export async function findUserByEmailForAuth(email) {
  return prisma.user.findFirst({
    where: { email },
    select: {
      id: true, email: true, role: true, university_id: true,
      is_active: true, removed_at: true, must_change_password: true, password_hash: true,
    },
  })
}

export async function findUserById(id) {
  return prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT })
}

export async function setUserPassword(id, password_hash) {
  await prisma.user.update({
    where: { id },
    data: { password_hash, must_change_password: false },
  })
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run lib/db/repositories/users.test.js`
Expected: PASS (4 tests). If the case-insensitive test fails, STOP and report the collation issue to the user (see the note in Step 1).

- [ ] **Step 5: Write the failing auditLog test**

Create `lib/db/repositories/auditLog.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'

describe('repositories/auditLog', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('writes a logged_in row with actor and subject role', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L' },
    })
    await recordAuthEvent({
      action: 'logged_in', actor_id: u.id, target_user_id: u.id,
      university_id: university.id, subject_role: 'lecturer',
    })
    const rows = await prisma.adminActionLog.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('logged_in')
    expect(rows[0].actor_id).toBe(u.id)
  })

  it('writes a login_failed row keyed only on the submitted identifier', async () => {
    await recordAuthEvent({ action: 'login_failed', target_identifier: 'ghost@pcu.edu' })
    const rows = await prisma.adminActionLog.findMany()
    expect(rows[0].target_identifier).toBe('ghost@pcu.edu')
    expect(rows[0].actor_id).toBeNull()
  })

  it('never throws on an invalid action — logs the error and returns', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordAuthEvent({ action: 'not_a_real_action' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 6: Implement `lib/db/repositories/auditLog.js`**

```js
import 'server-only'
import { prisma } from '@/lib/db/client'
import { ADMIN_LOG_ACTIONS } from '@/lib/db/enums'

// Audit logging must never break the operation it records. Any failure
// (bad action, DB hiccup) is swallowed after a console.error — matching the
// pre-migration behaviour in lib/actions/auth.js.
export async function recordAuthEvent(fields) {
  try {
    if (!ADMIN_LOG_ACTIONS.includes(fields.action)) {
      throw new Error(`unknown audit action: ${fields.action}`)
    }
    await prisma.adminActionLog.create({
      data: {
        action: fields.action,
        actor_id: fields.actor_id ?? null,
        university_id: fields.university_id ?? null,
        target_user_id: fields.target_user_id ?? null,
        target_identifier: fields.target_identifier ?? null,
        subject_role: fields.subject_role ?? null,
        meta: fields.meta ? JSON.stringify(fields.meta) : null,
      },
    })
  } catch (e) {
    console.error('[auditLog] recordAuthEvent failed', e.message)
  }
}
```

- [ ] **Step 7: Run both repo tests — expect pass**

Run: `npx vitest run lib/db/repositories/`
Expected: PASS (users 4 + auditLog 3 + sessions 5 = 12).

- [ ] **Step 8: Commit**

```bash
git add lib/db/repositories/users.js lib/db/repositories/users.test.js lib/db/repositories/auditLog.js lib/db/repositories/auditLog.test.js
git commit -m "feat(db): users (auth) + audit-log repositories"
```

---

## Task 4: `lib/auth/session.js` — session lifecycle

**Files:**
- Create: `lib/auth/session.js`, `lib/auth/session.test.js`
- Modify: `vitest.config.mjs` (add `lib/auth/**/*.test.js` to the `db` project)

**Interfaces:**
- Consumes: `sessions` repo, `SESSION_COOKIE` constant, `next/headers` `cookies()`.
- Produces (all async):
  - `createSession({ userId, channel, verifiedExamId?, clientIp? }): Promise<void>` — mints a token, writes the row, sets the cookie. `channel` must be in `SESSION_CHANNELS`.
  - `readSessionUser(): Promise<SafeUser | null>` — reads the cookie, loads the session, enforces idle + absolute expiry (deleting a dead row), slides `last_seen_at`/`expires_at` at most once/minute, returns the joined safe user (or `null`). Does **not** filter on `is_active` — the DAL does that so it can show the "suspended" message.
  - `destroySession(): Promise<void>` — deletes the row for the current cookie and clears the cookie.

- [ ] **Step 1: Widen the `db` vitest project**

In `vitest.config.mjs`, change:
```js
const DB_TESTS = ['lib/db/**/*.test.js', 'prisma/**/*.test.js']
```
to:
```js
const DB_TESTS = ['lib/db/**/*.test.js', 'lib/auth/**/*.test.js', 'prisma/**/*.test.js']
```
(`lib/auth/password.test.js` is pure but harmless to run in the serial project; keeping the glob simple is worth it.)

- [ ] **Step 2: Write the failing test**

Create `lib/auth/session.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

// In-memory cookie jar standing in for next/headers.
const jar = new Map()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
    set: (n, v) => jar.set(n, v),
    delete: (n) => jar.delete(n),
  }),
}))

import { createSession, readSessionUser, destroySession } from '@/lib/auth/session'
import { SESSION_COOKIE } from '@/lib/auth/constants'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', ...extra },
  })
}

describe('lib/auth/session', () => {
  beforeEach(async () => { jar.clear(); await resetDb() })
  afterAll(() => prisma.$disconnect())

  it('createSession writes a hashed row and sets an opaque cookie', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })

    const token = jar.get(SESSION_COOKIE)
    expect(token).toBeTruthy()
    const rows = await prisma.session.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)          // stored id is the hash, not the token
    expect(rows[0].id).toHaveLength(64)
    expect(rows[0].channel).toBe('password')
  })

  it('readSessionUser returns the user for a live session', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const user = await readSessionUser()
    expect(user.id).toBe(u.id)
    expect(user).not.toHaveProperty('password_hash')
  })

  it('returns null and deletes the row when past expires_at', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const id = (await prisma.session.findFirst()).id
    await prisma.session.update({ where: { id }, data: { expires_at: new Date(Date.now() - 1000) } })

    expect(await readSessionUser()).toBeNull()
    expect(await prisma.session.count()).toBe(0)
  })

  it('returns null past the 7-day absolute cap even if expires_at is future', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const id = (await prisma.session.findFirst()).id
    await prisma.session.update({
      where: { id },
      data: { created_at: new Date(Date.now() - 8 * 24 * 3600_000) },
    })
    expect(await readSessionUser()).toBeNull()
  })

  it('returns null when the cookie is absent', async () => {
    expect(await readSessionUser()).toBeNull()
  })

  it('destroySession deletes the row and clears the cookie', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    await destroySession()
    expect(jar.has(SESSION_COOKIE)).toBe(false)
    expect(await prisma.session.count()).toBe(0)
  })

  it('rejects an unknown channel', async () => {
    const u = await aUser()
    await expect(createSession({ userId: u.id, channel: 'nope' })).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run — expect failure**

Run: `npx vitest run lib/auth/session.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/auth/session.js`**

```js
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth/constants'
import { SESSION_CHANNELS } from '@/lib/db/enums'
import {
  createSessionRow, findSessionWithUser, touchSession, deleteSession,
} from '@/lib/db/repositories/sessions'

const IDLE_MS = 12 * 60 * 60 * 1000          // 12h sliding
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000  // 7d hard cap
const TOUCH_THROTTLE_MS = 60 * 1000

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const cookieSecure = () => process.env.SESSION_COOKIE_SECURE === '1'

export async function createSession({ userId, channel, verifiedExamId = null, clientIp = null }) {
  if (!SESSION_CHANNELS.includes(channel)) throw new Error(`invalid session channel: ${channel}`)

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  await createSessionRow({
    id: sha256(token),
    user_id: userId,
    channel,
    verified_exam_id: verifiedExamId,
    client_ip: clientIp,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + IDLE_MS),
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: Math.floor(IDLE_MS / 1000),
  })
}

export async function readSessionUser() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null

  const id = sha256(token)
  const row = await findSessionWithUser(id)
  if (!row) return null

  const now = new Date()
  const absoluteDeadline = new Date(new Date(row.created_at).getTime() + ABSOLUTE_MS)
  if (row.expires_at < now || absoluteDeadline < now) {
    await deleteSession(id)
    return null
  }
  if (!row.user) return null

  if (now.getTime() - new Date(row.last_seen_at).getTime() > TOUCH_THROTTLE_MS) {
    await touchSession(id, now, new Date(now.getTime() + IDLE_MS))
  }
  return row.user
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await deleteSession(sha256(token))
  jar.delete(SESSION_COOKIE)
}
```

- [ ] **Step 5: Run — expect pass**

Run: `npx vitest run lib/auth/session.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Full suite**

Run: `npx vitest run`
Expected: green (274 + 12 + 7 = 293).

- [ ] **Step 7: Commit**

```bash
git add vitest.config.mjs lib/auth/session.js lib/auth/session.test.js
git commit -m "feat(auth): session lifecycle (create / read / destroy)"
```

---

## Task 5: Rewrite `lib/dal.js`

**Files:**
- Modify (rewrite): `lib/dal.js`
- Modify (rewrite): `lib/dal.test.js`

**Interfaces:**
- Consumes: `readSessionUser` from `@/lib/auth/session`, `ROLE_HOME` from `@/lib/utils`.
- Produces (unchanged signatures): `getAuthUser(): Promise<SafeUser>` (redirects `/login` or `/login?error=account_suspended`), `requireRole(...roles): Promise<SafeUser>` (redirects to role home on mismatch; redirects staff with `must_change_password` to `/update-password`), `roleHome(role): string`.

- [ ] **Step 1: Rewrite the test first**

Replace `lib/dal.test.js` with:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ readSessionUser: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { readSessionUser } from '@/lib/auth/session'
import { getAuthUser, requireRole, roleHome } from './dal'

beforeEach(() => vi.clearAllMocks())

describe('getAuthUser', () => {
  it('redirects to /login when there is no session', async () => {
    readSessionUser.mockResolvedValue(null)
    await expect(getAuthUser()).rejects.toThrow(/^REDIRECT:\/login$/)
  })

  it('redirects to account_suspended when the user is inactive', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', is_active: false, removed_at: null })
    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('redirects to account_suspended when the user is removed', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', is_active: true, removed_at: new Date() })
    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('returns the user when session + account are valid', async () => {
    const u = { id: 'u1', role: 'lecturer', is_active: true, removed_at: null, must_change_password: false }
    readSessionUser.mockResolvedValue(u)
    await expect(getAuthUser()).resolves.toEqual(u)
  })
})

describe('requireRole', () => {
  it('returns the user when the role is allowed', async () => {
    const u = { id: 'u1', role: 'lecturer', is_active: true, removed_at: null, must_change_password: false }
    readSessionUser.mockResolvedValue(u)
    await expect(requireRole('lecturer', 'school_admin')).resolves.toEqual(u)
  })

  it('redirects to the role home when the role is not allowed', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'student', is_active: true, removed_at: null })
    await expect(requireRole('lecturer')).rejects.toThrow('REDIRECT:/lab')
  })

  it('redirects a staff user with must_change_password to /update-password', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'school_admin', is_active: true, removed_at: null, must_change_password: true })
    await expect(requireRole('school_admin')).rejects.toThrow('REDIRECT:/update-password')
  })
})

describe('roleHome', () => {
  it('maps known roles', () => {
    expect(roleHome('super_admin')).toBe('/super-admin/dashboard')
    expect(roleHome('student')).toBe('/lab')
  })
  it('falls back to /login', () => {
    expect(roleHome('bogus')).toBe('/login')
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run lib/dal.test.js`
Expected: FAIL — current `dal.js` still imports `@/lib/supabase/server`.

- [ ] **Step 3: Rewrite `lib/dal.js`**

```js
import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { readSessionUser } from '@/lib/auth/session'
import { ROLE_HOME } from '@/lib/utils'

const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

/**
 * The authenticated user's safe profile, or a redirect to /login.
 * Cached per request — safe to call many times in one render pass.
 */
export const getAuthUser = cache(async () => {
  const user = await readSessionUser()
  if (!user) redirect('/login')
  if (!user.is_active || user.removed_at) redirect('/login?error=account_suspended')
  return user
})

/**
 * Verify the user has one of the allowed roles. Call at the top of every
 * protected layout and Server Action.
 */
export async function requireRole(...roles) {
  const user = await getAuthUser()
  if (!roles.includes(user.role)) {
    redirect(ROLE_HOME[user.role] ?? '/login')
  }
  // Staff who still hold a temporary password are funnelled to set a real
  // one before they can do anything else. The /update-password page itself
  // calls getAuthUser (not requireRole) so it is reachable.
  if (STAFF_ROLES.includes(user.role) && user.must_change_password) {
    redirect('/update-password')
  }
  return user
}

export function roleHome(role) {
  return ROLE_HOME[role] ?? '/login'
}
```

- [ ] **Step 4: Run the DAL test — expect pass**

Run: `npx vitest run lib/dal.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dal.js lib/dal.test.js
git commit -m "feat(auth): rewrite DAL onto session cookie"
```

---

## Task 6: Rewrite `proxy.js`

**Files:**
- Modify (rewrite): `proxy.js`
- Create: `proxy.test.js`

**Interfaces:**
- Consumes: `SESSION_COOKIE` from `@/lib/auth/constants` (dependency-free — safe in the proxy runtime).
- Produces: `proxy(request)` — redirects to `/login?next=<path>` when there is no session cookie **and** the path is not public. No DB, no role logic.

- [ ] **Step 1: Write the failing test**

Create `proxy.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { proxy } from './proxy'
import { SESSION_COOKIE } from '@/lib/auth/constants'

function req(pathname, { withCookie = false } = {}) {
  const url = new URL(`http://localhost:3000${pathname}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.href) }),
    cookies: { has: (n) => withCookie && n === SESSION_COOKIE },
  }
}

describe('proxy', () => {
  it('redirects an unauthenticated request for a protected path to /login with ?next', () => {
    const res = proxy(req('/lecturer/dashboard'))
    expect(res.status).toBe(307)
    const loc = new URL(res.headers.get('location'))
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('next')).toBe('/lecturer/dashboard')
  })

  it('lets an unauthenticated request through to a public path', () => {
    const res = proxy(req('/login'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets /lab/* and /check-result/* through unauthenticated', () => {
    expect(proxy(req('/lab/ABC234')).headers.get('location')).toBeNull()
    expect(proxy(req('/check-result')).headers.get('location')).toBeNull()
  })

  it('lets an authenticated request through to a protected path', () => {
    const res = proxy(req('/lecturer/dashboard', { withCookie: true }))
    expect(res.headers.get('location')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run proxy.test.js`
Expected: FAIL — current `proxy.js` imports `@/lib/supabase/middleware`.

- [ ] **Step 3: Rewrite `proxy.js`**

```js
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/constants'

// Paths reachable without a session. /lab and /check-result carry their own
// gates deeper in (Slice 2); the proxy only avoids bouncing anonymous
// visitors away from them.
const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/dev', '/lab', '/check-result']

const isPublic = (pathname) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
  /^\/[a-z0-9-]+\/(login|forgot-password)$/i.test(pathname) // legacy /{slug}/login — removed in Slice 3

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run proxy.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add proxy.js proxy.test.js
git commit -m "feat(auth): proxy is now a dependency-free cookie gate"
```

---

## Task 7: Rewrite `lib/actions/auth.js`

**Files:**
- Modify (rewrite): `lib/actions/auth.js`
- Modify (rewrite): `lib/actions/auth.test.js`

**Interfaces:**
- Consumes: `loginSchema`, `resetPasswordSchema` from `@/lib/validations/auth`; `findUserByEmailForAuth`, `setUserPassword` from `@/lib/db/repositories/users`; `verifyPassword`, `hashPassword` from `@/lib/auth/password`; `createSession`, `destroySession`, `readSessionUser` from `@/lib/auth/session`; `recordAuthEvent` from `@/lib/db/repositories/auditLog`; `getAuthUser`, `roleHome` from `@/lib/dal`.
- Produces:
  - `signIn(prevState, formData)` — validate → look up → `verifyPassword` → suspended check → `createSession({ channel: 'password' })` → audit → redirect (`/update-password` if `must_change_password`, else role home). Returns `{ errors: { _form } }` on failure.
  - `signOut()` — audit `logged_out` → `destroySession()` → redirect `/login`.
  - `updatePassword(prevState, formData)` — `getAuthUser()` + staff-role check → validate → `hashPassword` → `setUserPassword` → redirect to role home.
  - **`forgotPassword` is removed** (no email on an air-gapped LAN — Task 9 replaces the page).

- [ ] **Step 1: Rewrite the test**

Replace `lib/actions/auth.test.js` with:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/repositories/users', () => ({
  findUserByEmailForAuth: vi.fn(),
  setUserPassword: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => 'NEWHASH'),
}))
vi.mock('@/lib/auth/session', () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  readSessionUser: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))
vi.mock('@/lib/dal', () => ({
  getAuthUser: vi.fn(),
  roleHome: (r) => ({ super_admin: '/super-admin/dashboard', school_admin: '/admin/dashboard', lecturer: '/lecturer/dashboard', student: '/lab' }[r] ?? '/login'),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p) => { throw new Error(`REDIRECT:${p}`) }),
}))

import { findUserByEmailForAuth, setUserPassword } from '@/lib/db/repositories/users'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession, readSessionUser } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { getAuthUser } from '@/lib/dal'
import { signIn, signOut, updatePassword } from './auth'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

beforeEach(() => vi.clearAllMocks())

describe('signIn', () => {
  it('returns field errors for an invalid email, without touching the DB', async () => {
    const r = await signIn(undefined, fd({ email: 'nope', password: 'secret1' }))
    expect(r.errors.email).toBeDefined()
    expect(findUserByEmailForAuth).not.toHaveBeenCalled()
  })

  it('generic error + login_failed audit for an unknown email', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    const r = await signIn(undefined, fd({ email: 'ghost@pcu.edu', password: 'secret1' }))
    expect(r.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed', target_identifier: 'ghost@pcu.edu' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('generic error + login_failed audit for a wrong password', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: true, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(false)
    const r = await signIn(undefined, fd({ email: 'l@pcu.edu', password: 'wrong' }))
    expect(r.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed', target_user_id: 'u1' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('suspended account gets a distinct message and no session', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: false, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    const r = await signIn(undefined, fd({ email: 'l@pcu.edu', password: 'right' }))
    expect(r.errors._form).toMatch(/suspended/i)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a session and redirects to the role home on success', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: true, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    await expect(signIn(undefined, fd({ email: 'l@pcu.edu', password: 'right' }))).rejects.toThrow('REDIRECT:/lecturer/dashboard')
    expect(createSession).toHaveBeenCalledWith({ userId: 'u1', channel: 'password' })
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_in', actor_id: 'u1' }))
  })

  it('redirects to /update-password when must_change_password is set', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'school_admin', university_id: 'uni', is_active: true, removed_at: null, must_change_password: true, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    await expect(signIn(undefined, fd({ email: 'a@pcu.edu', password: 'right' }))).rejects.toThrow('REDIRECT:/update-password')
    expect(createSession).toHaveBeenCalled()
  })
})

describe('signOut', () => {
  it('audits, destroys the session, redirects to /login', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni' })
    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_out', actor_id: 'u1' }))
    expect(destroySession).toHaveBeenCalled()
  })

  it('still destroys + redirects when there is no live session', async () => {
    readSessionUser.mockResolvedValue(null)
    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)
    expect(destroySession).toHaveBeenCalled()
  })
})

describe('updatePassword', () => {
  it('rejects a non-staff session', async () => {
    getAuthUser.mockResolvedValue({ id: 's1', role: 'student' })
    await expect(updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'longenough' }))).rejects.toThrow('REDIRECT:/lab')
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    getAuthUser.mockResolvedValue({ id: 'u1', role: 'lecturer' })
    const r = await updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'different' }))
    expect(r.errors.confirmPassword).toBeDefined()
  })

  it('hashes, saves, and redirects to the role home on success', async () => {
    getAuthUser.mockResolvedValue({ id: 'u1', role: 'lecturer' })
    await expect(updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'longenough' }))).rejects.toThrow('REDIRECT:/lecturer/dashboard')
    expect(setUserPassword).toHaveBeenCalledWith('u1', 'NEWHASH')
  })
})

describe('forgotPassword', () => {
  it('is no longer exported', async () => {
    const mod = await import('./auth')
    expect(mod.forgotPassword).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite `lib/actions/auth.js`**

```js
'use server'

import { redirect } from 'next/navigation'
import { loginSchema, resetPasswordSchema } from '@/lib/validations/auth'
import { findUserByEmailForAuth, setUserPassword } from '@/lib/db/repositories/users'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { createSession, destroySession, readSessionUser } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { getAuthUser, roleHome } from '@/lib/dal'

const GENERIC_LOGIN_ERROR = { errors: { _form: 'Incorrect email or password. Please try again.' } }
const SUSPENDED_ERROR = { errors: { _form: 'Your account has been suspended. Contact your Exam Officer.' } }
const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

export async function signIn(prevState, formData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const { email, password } = parsed.data
  const user = await findUserByEmailForAuth(email)
  const ok = user?.password_hash ? await verifyPassword(user.password_hash, password) : false

  if (!user || !ok) {
    await recordAuthEvent(
      user
        ? { action: 'login_failed', target_user_id: user.id, target_identifier: email, university_id: user.university_id ?? null }
        : { action: 'login_failed', target_identifier: email },
    )
    return GENERIC_LOGIN_ERROR
  }

  if (!user.is_active || user.removed_at) return SUSPENDED_ERROR

  await createSession({ userId: user.id, channel: 'password' })
  await recordAuthEvent({
    action: 'logged_in',
    actor_id: user.id,
    target_user_id: user.id,
    university_id: user.university_id ?? null,
    subject_role: user.role,
  })

  if (user.must_change_password) redirect('/update-password')
  redirect(roleHome(user.role))
}

export async function signOut() {
  const user = await readSessionUser()
  if (user) {
    await recordAuthEvent({
      action: 'logged_out',
      actor_id: user.id,
      target_user_id: user.id,
      university_id: user.university_id ?? null,
      subject_role: user.role,
    })
  }
  await destroySession()
  redirect('/login')
}

export async function updatePassword(prevState, formData) {
  // Server Actions are independently callable — re-check the session here,
  // not just on the page. A student session must never set a staff password.
  const user = await getAuthUser()
  if (!STAFF_ROLES.includes(user.role)) redirect(roleHome(user.role))

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  await setUserPassword(user.id, await hashPassword(parsed.data.password))
  redirect(roleHome(user.role))
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/auth.js lib/actions/auth.test.js
git commit -m "feat(auth): rewrite signIn/signOut/updatePassword; drop forgotPassword"
```

---

## Task 8: Forced-change page + already-authed login redirect + validations

**Files:**
- Modify: `lib/validations/auth.js`
- Modify: `app/(auth)/update-password/page.js`
- Modify: `app/(auth)/login/page.js`

- [ ] **Step 1: Trim `lib/validations/auth.js`**

Remove the `forgotPasswordSchema` export (nothing imports it after Task 7 + Task 9). Leave `loginSchema` and `resetPasswordSchema` exactly as they are.

- [ ] **Step 2: Point the update-password page at `getAuthUser`**

Replace `app/(auth)/update-password/page.js` with:
```js
import { redirect } from 'next/navigation'
import { getAuthUser, roleHome } from '@/lib/dal'
import { UpdatePasswordForm } from './UpdatePasswordForm'

export const metadata = { title: 'Set New Password — PCU CBT' }

const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

export default async function UpdatePasswordPage() {
  // getAuthUser (not requireRole) — requireRole would bounce a
  // must_change_password user straight back here in a loop.
  const user = await getAuthUser()
  if (!STAFF_ROLES.includes(user.role)) redirect(roleHome(user.role))

  return <UpdatePasswordForm />
}
```
(`UpdatePasswordForm.js` is unchanged — it already calls `updatePassword`.)

- [ ] **Step 3: Redirect an already-authenticated visitor away from /login**

Replace `app/(auth)/login/page.js` with:
```js
import { redirect } from 'next/navigation'
import { readSessionUser } from '@/lib/auth/session'
import { roleHome } from '@/lib/dal'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign In' }

export default async function LoginPage({ searchParams }) {
  const user = await readSessionUser()
  if (user && user.is_active && !user.removed_at) redirect(roleHome(user.role))
  return <LoginForm searchParams={searchParams} />
}
```
> `LoginForm` already `use()`s `searchParams`; passing the promise straight through is unchanged behaviour.

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/auth.js app/\(auth\)/update-password/page.js app/\(auth\)/login/page.js
git commit -m "feat(auth): forced password-change page + authed-visitor login redirect"
```

---

## Task 9: Forgot-password becomes a static notice

**Files:**
- Modify (rewrite): `app/(auth)/forgot-password/page.js`
- Delete: `app/(auth)/forgot-password/ForgotPasswordForm.js`
- Modify: `app/(auth)/[slug]/forgot-password/page.js` (render the same notice)

- [ ] **Step 1: Replace the page with a static notice**

Replace `app/(auth)/forgot-password/page.js` with:
```js
import Link from 'next/link'

export const metadata = { title: 'Reset Password' }

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-2">Forgot your password?</h1>
      <p className="text-sm text-text-secondary leading-relaxed">
        This system runs offline inside the exam network, so we can&apos;t email
        you a reset link. Ask your <strong>Exam Officer / administrator</strong> to
        reset your password — you&apos;ll be given a temporary one and prompted to
        set a new password when you next sign in.
      </p>
      <Link
        href="/login"
        className="inline-block mt-6 text-sm text-primary hover:text-primary-hover underline underline-offset-2"
      >
        Back to sign in
      </Link>
    </>
  )
}
```

- [ ] **Step 2: Delete the client form**

Run: `git rm "app/(auth)/forgot-password/ForgotPasswordForm.js"`

- [ ] **Step 3: Check the slug variant**

Read `app/(auth)/[slug]/forgot-password/page.js`. It currently renders `<ForgotPasswordForm universitySlug={slug} />`. Replace its body so it renders the same static notice as Step 1 (inline the JSX, or import a shared component — a shared `components/auth/ForgotPasswordNotice.js` is fine if you prefer; either is acceptable here). Keep whatever `params`/university lookup it does for branding, but drop the `ForgotPasswordForm` import.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "forgotPassword\|ForgotPasswordForm\|forgotPasswordSchema" app lib`
Expected: no matches.

- [ ] **Step 5: Full suite**

Run: `npx vitest run`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): forgot-password is a static contact-admin notice (offline LAN)"
```

---

## Task 10: Seed a real bootstrap password

**Files:**
- Modify: `prisma/seed.mjs`
- Modify: `prisma/seed.test.js`

- [ ] **Step 1: Update the seed to hash a password**

In `prisma/seed.mjs`:
- add near the other `SEED_*` constants:
  ```js
  const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || 'ChangePcu!2026'
  ```
- add the import at the top:
  ```js
  import { hashPassword } from '../lib/auth/password.js'
  ```
- in `seed()`, change the bootstrap-admin creation so the `data` includes:
  ```js
  password_hash: await hashPassword(SUPER_ADMIN_PASSWORD),
  must_change_password: true,
  ```
  (`must_change_password: true` stays — the seeded password is a shared bootstrap credential, so the first login forces a real one.)

- [ ] **Step 2: Update `prisma/seed.test.js`**

Change the two assertions about the admin:
```js
expect(admins[0].must_change_password).toBe(true)
expect(admins[0].password_hash).not.toBeNull()
```
Add a third test:
```js
it('the seeded admin password verifies', async () => {
  const { verifyPassword } = await import('@/lib/auth/password')
  await seed()
  const admin = await prisma.user.findFirst({ where: { role: 'super_admin' } })
  expect(await verifyPassword(admin.password_hash, process.env.SEED_SUPER_ADMIN_PASSWORD || 'ChangePcu!2026')).toBe(true)
})
```

- [ ] **Step 3: Run the seed test**

Run: `npx vitest run prisma/seed.test.js`
Expected: PASS (3 tests).

- [ ] **Step 4: Re-seed the dev DB**

Run:
```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<ask the user to type consent>" npm run db:reset
```
> `db:reset` is AI-guarded (Slice 0). Ask the user for one-line consent, pass it verbatim. Or, non-destructively: `npx prisma db seed` (the seed is idempotent — it will add the `password_hash` only if the admin row does not already exist, so on an existing DB you may need `npm run db:reset` to pick up the change; explain this to the user and let them choose).

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.mjs prisma/seed.test.js
git commit -m "feat(db): seed hashes a bootstrap super-admin password"
```

---

## Task 11: Env vars, example file, docs

**Files:**
- Modify: `.env` (local, git-ignored — not committed)
- Create: `.env.local.example`
- Modify: `docs/db/README.md`
- Modify: `README.md` (fix the stale Supabase-only setup note)

- [ ] **Step 1: Add local env vars**

Append to `.env` (not committed):
```
SESSION_COOKIE_SECURE=0
SEED_SUPER_ADMIN_PASSWORD=ChangePcu!2026
```

- [ ] **Step 2: Restore `.env.local.example`** (closes a standing TODO)

Create `.env.local.example`:
```
# ── Database (SQL Server) ─────────────────────────────────────────────
# Prisma + the app both read this (see prisma.config.ts).
DATABASE_URL="sqlserver://localhost:1433;database=pcu_cbt;user=sa;password=CHANGE_ME;encrypt=true;trustServerCertificate=true"

# ── Auth / sessions ──────────────────────────────────────────────────
# 1 only when the app is served over HTTPS (a reverse proxy on the LAN).
# Default 0 for plain-HTTP LAN deployment.
SESSION_COOKIE_SECURE=0

# ── Seed ─────────────────────────────────────────────────────────────
SEED_INSTITUTION_NAME="Precious Cornerstone University"
SEED_INSTITUTION_SLUG=pcu
SEED_SUPER_ADMIN_EMAIL=superadmin@pcu.edu.ng
SEED_SUPER_ADMIN_PASSWORD=CHANGE_ME_ON_FIRST_LOGIN
# SEED_SAMPLE_DATA=1   # uncomment to also seed a demo faculty/dept/course/lecturer/student

# ── Legacy Supabase (still used by not-yet-migrated flows — Slices 2-7) ──
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_ROLE_KEY=
```

- [ ] **Step 3: Add an Auth section to `docs/db/README.md`**

Append:
```markdown
## Auth (Slice 1)

Staff sign in with email + password (argon2id, `lib/auth/password.js`).
A successful login writes a row to `sessions` and sets the `pcu-cbt_session`
HttpOnly cookie holding an opaque token (its SHA-256 is the row id).
`lib/dal.js` (`getAuthUser` / `requireRole`) reads that cookie.

- Idle timeout 12 h (sliding), absolute 7 days.
- `SESSION_COOKIE_SECURE=1` only behind HTTPS.
- Seeded super-admin: `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`,
  forced to set a new password on first login.
- Forgot-password is a static "contact your admin" notice — no email on the
  air-gapped LAN. Password resets by an admin come in Slice 3.

Student credential-less auth (`exam_access` / `result_lookup` channels) is Slice 2.
```

- [ ] **Step 4: Fix `README.md`**

In the "Database (local dev)" section added in Slice 0, add a line under it:
```markdown
Seed credentials: `superadmin@pcu.edu.ng` / value of `SEED_SUPER_ADMIN_PASSWORD`
(you'll be forced to change it on first login).
```

- [ ] **Step 5: Commit**

```bash
git add .env.local.example docs/db/README.md README.md
git commit -m "docs(auth): restore .env.local.example, document Slice 1 auth"
```

---

## Task 12: Manual verification

**Files:** none

- [ ] **Step 1: Reset + seed a clean DB**

Run (with user consent for the guarded reset):
```bash
npm run db:reset   # replays migrations + runs seed
```

- [ ] **Step 2: Start the app**

Run: `npm run dev`
Open http://localhost:3000/login

- [ ] **Step 3: Walk the happy path**

1. Sign in as `superadmin@pcu.edu.ng` / `ChangePcu!2026` → lands on **`/update-password`** (forced).
2. Set a new password (≥ 8 chars) → lands on `/super-admin/dashboard`.
3. Reload the dashboard → still authenticated (cookie session works).
4. Visit `/login` while signed in → redirected to `/super-admin/dashboard`.
5. Sign out (sidebar) → back to `/login`; revisiting `/super-admin/dashboard` → redirected to `/login?next=/super-admin/dashboard`.
6. Sign in with the **new** password → dashboard, no forced change this time.
7. Sign in with a wrong password → "Incorrect email or password."

- [ ] **Step 4: Check the audit trail**

Run: `npm run db:studio` → open `admin_action_log` → confirm `logged_in`, `logged_out`, and one `login_failed` row from Step 3.7.

- [ ] **Step 5: Confirm the session row**

In Studio, `sessions` has one row while signed in, `channel = 'password'`, `id` is 64 hex chars, `expires_at` ~12 h ahead. It disappears after sign-out.

- [ ] **Step 6: Report results to the user** (screenshots or a written walk-through). Do **not** commit anything for this task.

---

## Self-Review

**Spec coverage (§3.1):**
- FR-AUTH-1 (staff email+password, argon2id, no plaintext) — Tasks 1, 7. ✅
- FR-AUTH-2 (`sessions` row shape, `pcu-cbt_session` HttpOnly SameSite=Lax, Secure conditional) — Tasks 2, 4. ✅
- FR-AUTH-3 (12 h idle sliding, 7 d absolute) — Task 4. ✅
- FR-AUTH-4 (sign-out deletes row + clears cookie) — Tasks 4, 7. ✅
- FR-AUTH-5 (`getAuthUser` validates token every request, redirects, `react.cache`, behaviour matches today) — Tasks 4, 5. ✅
- FR-AUTH-11 (invited staff forced to set a new password at first login) — Tasks 5 (`requireRole` redirect), 7 (`signIn` redirect), 8 (page), 10 (seed). ✅
- FR-AUTH-12 (`proxy.js` cookie-presence only, no DB; public prefixes) — Task 6. ✅
- NFR-SEC-6 (argon2id params) — Task 1. ✅
- NFR-SEC-7 (32-byte token, SHA-256-hashed at rest) — Task 4. ✅

**Explicitly deferred (correct):**
- FR-AUTH-6..10 (student `exam_access` / `result_lookup`, rate limiting, kiosk hygiene) — Slice 2.
- Admin-driven password reset — Slice 3.
- Session-cleanup cron (`deleteExpiredSessions` exists; the scheduled sweep) — Slice 7.
- Removing `lib/supabase/*`, `NEXT_PUBLIC_SITE_URL` cleanup — Slice 7.
- `[slug]/login` removal — Slice 3 (proxy keeps the legacy regex until then).

**Placeholder scan:** the only "ask the user" steps are the AI-guarded `db:reset` (Tasks 10, 12) — that guard is real and unavoidable, not a plan gap. Every code step has complete content.

**Type consistency:** `SafeUser` projection (`SAFE_USER_SELECT`) is defined identically in `sessions.js` and `users.js` and used by `readSessionUser` → `getAuthUser` → the 40 consumers. `createSession({ userId, channel, verifiedExamId, clientIp })` (camelCase args) vs repo `createSessionRow({ id, user_id, channel, verified_exam_id, client_ip, ... })` (snake_case row) — the mapping happens in `session.js`, consistently. `recordAuthEvent` snake_case keys match its call sites in `auth.js`. `readSessionUser` used (not `getSessionUser`) everywhere.

**Known limitation to mention when done:** between this slice and Slice 2, `/lab/*` and `/check-result/*` (student flows) are non-functional on the integration branch — expected, and why we are on `sqlserver-migration` not `main`.
