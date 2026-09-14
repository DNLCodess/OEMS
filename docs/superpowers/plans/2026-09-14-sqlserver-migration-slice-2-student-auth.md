# SQL Server Migration — Slice 2: Student Credential-less Auth + Lab IP Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port matric+access-code exam entry and matric+DOB result lookup off Supabase onto Prisma/SQL Server, and add the lab IP allowlist security control that gates exam entry.

**Architecture:** A new `server.js` custom Node server captures the true client IP (no reverse proxy exists) and hands it to the app as a header only the server itself can set. New pure-logic (`lib/security/clientIp.js`) and repository (`lib/db/repositories/{labIpAllowlist,verificationAttempts,students,exams}.js`) modules back a rewritten `lib/actions/studentAuth.js`, reusing Slice 1's `lib/auth/session.js` and `lib/db/repositories/auditLog.js`. Two existing pages (`app/lab/[code]/page.js`, `app/check-result/page.js`) are replaced with minimal stubs; their form components are reused unchanged or with a one-prop trim.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma (`sqlserver` provider), Vitest, plain `node:http` for the custom server. No new npm dependencies — CIDR matching is hand-rolled (IPv4-only, ~15 lines).

**Spec:** `docs/superpowers/specs/2026-09-14-sqlserver-migration-slice-2-student-auth-design.md`

## Global Constraints

- Matric numbers and access codes are always compared uppercase-trimmed (existing convention from the Supabase-era code — preserve exactly).
- Access codes are exactly 6 characters.
- Rate limit: 5 failed verifications per matric number within 15 minutes → blocked 15 minutes (`RATE_LIMIT_WINDOW_MINUTES = 15`, `RATE_LIMIT_MAX_ATTEMPTS = 5`).
- Error message copy is fixed and must match exactly (copied from the current `lib/actions/studentAuth.js`):
  - Generic: `'Check your details and try again.'`
  - Rate limited: `'Too many attempts. Please wait 15 minutes and try again.'`
  - Exam not open: `"This exam hasn't opened yet. Wait for your lecturer to begin it."`
  - Entry closed: `'Entry for this exam has closed. Speak to your invigilator.'`
  - IP blocked (new): `"This isn't an approved exam machine. Ask your invigilator."`
- IP allowlist matching is **IPv4-only** for this slice (matches the real lab-LAN deployment target).
- `TRUST_PROXY` env var: `'0'` (default) or `'1'`. Never auto-detected.
- Every new Prisma-backed module goes under `lib/db/repositories/*.js` and imports `prisma` from `@/lib/db/client` — never `PrismaClient` directly (existing convention).
- Every new server-only module starts with `import 'server-only'` (existing convention — see `lib/auth/session.js`, `lib/dal.js`).
- Tests: repository tests hit the real Prisma test DB via `testPrisma`/`resetDb`/`seedMinimalStructure` from `tests/helpers/db.js` (already updated in Slice 0 to include `labIpAllowlist`/`verificationAttempts` cleanup). Action tests (`lib/actions/*.test.js`) fully mock their repository/session/audit dependencies via `vi.mock` — they never touch the DB. This is Slice 1's established split; do not blend the two styles.
- Run `npm test` (vitest) after every task; all tests must stay green before moving on.

---

## Task 1: Custom server with a trustworthy direct-IP header

**Files:**
- Create: `server.js`
- Modify: `package.json` (scripts: `dev`, `start`)

**Interfaces:**
- Consumes: `next` (already a dependency).
- Produces: every request reaching the Next app now carries a request header `x-pcu-direct-ip` set to the real socket address (IPv4 dotted-quad, `::ffff:`-prefix stripped), and any client-supplied copy of that header has been discarded before Next sees the request. Task 2's `clientIp.js` reads this header by name.

- [ ] **Step 1: Write `server.js`**

```js
// Minimal custom server. Next.js App Router gives Server Actions and Route
// Handlers no access to the raw TCP socket — only request headers. With no
// reverse proxy in front (the LAN deployment is plain HTTP straight from
// Node), there is otherwise no trustworthy source of the client's real IP:
// a client can set X-Forwarded-For itself via curl/fetch(). So this file
// is the one place that reads req.socket.remoteAddress directly, and it
// stamps it into a header the rest of the app trusts — after first
// deleting any client-supplied copy, so it can never be spoofed.
import { createServer } from 'node:http'
import next from 'next'

const DIRECT_IP_HEADER = 'x-pcu-direct-ip'
const dev = process.env.NODE_ENV === 'development'
const hostname = process.env.HOSTNAME || '0.0.0.0' // IPv4 only — matches the lab LAN target
const port = Number(process.env.PORT) || 3000

const app = next({ dev, hostname, port, turbopack: dev })
const handle = app.getRequestHandler()

function normalizeIp(addr) {
  if (!addr) return 'unknown'
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

app.prepare().then(() => {
  createServer((req, res) => {
    delete req.headers[DIRECT_IP_HEADER]
    req.headers[DIRECT_IP_HEADER] = normalizeIp(req.socket.remoteAddress)
    handle(req, res)
  }).listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
```

- [ ] **Step 2: Update `package.json` scripts**

Change:
```json
    "dev": "next dev",
    "start": "next start",
```
to:
```json
    "dev": "NODE_ENV=development node server.js",
    "start": "node server.js",
```
(Leave `"build": "next build"` unchanged.)

- [ ] **Step 3: Verify the dev server still boots**

Run: `npm run dev` (in the background, then curl it)
Expected: it prints `> Ready on http://0.0.0.0:3000` (or the port actually bound, if 3000 is taken) and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login` returns `200`. Stop the server afterward (`pkill -f "node server.js"` or Ctrl-C if run in foreground).

- [ ] **Step 4: Verify the header is actually set (manual curl check)**

Since nothing reads `x-pcu-direct-ip` yet, verify indirectly: add a temporary `console.log(req.headers['x-pcu-direct-ip'])` inside the `createServer` callback in `server.js`, restart, `curl http://127.0.0.1:3000/login`, confirm the server log prints `127.0.0.1`, then remove the temporary `console.log`.

- [ ] **Step 5: Commit**

```bash
git add server.js package.json
git commit -m "feat(security): custom server captures a trustworthy direct client IP

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/security/clientIp.js` — IP resolution and allowlist matching

**Files:**
- Create: `lib/security/clientIp.js`
- Test: `lib/security/clientIp.test.js`
- Modify: `.env.local.example` (document `TRUST_PROXY`)

**Interfaces:**
- Consumes: nothing new (reads `process.env.TRUST_PROXY`; takes a `headers`-like object with `.get(name)`).
- Produces: `resolveClientIp(headers): string | null` and `isIpAllowed(ip: string, entries: {entry: string}[]): boolean`. `lib/actions/studentAuth.js` (Task 7) imports both. `entries` shape matches what `lib/db/repositories/labIpAllowlist.js` (Task 4) returns from `listActiveEntries`.

- [ ] **Step 1: Write the failing tests**

```js
// lib/security/clientIp.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { resolveClientIp, isIpAllowed } from './clientIp'

function headersFrom(obj) {
  const map = new Map(Object.entries(obj))
  return { get: (k) => map.get(k.toLowerCase()) ?? map.get(k) ?? null }
}

describe('resolveClientIp', () => {
  const ORIGINAL = process.env.TRUST_PROXY
  afterEach(() => { process.env.TRUST_PROXY = ORIGINAL })

  it('TRUST_PROXY=0 (default) reads x-pcu-direct-ip and ignores X-Forwarded-For even if present', () => {
    process.env.TRUST_PROXY = '0'
    const h = headersFrom({ 'x-pcu-direct-ip': '192.168.1.11', 'x-forwarded-for': '9.9.9.9' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY unset behaves like 0', () => {
    delete process.env.TRUST_PROXY
    const h = headersFrom({ 'x-pcu-direct-ip': '192.168.1.11' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY=1 reads the rightmost X-Forwarded-For hop', () => {
    process.env.TRUST_PROXY = '1'
    const h = headersFrom({ 'x-forwarded-for': '9.9.9.9, 192.168.1.11' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY=1 with no X-Forwarded-For returns null', () => {
    process.env.TRUST_PROXY = '1'
    const h = headersFrom({})
    expect(resolveClientIp(h)).toBeNull()
  })

  it('TRUST_PROXY=0 with no direct-ip header returns null', () => {
    process.env.TRUST_PROXY = '0'
    const h = headersFrom({})
    expect(resolveClientIp(h)).toBeNull()
  })
})

describe('isIpAllowed', () => {
  it('matches an exact IPv4 entry', () => {
    expect(isIpAllowed('192.168.1.11', [{ entry: '192.168.1.11' }])).toBe(true)
  })

  it('rejects an IP not in the list', () => {
    expect(isIpAllowed('192.168.1.99', [{ entry: '192.168.1.11' }])).toBe(false)
  })

  it('matches a CIDR range', () => {
    expect(isIpAllowed('192.168.1.42', [{ entry: '192.168.1.0/24' }])).toBe(true)
  })

  it('rejects an IP outside a CIDR range', () => {
    expect(isIpAllowed('192.168.2.42', [{ entry: '192.168.1.0/24' }])).toBe(false)
  })

  it('fails closed on an empty allowlist', () => {
    expect(isIpAllowed('192.168.1.11', [])).toBe(false)
  })

  it('fails closed on a null/undefined ip', () => {
    expect(isIpAllowed(null, [{ entry: '192.168.1.0/24' }])).toBe(false)
  })

  it('fails closed on a malformed entry instead of throwing', () => {
    expect(isIpAllowed('192.168.1.11', [{ entry: 'not-an-ip' }])).toBe(false)
  })

  it('fails closed on a non-IPv4 ip (e.g. IPv6)', () => {
    expect(isIpAllowed('::1', [{ entry: '::1' }])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/security/clientIp.test.js`
Expected: FAIL — `Cannot find module './clientIp'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/security/clientIp.js
const DIRECT_IP_HEADER = 'x-pcu-direct-ip'

export function resolveClientIp(headers) {
  const trustProxy = process.env.TRUST_PROXY === '1'
  if (trustProxy) {
    const xff = headers.get('x-forwarded-for')
    if (!xff) return null
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean)
    return hops.length ? hops[hops.length - 1] : null
  }
  return headers.get(DIRECT_IP_HEADER) || null
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function ipv4ToInt(ip) {
  if (!IPV4_RE.test(ip)) return null
  const parts = ip.split('.').map(Number)
  if (parts.some((p) => p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

export function isIpAllowed(ip, entries) {
  if (!ip) return false
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return false

  for (const { entry } of entries) {
    if (!entry) continue
    if (entry.includes('/')) {
      const [base, bitsStr] = entry.split('/')
      const bits = Number(bitsStr)
      const baseInt = ipv4ToInt(base)
      if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      if ((ipInt & mask) === (baseInt & mask)) return true
    } else {
      const entryInt = ipv4ToInt(entry)
      if (entryInt !== null && entryInt === ipInt) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/security/clientIp.test.js`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Document `TRUST_PROXY` in `.env.local.example`**

Add this block after the `SESSION_COOKIE_SECURE` line:
```
# 0 (default): trust only the direct socket IP captured by server.js.
# 1: a trusted local reverse proxy is in front; read the rightmost
# X-Forwarded-For hop instead. Never auto-detected — get this wrong and
# the lab IP allowlist either sees every client as the same address or
# becomes spoofable.
TRUST_PROXY=0
```

- [ ] **Step 6: Commit**

```bash
git add lib/security/clientIp.js lib/security/clientIp.test.js .env.local.example
git commit -m "feat(security): client IP resolution + IPv4 allowlist matching

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `lib/db/repositories/verificationAttempts.js`

**Files:**
- Create: `lib/db/repositories/verificationAttempts.js`
- Test: `lib/db/repositories/verificationAttempts.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`. Uses the existing `VerificationAttempt` model (`matric_number`, `ip`, `created_at`).
- Produces: `isRateLimited(matricNumber): Promise<boolean>`, `recordFailedAttempt(matricNumber, ip): Promise<void>`, `clearFailedAttempts(matricNumber): Promise<void>`. Task 7's `studentAuth.js` imports all three.

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/verificationAttempts.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import {
  isRateLimited, recordFailedAttempt, clearFailedAttempts,
} from './verificationAttempts'

describe('repositories/verificationAttempts', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('is not rate limited with zero attempts', async () => {
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('is rate limited at 5 attempts within the window', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/001')).toBe(true)
  })

  it('is not rate limited at 4 attempts', async () => {
    for (let i = 0; i < 4; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('ignores attempts older than the 15-minute window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000)
    for (let i = 0; i < 5; i++) {
      await prisma.verificationAttempt.create({
        data: { matric_number: 'CSC/2021/001', ip: '127.0.0.1', created_at: old },
      })
    }
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('rate limiting is scoped per matric number', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/002')).toBe(false)
  })

  it('clearFailedAttempts removes this matric number\'s history', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    await clearFailedAttempts('CSC/2021/001')
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
    expect(await prisma.verificationAttempt.count({ where: { matric_number: 'CSC/2021/001' } })).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/verificationAttempts.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/verificationAttempts.js
import 'server-only'
import { prisma } from '@/lib/db/client'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS = 5

export async function isRateLimited(matricNumber) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  const count = await prisma.verificationAttempt.count({
    where: { matric_number: matricNumber, created_at: { gte: since } },
  })
  return count >= RATE_LIMIT_MAX_ATTEMPTS
}

export async function recordFailedAttempt(matricNumber, ip) {
  await prisma.verificationAttempt.create({ data: { matric_number: matricNumber, ip } })
}

export async function clearFailedAttempts(matricNumber) {
  await prisma.verificationAttempt.deleteMany({ where: { matric_number: matricNumber } })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/verificationAttempts.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/verificationAttempts.js lib/db/repositories/verificationAttempts.test.js
git commit -m "feat(db): verification-attempts repo for student rate limiting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `lib/db/repositories/labIpAllowlist.js`

**Files:**
- Create: `lib/db/repositories/labIpAllowlist.js`
- Test: `lib/db/repositories/labIpAllowlist.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`. Uses the existing `LabIpAllowlist` model.
- Produces: `listActiveEntries(universityId): Promise<{entry: string}[]>`, `createEntry({universityId, entry, label, createdBy}): Promise<object>`. Task 7's `studentAuth.js` calls `listActiveEntries`; `createEntry` has no caller yet in this slice (built for Slice 3's admin UI and this task's own tests) — export it anyway, do not gate it behind anything.

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/labIpAllowlist.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { listActiveEntries, createEntry } from './labIpAllowlist'

async function aUser(universityId) {
  return prisma.user.create({
    data: { university_id: universityId, role: 'super_admin', email: 'sa@pcu.edu', full_name: 'SA' },
  })
}

describe('repositories/labIpAllowlist', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createEntry then listActiveEntries returns it', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await createEntry({ universityId: university.id, entry: '192.168.1.11', label: 'Lab A row 1', createdBy: admin.id })
    const rows = await listActiveEntries(university.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entry).toBe('192.168.1.11')
  })

  it('listActiveEntries excludes inactive rows', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    const row = await createEntry({ universityId: university.id, entry: '192.168.1.12', label: null, createdBy: admin.id })
    await prisma.labIpAllowlist.update({ where: { id: row.id }, data: { is_active: false } })
    expect(await listActiveEntries(university.id)).toHaveLength(0)
  })

  it('listActiveEntries returns an empty array when nothing is seeded', async () => {
    const { university } = await seedMinimalStructure()
    expect(await listActiveEntries(university.id)).toEqual([])
  })

  it('listActiveEntries scopes by university', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
    const otherUni = await prisma.university.create({ data: { name: 'Other', subdomain: 'other' } })
    expect(await listActiveEntries(otherUni.id)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/labIpAllowlist.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/labIpAllowlist.js
import 'server-only'
import { prisma } from '@/lib/db/client'

export async function listActiveEntries(universityId) {
  return prisma.labIpAllowlist.findMany({
    where: { university_id: universityId, is_active: true },
    select: { id: true, entry: true, label: true },
  })
}

export async function createEntry({ universityId, entry, label, createdBy }) {
  return prisma.labIpAllowlist.create({
    data: { university_id: universityId, entry, label, created_by: createdBy },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/labIpAllowlist.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/labIpAllowlist.js lib/db/repositories/labIpAllowlist.test.js
git commit -m "feat(db): lab IP allowlist repo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `lib/db/repositories/students.js`

**Files:**
- Create: `lib/db/repositories/students.js`
- Test: `lib/db/repositories/students.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces: `findStudentByMatric(matricNumber): Promise<{id, email, is_active, university_id} | null>`, `findStudentByMatricAndDob(matricNumber, dateOfBirth): Promise<{id, email, is_active, university_id} | null>`. Task 7 calls both. `dateOfBirth` is a JS `Date` (the caller parses the `YYYY-MM-DD` form field into one before calling — see Task 7).

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/students.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findStudentByMatric, findStudentByMatricAndDob } from './students'

async function aStudent(universityId, extra = {}) {
  return prisma.user.create({
    data: {
      university_id: universityId, role: 'student', email: 's@pcu.edu', full_name: 'S',
      matric_number: 'CSC/2021/001', date_of_birth: new Date('2003-05-14'), ...extra,
    },
  })
}

describe('repositories/students', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findStudentByMatric finds an active student', async () => {
    const { university } = await seedMinimalStructure()
    const s = await aStudent(university.id)
    const found = await findStudentByMatric('CSC/2021/001')
    expect(found.id).toBe(s.id)
  })

  it('findStudentByMatric returns null for an unknown matric number', async () => {
    await seedMinimalStructure()
    expect(await findStudentByMatric('NOPE/0000/000')).toBeNull()
  })

  it('findStudentByMatric only matches role=student', async () => {
    const { university } = await seedMinimalStructure()
    await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', matric_number: 'CSC/2021/001' },
    })
    expect(await findStudentByMatric('CSC/2021/001')).toBeNull()
  })

  it('findStudentByMatricAndDob matches on both fields', async () => {
    const { university } = await seedMinimalStructure()
    const s = await aStudent(university.id)
    const found = await findStudentByMatricAndDob('CSC/2021/001', new Date('2003-05-14'))
    expect(found.id).toBe(s.id)
  })

  it('findStudentByMatricAndDob returns null on a DOB mismatch', async () => {
    const { university } = await seedMinimalStructure()
    await aStudent(university.id)
    expect(await findStudentByMatricAndDob('CSC/2021/001', new Date('1999-01-01'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/students.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/students.js
import 'server-only'
import { prisma } from '@/lib/db/client'

const SELECT = { id: true, email: true, is_active: true, university_id: true }

export async function findStudentByMatric(matricNumber) {
  return prisma.user.findFirst({
    where: { role: 'student', matric_number: matricNumber },
    select: SELECT,
  })
}

export async function findStudentByMatricAndDob(matricNumber, dateOfBirth) {
  return prisma.user.findFirst({
    where: { role: 'student', matric_number: matricNumber, date_of_birth: dateOfBirth },
    select: SELECT,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/students.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/students.js lib/db/repositories/students.test.js
git commit -m "feat(db): student lookup repo for credential-less auth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `lib/db/repositories/exams.js` (entry-only)

**Files:**
- Create: `lib/db/repositories/exams.js`
- Test: `lib/db/repositories/exams.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces exactly these two functions — do not add more in this slice (Slice 5 owns the full exams repo):
  - `findExamByAccessCode(code): Promise<{id, university_id, status, go_live_at, entry_window_minutes, access_code_revoked_at, enforce_ip_allowlist, title, duration_minutes} | null>`
  - `findInProgressAttempt(examId, studentId): Promise<{id} | null>`

- [ ] **Step 1: Write the failing tests**

```js
// lib/db/repositories/exams.test.js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findExamByAccessCode, findInProgressAttempt } from './exams'

async function aLecturer(universityId) {
  return prisma.user.create({
    data: { university_id: universityId, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L' },
  })
}

async function anExam(university, course, lecturer, extra = {}) {
  return prisma.exam.create({
    data: {
      university_id: university.id, created_by: lecturer.id, course_id: course.id,
      title: 'CSC 301 Mid-Semester Test', duration_minutes: 60,
      academic_session: '2025/2026', semester: 'first', exam_type: 'mid_semester',
      status: 'live', access_code: 'ABC123', ...extra,
    },
  })
}

describe('repositories/exams (entry-only)', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findExamByAccessCode finds a live exam', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const found = await findExamByAccessCode('ABC123')
    expect(found.id).toBe(exam.id)
    expect(found.status).toBe('live')
  })

  it('findExamByAccessCode returns null for an unknown code', async () => {
    await seedMinimalStructure()
    expect(await findExamByAccessCode('ZZZZZZ')).toBeNull()
  })

  it('findExamByAccessCode exposes revocation and IP-enforcement fields', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const revokedAt = new Date()
    await anExam(university, course, lecturer, { access_code: 'DEF456', access_code_revoked_at: revokedAt, enforce_ip_allowlist: false })
    const found = await findExamByAccessCode('DEF456')
    expect(found.access_code_revoked_at.toISOString()).toBe(revokedAt.toISOString())
    expect(found.enforce_ip_allowlist).toBe(false)
  })

  it('findInProgressAttempt finds an in-progress attempt for this exam+student', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'in_progress' } })
    const found = await findInProgressAttempt(exam.id, student.id)
    expect(found.id).toBe(attempt.id)
  })

  it('findInProgressAttempt returns null when the attempt is already submitted', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'submitted' } })
    expect(await findInProgressAttempt(exam.id, student.id)).toBeNull()
  })

  it('findInProgressAttempt returns null when there is no attempt at all', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    expect(await findInProgressAttempt(exam.id, student.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/db/repositories/exams.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// lib/db/repositories/exams.js
//
// Entry-only. Slice 5 owns the full exams repository (create/update/list,
// access-code lifecycle management, question attachment). This file exists
// solely to support student verification (Slice 2) — do not add functions
// here that aren't needed by lib/actions/studentAuth.js or its stub pages.
import 'server-only'
import { prisma } from '@/lib/db/client'

export async function findExamByAccessCode(code) {
  return prisma.exam.findFirst({
    where: { access_code: code },
    select: {
      id: true, university_id: true, status: true, go_live_at: true,
      entry_window_minutes: true, access_code_revoked_at: true,
      enforce_ip_allowlist: true, title: true, duration_minutes: true,
    },
  })
}

export async function findInProgressAttempt(examId, studentId) {
  return prisma.attempt.findFirst({
    where: { exam_id: examId, student_id: studentId, status: 'in_progress' },
    select: { id: true },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/db/repositories/exams.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/exams.js lib/db/repositories/exams.test.js
git commit -m "feat(db): entry-only exams repo for student verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `lib/auth/session.js` — add `readStudentSession()`

**Files:**
- Modify: `lib/auth/session.js`
- Modify: `lib/auth/session.test.js`

**Interfaces:**
- Consumes: `findSessionWithUser` from `@/lib/db/repositories/sessions` (already imported in this file).
- Produces: `readStudentSession(): Promise<{ user, channel, verifiedExamId } | null>`. Does not change `readSessionUser`'s existing signature or return shape (40+ staff call sites depend on it staying a bare user object). Task 9 (`studentAuth.js`) imports `readStudentSession` for `endStudentSession`; the stub pages (Task 10, 11) import it to check `channel === 'exam_access' | 'result_lookup'`.

- [ ] **Step 1: Write the failing test** (append to `lib/auth/session.test.js`)

```js
// Add to the existing describe block in lib/auth/session.test.js, alongside
// the other tests. It needs: `import { createSession, readSessionUser,
// destroySession, readStudentSession } from '@/lib/auth/session'` — add
// readStudentSession to that existing import line.

it('readStudentSession exposes channel and verifiedExamId alongside the user', async () => {
  const u = await aUser({ role: 'student', matric_number: 'CSC/2021/001' })
  await createSession({ userId: u.id, channel: 'exam_access', verifiedExamId: 'exam-1' })
  const session = await readStudentSession()
  expect(session.user.id).toBe(u.id)
  expect(session.channel).toBe('exam_access')
  expect(session.verifiedExamId).toBe('exam-1')
})

it('readStudentSession returns null with no session cookie', async () => {
  expect(await readStudentSession()).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/session.test.js -t readStudentSession`
Expected: FAIL — `readStudentSession is not a function` (or not exported).

- [ ] **Step 3: Add the implementation** (in `lib/auth/session.js`, after `readSessionUser`)

Note: `verified_exam_id` is a foreign key to `Exam`, so `findSessionWithUser`'s `where: { id }` lookup already loads it via the existing `select` — check the current `findSessionWithUser` select block in `lib/db/repositories/sessions.js` includes `verified_exam_id: true` (it does, per Task/Slice 1's implementation — confirm before writing this, don't assume). Reuse the exact same expiry/touch logic as `readSessionUser` rather than duplicating it by having both delegate to one shared internal helper:

```js
// Shared by readSessionUser and readStudentSession — looks up the session
// row, enforces the idle + absolute expiry, and throttled last_seen_at
// touch. Returns the raw row (with channel/verified_exam_id) or null.
async function readValidSessionRow() {
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
  return row
}

export async function readSessionUser() {
  const row = await readValidSessionRow()
  return row?.user ?? null
}

export async function readStudentSession() {
  const row = await readValidSessionRow()
  if (!row) return null
  return { user: row.user, channel: row.channel, verifiedExamId: row.verified_exam_id }
}
```

Replace the existing `readSessionUser` function body with this (delete the old body, keep everything else in the file — `createSession`, `destroySession`, constants, imports — unchanged).

- [ ] **Step 4: Run all session tests to verify everything passes**

Run: `npx vitest run lib/auth/session.test.js`
Expected: PASS (all existing tests plus the 2 new ones — confirms the refactor didn't change `readSessionUser`'s behavior).

- [ ] **Step 5: Run the full suite to check nothing else broke**

Run: `npm test`
Expected: all tests pass (this touches a function 40+ files depend on transitively — the full run is the real check).

- [ ] **Step 6: Commit**

```bash
git add lib/auth/session.js lib/auth/session.test.js
git commit -m "feat(auth): expose channel + verifiedExamId via readStudentSession

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Seed data — sample exam, demo student DOB check, allowlist entries

**Files:**
- Modify: `prisma/seed.mjs`
- Modify: `prisma/seed.test.js`

**Interfaces:**
- Consumes: existing `seedSampleData(universityId)` helper (already creates the demo lecturer/student/course).
- Produces: when `SEED_SAMPLE_DATA=1`, also creates one `live` demo exam with access code `DEMO01` and two active `LabIpAllowlist` entries (`127.0.0.1`, and `192.168.1.0/24` as a documented example CIDR). No new exports — this only extends the existing `seedSampleData` function.

- [ ] **Step 1: Write the failing test** (append to `prisma/seed.test.js`)

```js
// Add to prisma/seed.test.js
it('SEED_SAMPLE_DATA=1 also seeds a live demo exam and lab IP allowlist entries', async () => {
  const original = process.env.SEED_SAMPLE_DATA
  process.env.SEED_SAMPLE_DATA = '1'
  try {
    await seed()
    const exam = await prisma.exam.findFirst({ where: { access_code: 'DEMO01' } })
    expect(exam).not.toBeNull()
    expect(exam.status).toBe('live')

    const entries = await prisma.labIpAllowlist.findMany({ where: { is_active: true } })
    expect(entries.map((e) => e.entry).sort()).toEqual(['127.0.0.1', '192.168.1.0/24'])
  } finally {
    process.env.SEED_SAMPLE_DATA = original
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run prisma/seed.test.js -t "demo exam"`
Expected: FAIL — `exam` is `null`.

- [ ] **Step 3: Extend `seedSampleData` in `prisma/seed.mjs`**

Inside `seedSampleData`, after the existing `student` block and before `return { faculty, department, course }`, add:

```js
  const examCreator = await prisma.user.findFirst({ where: { email: 'lecturer@pcu.edu.ng' } })
  const exam = await prisma.exam.findFirst({ where: { university_id: universityId, access_code: 'DEMO01' } })
  if (!exam && examCreator) {
    await prisma.exam.create({
      data: {
        university_id: universityId, created_by: examCreator.id, course_id: course.id,
        title: 'CSC 301 — Demo Mid-Semester Test', duration_minutes: 60,
        academic_session: '2025/2026', semester: 'first', exam_type: 'mid_semester',
        status: 'live', access_code: 'DEMO01', go_live_at: new Date(),
      },
    })
  }

  const superAdmin = await prisma.user.findFirst({ where: { role: 'super_admin' } })
  const allowlistDefaults = [
    { entry: '127.0.0.1', label: 'Local dev machine' },
    { entry: '192.168.1.0/24', label: 'Example lab subnet — replace before go-live' },
  ]
  for (const { entry, label } of allowlistDefaults) {
    const existingEntry = await prisma.labIpAllowlist.findFirst({ where: { university_id: universityId, entry } })
    if (!existingEntry && superAdmin) {
      await prisma.labIpAllowlist.create({
        data: { university_id: universityId, entry, label, created_by: superAdmin.id },
      })
    }
  }
```

Note: `examCreator` (the demo lecturer) and `superAdmin` are looked up rather than passed in because `seedSampleData` runs after the super-admin block in `seed()` but doesn't currently receive that user as a parameter — re-querying is simpler than threading it through and matches this file's existing find-or-create style throughout.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run prisma/seed.test.js`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.mjs prisma/seed.test.js
git commit -m "feat(db): seed a demo live exam and lab IP allowlist entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Rewrite `lib/actions/studentAuth.js`

**Files:**
- Modify: `lib/actions/studentAuth.js` (full rewrite of the body; same three exports)
- Modify: `lib/actions/studentAuth.test.js` (full rewrite)

**Interfaces:**
- Consumes: `resolveClientIp`, `isIpAllowed` (Task 2); `isRateLimited`, `recordFailedAttempt`, `clearFailedAttempts` (Task 3); `listActiveEntries` (Task 4); `findStudentByMatric`, `findStudentByMatricAndDob` (Task 5); `findExamByAccessCode`, `findInProgressAttempt` (Task 6); `createSession`, `destroySession`, `readStudentSession` (Task 7 + existing); `recordAuthEvent` from `@/lib/db/repositories/auditLog` (existing, Slice 1); `headers` from `next/headers`.
- Produces: `verifyExamAccess(prevState, formData)`, `verifyResultAccess(prevState, formData)`, `endStudentSession(code, returnTo)` — same names/arity as today, imported unchanged by `LabCodeEntry.js`, `MatricEntryForm.js`, `CheckResultForm.js`, `EndSessionButton.js` (Tasks 10–11 update those pages' props, not these action names).

- [ ] **Step 1: Write the failing tests** (full replacement of `lib/actions/studentAuth.test.js`)

```js
// lib/actions/studentAuth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p) => { throw new Error(`REDIRECT:${p}`) }),
}))
vi.mock('@/lib/security/clientIp', () => ({
  resolveClientIp: vi.fn(() => '192.168.1.11'),
  isIpAllowed: vi.fn(() => true),
}))
vi.mock('@/lib/db/repositories/verificationAttempts', () => ({
  isRateLimited: vi.fn(async () => false),
  recordFailedAttempt: vi.fn(),
  clearFailedAttempts: vi.fn(),
}))
vi.mock('@/lib/db/repositories/labIpAllowlist', () => ({
  listActiveEntries: vi.fn(async () => [{ entry: '192.168.1.11' }]),
}))
vi.mock('@/lib/db/repositories/students', () => ({
  findStudentByMatric: vi.fn(),
  findStudentByMatricAndDob: vi.fn(),
}))
vi.mock('@/lib/db/repositories/exams', () => ({
  findExamByAccessCode: vi.fn(),
  findInProgressAttempt: vi.fn(async () => null),
}))
vi.mock('@/lib/auth/session', () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  readStudentSession: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))

import { resolveClientIp, isIpAllowed } from '@/lib/security/clientIp'
import { isRateLimited, recordFailedAttempt, clearFailedAttempts } from '@/lib/db/repositories/verificationAttempts'
import { listActiveEntries } from '@/lib/db/repositories/labIpAllowlist'
import { findStudentByMatric, findStudentByMatricAndDob } from '@/lib/db/repositories/students'
import { findExamByAccessCode, findInProgressAttempt } from '@/lib/db/repositories/exams'
import { createSession, destroySession, readStudentSession } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { verifyExamAccess, verifyResultAccess, endStudentSession } from './studentAuth'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

const LIVE_EXAM = {
  id: 'exam-1', university_id: 'uni-1', status: 'live',
  go_live_at: new Date(Date.now() - 60_000), entry_window_minutes: 10,
  access_code_revoked_at: null, enforce_ip_allowlist: true,
  title: 'Demo Exam', duration_minutes: 60,
}
const ACTIVE_STUDENT = { id: 'student-1', email: 's@pcu.edu', is_active: true, university_id: 'uni-1' }

beforeEach(() => vi.clearAllMocks())

describe('verifyExamAccess', () => {
  it('rejects a client whose IP is not on the allowlist, without charging a rate-limit attempt', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    isIpAllowed.mockReturnValue(false)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toMatch(/not an approved exam machine|approved exam machine/i)
    expect(recordFailedAttempt).not.toHaveBeenCalled()
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'exam_entry_ip_blocked' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('fails closed when the allowlist is empty and enforcement is on', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    listActiveEntries.mockResolvedValue([])
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBeDefined()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('skips the IP check entirely when enforce_ip_allowlist is false', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, enforce_ip_allowlist: false })
    isIpAllowed.mockReturnValue(false) // would fail if checked
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalled()
  })

  it('treats a revoked access code as not-found', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, access_code_revoked_at: new Date() })
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('rate-limits after too many failed attempts', async () => {
    isRateLimited.mockResolvedValue(true)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Too many attempts. Please wait 15 minutes and try again.')
    expect(findExamByAccessCode).not.toHaveBeenCalled()
  })

  it('unknown access code: generic error, rate-limit charged, no IP check possible', async () => {
    findExamByAccessCode.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ZZZZZZ' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalledWith('CSC/2021/001', '192.168.1.11')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed' }))
  })

  it('exam not live: distinct message, no rate-limit charge', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, status: 'draft' })
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toMatch(/hasn't opened yet/)
    expect(recordFailedAttempt).not.toHaveBeenCalled()
  })

  it('unknown or inactive student: generic error, rate-limit charged', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    findStudentByMatric.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/999', access_code: 'ABC123' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
  })

  it('entry window closed with no in-progress attempt: entry-closed error', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, go_live_at: new Date(Date.now() - 3_600_000), entry_window_minutes: 10 })
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    findInProgressAttempt.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Entry for this exam has closed. Speak to your invigilator.')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('entry window closed but an in-progress attempt exists: resumes (escape hatch)', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, go_live_at: new Date(Date.now() - 3_600_000), entry_window_minutes: 10 })
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    findInProgressAttempt.mockResolvedValue({ id: 'attempt-1' })
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ channel: 'exam_access', verifiedExamId: 'exam-1' }))
  })

  it('happy path: mints a session, clears rate-limit history, logs in, redirects', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'csc/2021/001', access_code: 'abc123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalledWith({ userId: 'student-1', channel: 'exam_access', verifiedExamId: 'exam-1', clientIp: '192.168.1.11' })
    expect(clearFailedAttempts).toHaveBeenCalledWith('CSC/2021/001')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_in', target_user_id: 'student-1' }))
  })
})

describe('verifyResultAccess', () => {
  it('happy path: mints a result_lookup session and redirects', async () => {
    findStudentByMatricAndDob.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))).rejects.toThrow('REDIRECT:/check-result')
    expect(createSession).toHaveBeenCalledWith({ userId: 'student-1', channel: 'result_lookup', verifiedExamId: null, clientIp: '192.168.1.11' })
  })

  it('no IP allowlist check on result lookup', async () => {
    isIpAllowed.mockReturnValue(false)
    findStudentByMatricAndDob.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))).rejects.toThrow('REDIRECT:/check-result')
    expect(createSession).toHaveBeenCalled()
  })

  it('unknown matric+DOB pair: generic error, rate-limit charged', async () => {
    findStudentByMatricAndDob.mockResolvedValue(null)
    const r = await verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/999', date_of_birth: '2003-05-14' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
  })

  it('rate-limits after too many failed attempts', async () => {
    isRateLimited.mockResolvedValue(true)
    const r = await verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))
    expect(r.error).toBe('Too many attempts. Please wait 15 minutes and try again.')
  })
})

describe('endStudentSession', () => {
  it('logs the event and destroys the session, redirecting to /lab/{code}', async () => {
    readStudentSession.mockResolvedValue({ user: { id: 'student-1', university_id: 'uni-1' }, channel: 'exam_access', verifiedExamId: 'exam-1' })
    await expect(endStudentSession('ABC123')).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_out', target_user_id: 'student-1' }))
    expect(destroySession).toHaveBeenCalled()
  })

  it('redirects to /lab with no code given', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession(undefined)).rejects.toThrow('REDIRECT:/lab')
  })

  it('honors a safe returnTo of /check-result', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession(undefined, '/check-result')).rejects.toThrow('REDIRECT:/check-result')
  })

  it('rejects an unsafe returnTo and falls back to /lab/{code}', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession('ABC123', 'https://evil.example.com')).rejects.toThrow('REDIRECT:/lab/ABC123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: FAIL — the rewritten action doesn't exist yet (old Supabase version still in place, imports mismatch).

- [ ] **Step 3: Write the implementation** (full replacement of `lib/actions/studentAuth.js`)

```js
'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { resolveClientIp, isIpAllowed } from '@/lib/security/clientIp'
import { isRateLimited, recordFailedAttempt, clearFailedAttempts } from '@/lib/db/repositories/verificationAttempts'
import { listActiveEntries } from '@/lib/db/repositories/labIpAllowlist'
import { findStudentByMatric, findStudentByMatricAndDob } from '@/lib/db/repositories/students'
import { findExamByAccessCode, findInProgressAttempt } from '@/lib/db/repositories/exams'
import { createSession, destroySession, readStudentSession } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'

const GENERIC_ERROR = { error: 'Check your details and try again.' }
const RATE_LIMITED_ERROR = { error: 'Too many attempts. Please wait 15 minutes and try again.' }
const EXAM_NOT_OPEN_ERROR = { error: "This exam hasn't opened yet. Wait for your lecturer to begin it." }
const ENTRY_CLOSED_ERROR = { error: 'Entry for this exam has closed. Speak to your invigilator.' }
const IP_BLOCKED_ERROR = { error: "This isn't an approved exam machine. Ask your invigilator." }

async function getClientIp() {
  return resolveClientIp(await headers())
}

// ─── Enter exam: matric number + per-exam access code ──────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code: z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    access_code: formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()

  if (await isRateLimited(matric_number)) return RATE_LIMITED_ERROR

  const exam = await findExamByAccessCode(access_code)

  // A revoked code must be indistinguishable from an unknown one — same
  // message, same rate-limit charge — so a leaked-then-revoked code gives
  // no signal back to whoever is trying it.
  if (!exam || exam.access_code_revoked_at) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent({ action: 'login_failed', target_identifier: matric_number })
    return GENERIC_ERROR
  }

  if (exam.enforce_ip_allowlist) {
    const entries = await listActiveEntries(exam.university_id)
    // Empty allowlist + enforcement on = fail closed for everyone
    // (misconfiguration is safer than an open door).
    if (entries.length === 0 || !isIpAllowed(ip, entries)) {
      await recordAuthEvent({
        action: 'exam_entry_ip_blocked',
        target_identifier: matric_number,
        university_id: exam.university_id,
        meta: { ip },
      })
      return IP_BLOCKED_ERROR
    }
  }

  if (exam.status !== 'live') return EXAM_NOT_OPEN_ERROR

  const student = await findStudentByMatric(matric_number)

  if (!student || !student.is_active) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent(student
      ? { action: 'login_failed', target_user_id: student.id, university_id: exam.university_id }
      : { action: 'login_failed', target_identifier: matric_number },
    )
    return GENERIC_ERROR
  }

  const entryDeadline = exam.go_live_at
    ? new Date(exam.go_live_at).getTime() + exam.entry_window_minutes * 60 * 1000
    : null
  const windowOpen = !!entryDeadline && Date.now() <= entryDeadline

  if (!windowOpen) {
    const existingAttempt = await findInProgressAttempt(exam.id, student.id)
    if (!existingAttempt) return ENTRY_CLOSED_ERROR
  }

  await createSession({ userId: student.id, channel: 'exam_access', verifiedExamId: exam.id, clientIp: ip })

  await clearFailedAttempts(matric_number)
  await recordAuthEvent({
    action: 'logged_in',
    target_user_id: student.id,
    actor_id: student.id,
    university_id: exam.university_id,
  })

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ────────────────────────────

const resultAccessSchema = z.object({
  matric_number: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()

  if (await isRateLimited(matric_number)) return RATE_LIMITED_ERROR

  const student = await findStudentByMatricAndDob(matric_number, new Date(date_of_birth))

  if (!student || !student.is_active) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent(student
      ? { action: 'login_failed', target_user_id: student.id, university_id: student.university_id }
      : { action: 'login_failed', target_identifier: matric_number },
    )
    return GENERIC_ERROR
  }

  await createSession({ userId: student.id, channel: 'result_lookup', verifiedExamId: null, clientIp: ip })

  await clearFailedAttempts(matric_number)
  await recordAuthEvent({
    action: 'logged_in',
    target_user_id: student.id,
    actor_id: student.id,
    university_id: student.university_id,
  })

  redirect('/check-result')
}

// ─── End session (kiosk hygiene) ────────────────────────────────────────────

function isSafeReturnPath(returnTo) {
  return returnTo === '/check-result'
}

export async function endStudentSession(code, returnTo) {
  const session = await readStudentSession()
  if (session) {
    await recordAuthEvent({
      action: 'logged_out',
      target_user_id: session.user.id,
      actor_id: session.user.id,
      university_id: session.user.university_id ?? null,
    })
  }

  await destroySession()
  const destination = isSafeReturnPath(returnTo) ? returnTo : (code ? `/lab/${code}` : '/lab')
  redirect(destination)
}
```

Note on `isSafeReturnPath`: the old Supabase version also allowed
`/check-result/{slug}` (the legacy multi-tenant route). That route is
untouched dead code in this slice (see spec §1 "out of scope") and gets
no new links pointing at it, so this rewrite only allows plain
`/check-result` — simpler, and correct for the now-locked single-tenant
model.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/studentAuth.js lib/actions/studentAuth.test.js
git commit -m "feat(auth): port student credential-less auth to Prisma + lab IP gate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Replace `app/lab/[code]/page.js` with a minimal stub

**Files:**
- Modify: `app/lab/[code]/page.js` (full replacement)
- Modify: `app/lab/[code]/MatricEntryForm.js` (no change expected — verify only)
- Modify: `app/lab/[code]/EndSessionButton.js` (no change expected — verify only)
- Delete: `app/lab/[code]/LabStartButton.js`, `app/lab/[code]/loading.js`, `app/lab/[code]/result/`, `app/lab/[code]/attempt/` (Supabase-era, exam-taking flow — Slice 6 rebuilds this properly against Prisma; keeping dead files that reference `createClient`/`createAdminClient` around is confusing, not harmless, since they'd silently break if anyone imported them)

**Interfaces:**
- Consumes: `readStudentSession` (Task 7), `findExamByAccessCode` (Task 6), `MatricEntryForm`, `EndSessionButton` (both unchanged).
- Produces: nothing new consumed by later tasks — this is a leaf page.

- [ ] **Step 1: Confirm `MatricEntryForm.js` and `EndSessionButton.js` need no changes**

Read both files (shown in full in the design-phase exploration above). `MatricEntryForm` posts `access_code` (hidden) + `matric_number` to `verifyExamAccess` — unchanged signature, no edit needed. `EndSessionButton` calls `endStudentSession(code)` — unchanged signature, no edit needed. No step needed beyond confirming this by reading the files once more before deleting anything around them.

- [ ] **Step 2: Delete the exam-taking-flow files this slice doesn't own**

```bash
git rm app/lab/[code]/LabStartButton.js app/lab/[code]/loading.js
git rm -r app/lab/[code]/result app/lab/[code]/attempt
```

- [ ] **Step 3: Replace `app/lab/[code]/page.js`**

```js
import { notFound } from 'next/navigation'
import { findExamByAccessCode } from '@/lib/db/repositories/exams'
import { readStudentSession } from '@/lib/auth/session'
import { MatricEntryForm } from './MatricEntryForm'
import { EndSessionButton } from './EndSessionButton'
import { Monitor } from 'lucide-react'
import { BrandedPageBackground } from '@/components/shared/BrandedPageBackground'

export const metadata = { title: 'Exam — PCU CBT Lab' }

export default async function LabLobbyPage({ params }) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  const session = await readStudentSession()
  const isAuthedForThisExam = session?.channel === 'exam_access'

  if (!isAuthedForThisExam) {
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-sm">
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor size={12} />
                Lab Session · Code: {upperCode}
              </span>
            </div>
            <MatricEntryForm code={upperCode} />
          </div>
        </div>
      </BrandedPageBackground>
    )
  }

  const exam = await findExamByAccessCode(upperCode)
  if (!exam || exam.id !== session.verifiedExamId) notFound()

  return (
    <BrandedPageBackground>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm text-center">
          <Monitor size={48} className="mx-auto mb-4 text-text-muted" />
          <h1 className="text-xl font-bold text-text-primary mb-2">{exam.title}</h1>
          <p className="text-sm text-text-secondary mb-1">Duration: {exam.duration_minutes} minutes</p>
          <p className="text-sm text-text-muted mb-6">
            You&apos;re verified for this exam. Your exam will begin shortly — wait for your invigilator.
          </p>
          <EndSessionButton code={upperCode} />
        </div>
      </div>
    </BrandedPageBackground>
  )
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests pass (this page has no `.test.js` — no page in `app/` does, per existing convention — so this step confirms nothing else broke, e.g. an import of a deleted file).

- [ ] **Step 5: Commit**

```bash
git add -A app/lab
git commit -m "feat(lab): replace exam-lobby page with a minimal Prisma-backed stub

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Replace `app/check-result/page.js` with a minimal stub

**Files:**
- Modify: `app/check-result/page.js` (full replacement)
- Modify: `app/check-result/CheckResultForm.js` (drop the `universitySlug` prop/hidden field)
- Create: `app/check-result/EndSessionButton.js` (kiosk hygiene for this flow — the existing one lives under `app/lab/[code]/` and is scoped to that route)

**Interfaces:**
- Consumes: `readStudentSession` (Task 7), `verifyResultAccess` (Task 9, via `CheckResultForm`), `endStudentSession` (Task 9).
- Produces: nothing new consumed elsewhere — leaf page.

- [ ] **Step 1: Trim `CheckResultForm.js`**

Remove the `universitySlug` prop and its hidden input (single-tenant now — see spec §1):

```js
'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyResultAccess } from '@/lib/actions/studentAuth'

export function CheckResultForm() {
  const [state, formAction, pending] = useActionState(verifyResultAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2">
          Matric Number
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          placeholder="e.g. CSC/2021/001"
          autoComplete="off"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label htmlFor="date_of_birth" className="block text-sm font-medium text-text-primary mb-2">
          Date of Birth
        </label>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Checking…</>
          : <><ArrowRight size={16} /> View My Results</>
        }
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Leave `app/check-result/CheckAnotherResultButton.js` in place, untouched**

It's still imported by `app/check-result/[slug]/page.js` (Supabase-based, untouched dead-but-functional route, per spec §1 — removed in Slice 3, not this slice). Deleting it would break that route's build. The new stub below uses a fresh `EndSessionButton` instead, so the plain (non-slug) `/check-result` page simply stops importing `CheckAnotherResultButton` — the file itself stays.

- [ ] **Step 3: Create `app/check-result/EndSessionButton.js`**

```js
'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { endStudentSession } from '@/lib/actions/studentAuth'

export function EndSessionButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    await endStudentSession(undefined, '/check-result')
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary border border-border rounded-xl hover:bg-surface disabled:opacity-60 transition-colors"
    >
      <LogOut size={16} />
      {loading ? 'Signing out…' : 'Check another result'}
    </button>
  )
}
```

- [ ] **Step 4: Replace `app/check-result/page.js`**

```js
import { readStudentSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'
import { CheckResultForm } from './CheckResultForm'
import { EndSessionButton } from './EndSessionButton'

export const metadata = { title: 'Check Result — PCU CBT' }

export default async function CheckResultPage() {
  const session = await readStudentSession()
  const isResultLookupSession = session?.channel === 'result_lookup'

  if (!isResultLookupSession) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
              O
            </div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
            <p className="text-sm text-text-muted mt-1">
              Enter your matric number and date of birth
            </p>
          </div>
          <CheckResultForm />
        </div>
      </div>
    )
  }

  // Real released results, read directly — this one query, used only here,
  // doesn't earn a repository module (Slice 5/6 will introduce a proper
  // results repo when they build the full results dashboard).
  const results = await prisma.result.findMany({
    where: { student_id: session.user.id, released_at: { not: null } },
    select: { final_score: true, passed: true, exam: { select: { title: true } } },
    orderBy: { created_at: 'desc' },
  })

  return (
    <div className="flex-1 px-4 py-16">
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-bold text-text-primary mb-6">Your Results</h1>
        {results.length === 0 ? (
          <p className="text-sm text-text-muted mb-8">No released results yet.</p>
        ) : (
          <ul className="space-y-3 mb-8 text-left">
            {results.map((r, i) => (
              <li key={i} className="bg-surface border border-border rounded-xl p-4">
                <p className="text-sm font-semibold text-text-primary">{r.exam.title}</p>
                <p className="text-sm text-text-secondary">
                  Score: {r.final_score} · {r.passed ? 'Passed' : 'Not passed'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <EndSessionButton />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A app/check-result
git commit -m "feat(check-result): replace with a single-tenant Prisma-backed stub

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Manual end-to-end verification

**Files:** none (verification only, no commits from this task unless a bug is found).

- [ ] **Step 1: Start SQL Server + the app**

```bash
docker start pcucbt-sql   # or docker compose up, whatever this machine used before
SEED_SAMPLE_DATA=1 node prisma/seed.mjs
npm run dev
```

Confirm the terminal prints `> Ready on http://0.0.0.0:<port>` (from `server.js`, Task 1) — if it still says `Next.js 16.2.4 (Turbopack)` with a bare `- Local:` line and no `> Ready on`, the custom server isn't actually running; check the `dev` script in `package.json`.

- [ ] **Step 2: Happy path — exam entry from an allowlisted IP**

Visit `http://127.0.0.1:<port>/lab/DEMO01` (matches the seeded demo exam's access code). Enter matric number `CSC/2021/001`. Expect: redirected to the stub showing "CSC 301 — Demo Mid-Semester Test", 60 minutes, "You're verified..." message, and an end-session button.

- [ ] **Step 3: IP-blocked path**

Temporarily remove or deactivate the `127.0.0.1` allowlist entry (`docker exec` into the SQL Server container, or add a quick `UPDATE lab_ip_allowlist SET is_active = 0 WHERE entry = '127.0.0.1'` via `sqlcmd`), then retry Step 2. Expect: the distinct "This isn't an approved exam machine" message, not the generic one. Re-activate the entry afterward (`UPDATE lab_ip_allowlist SET is_active = 1 WHERE entry = '127.0.0.1'`).

- [ ] **Step 4: Rate limiting**

Submit a wrong matric number against `/lab/DEMO01` five times in a row. Expect: the 5th (or a subsequent) attempt returns "Too many attempts...". Wait is not required to confirm this — just confirm the message appears at attempt 5.

- [ ] **Step 5: Result lookup happy path**

Visit `http://127.0.0.1:<port>/check-result`. Enter matric `CSC/2021/001`, DOB `2003-05-14` (the seeded demo student's DOB). Expect: redirected to the results stub, "No released results yet." (no results have been released for the demo student in seed data).

- [ ] **Step 6: End session (kiosk hygiene)**

From the post-auth `/lab/DEMO01` stub, click "Sign out of this session". Expect: redirected back to `/lab/DEMO01`'s pre-auth matric-entry form (not the exam stub). Confirm hitting `/lab/DEMO01` again shows the matric entry form again, not the exam stub — i.e., the session was actually destroyed, not just the UI navigated away.

- [ ] **Step 7: Report results to the user**

Summarize pass/fail for each step above. Do not commit anything for this task — it's verification only, matching Slice 1's Task 12 precedent.

---

## Self-Review

**Spec coverage:**
- FR-AUTH-6 (exam entry, IP check, revocation check, rate limit, entry window + escape hatch) — Task 9. ✅
- FR-AUTH-7 (result lookup) — Task 9. ✅
- FR-AUTH-8 (channel-gated sessions) — Task 7 (`readStudentSession`), Tasks 10–11 (pages check `channel`). ✅
- FR-AUTH-9 (rate limiting, 5/15min, cleared on success) — Task 3, wired in Task 9. ✅
- FR-AUTH-10 (kiosk hygiene / end session) — Task 9 (`endStudentSession`), Tasks 10–11 (buttons). ✅
- FR-LAB-1 (allowlist storage, IPv4/CIDR, label, is_active) — Task 4 (repo); admin UI explicitly deferred to Slice 3 per spec. ✅
- FR-LAB-2 (enforcement on exam-entry verification; result lookup exempt) — Task 9. ✅ (startExam/saveAnswer enforcement is Slice 6, out of scope here — matches spec.)
- FR-LAB-3 (`enforce_ip_allowlist` per-exam override, read-only this slice) — Task 6 exposes the field, Task 9 reads it. ✅
- FR-LAB-4 (fail closed on empty allowlist) — Task 9. ✅
- FR-LAB-5 (`TRUST_PROXY`-aware IP resolution) — Tasks 1–2. ✅
- FR-LAB-6 (`exam_entry_ip_blocked` audit log with attempted IP) — Task 9. ✅
- FR-EXAM-7 (revoked code rejected, indistinguishable from unknown) — Task 9. ✅
- NFR-SEC-9 (`TRUST_PROXY` explicit, never auto-detected) — Task 2. ✅
- NFR-TEST-5 (clientIp unit tests: exact/CIDR/both TRUST_PROXY modes/empty-fail-closed) — Task 2. ✅
- NFR-TEST-4 (manual UAT: non-allowlisted IP refused, revoke blocks new entry) — Task 12. ✅ (in-progress-attempt-survives-revoke isn't separately UAT'd since Slice 6 owns the actual in-progress attempt UI this would resume into — the unit test in Task 9 covers the underlying logic.)

**Explicitly deferred (correct, matches spec §1):**
- FR-EXAM-3 (exam_access per-student list) — Slice 6.
- Lab IP allowlist admin UI — Slice 3.
- `/check-result/[slug]`, `/[slug]/login` removal — Slice 3.
- Full exam/attempt data, question counts, instructions — Slices 5/6.

**Placeholder scan:** no "TBD"/"handle appropriately" — every step has literal code or an exact command.

**Type consistency check:** `createSession({ userId, channel, verifiedExamId, clientIp })` (Task 7, pre-existing) matches every call site in Task 9. `readStudentSession()` returns `{ user, channel, verifiedExamId }` consistently across Task 7's implementation and Tasks 9–11's consumers (`session.channel`, `session.verifiedExamId`, `session.user.id`). `findExamByAccessCode` and `findInProgressAttempt` (Task 6) signatures match their Task 9 and Task 10 call sites exactly (field names `access_code_revoked_at`, `enforce_ip_allowlist`, `go_live_at`, `entry_window_minutes` all match the Prisma schema directly, not renamed).

**Known limitation to mention when done:** `server.js` (Task 1) changes how the dev server starts — anyone with `npm run dev` already running from before this slice needs to restart it to pick up the custom server and the `x-pcu-direct-ip` header. Windows Service installation (NSSM wrapping `npm run start`) still works unchanged since it just runs a different script under the same command.
