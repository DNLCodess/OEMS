# PCU CBT — Supabase → SQL Server Migration (LAN CBT Platform)

**Date:** 2026-09-07
**Status:** Design approved, implementation pending
**Owner:** DNLCodess
**Revised:** 2026-09-07 — proctoring/anti-cheat deferred to v2; exam-entry
access-code lifecycle spelled out; lab IP allowlist added as the primary
in-hall enforcement control.

---

## 1. Background & Goal

PCU CBT today is a multi-tenant SaaS built on **Supabase** (managed
PostgreSQL + Supabase Auth + Row Level Security + Storage). It must
become a **self-hosted, offline, single-institution Computer-Based
Testing (CBT) platform** that runs on **one Windows server PC on an
isolated lab LAN**, backed by **Microsoft SQL Server**.

The driving reasons: exam-hall deployments have no reliable internet,
the institution wants data on-premises, and the network is
deliberately air-gapped to prevent cheating.

**Exam integrity for v1** relies on three controls, not on camera
proctoring or browser lockdown (both deferred to v2):
1. the air-gapped LAN (no route off-network),
2. a per-exam **access code** the invigilator hands out in the hall and
   can revoke at any moment, and
3. a **lab IP allowlist** — only client machines whose IP is on the
   institution's approved list may enter or answer an exam, so a valid
   matric number + a leaked code from a personal laptop/phone on the LAN
   is still refused.

### Decisions locked in (from brainstorming)

| Decision | Choice |
|---|---|
| Data migration | **Fresh start** — no ETL. Port schema + code; seed fresh. |
| Tenancy | **Logical single-tenant** — schema keeps `university_id` FKs, app enforces exactly one institution row. No subdomain routing, no cross-tenant super-admin duties. |
| Auth | **Custom session-cookie auth** — own the `users` table, hash staff passwords, opaque session tokens in an HttpOnly cookie backed by a `sessions` table. |
| DB access layer | **Prisma** (SQL Server provider) + a thin repository layer at `lib/db`. |
| Migration style | **Ports-and-adapters, incremental** — introduce `lib/db` + `lib/auth` boundaries, translate RLS policies to code, rewrite the 52 Supabase call sites feature-slice by feature-slice with tests green at each step. |
| Concurrency target | **150–200 concurrent students** on one exam sitting. |
| Proctoring / anti-cheat | **Deferred to v2.** v1 exam integrity = air-gapped LAN + revocable per-exam access code + lab IP allowlist. |
| In-hall enforcement | **Lab IP allowlist** — exam entry and answer-saving only from approved lab-PC IPs/CIDRs. |
| Delivery mode | **Lab-only.** Remote exam delivery is fully removed — no `exam_mode` concept, no `remote` value. The supervised in-lab `/lab/{code}` flow is the only student path. |

### Non-goals

- Multi-server / HA / clustering.
- Internet-facing deployment, TLS from a public CA.
- Migrating historical Supabase data.
- Keeping Supabase as a fallback runtime.
- Mobile apps.
- **Remote / unsupervised exam delivery.** This build is exclusively
  for supervised computer-lab sittings. The `exams.exam_mode` column,
  the `remote` value and its CHECK, and any "Delivery Mode" UI are
  removed. Every exam is a lab exam; every student enters through
  `/lab/{access_code}` from an allowlisted lab PC.
- **Camera-snapshot proctoring and browser-lockdown anti-cheat
  (fullscreen enforcement, clipboard/context-menu blocking, tab-blur
  logging)** — deferred to **v2**. The existing
  `components/student/ProctoringCamera.js` and any client lockdown code
  are removed/disabled during the migration, not ported.

---

## 2. System Architecture (target)

```
        Isolated lab LAN (no WAN)
  ┌───────────────────────────────────────────────┐
  │  SERVER PC  (Windows, static IP 192.168.1.100) │
  │                                               │
  │   ┌─────────────────────────────────────────┐ │
  │   │ Next.js (node, `next start`) :3000       │ │
  │   │   - Server Components / Server Actions   │ │
  │   │   - lib/auth  (session cookie)           │ │
  │   │   - lib/db    (Prisma + repositories)    │ │
  │   └───────────────┬─────────────────────────┘ │
  │                   │ localhost:1433 (TCP, loopback only) │
  │   ┌───────────────▼─────────────────────────┐ │
  │   │ SQL Server 2022  (DB: pcu_cbt)              │ │
  │   └─────────────────────────────────────────┘ │
  │   Windows Service wrapper + Task Scheduler backup │
  └───────────────────────────────────────────────┘
          ▲            ▲              ▲
     Ethernet switch / dedicated Wi-Fi AP (WAN port unplugged)
          │            │              │
     ┌────┴───┐   ┌────┴───┐     ┌────┴───┐
     │ Lab PC │   │ Lab PC │ ... │ Lab PC │   Chrome/Edge → http(s)://192.168.1.100:3000
     └────────┘   └────────┘     └────────┘
```

**Key architectural change:** authorization moves from the database
(Postgres RLS) into the **application repository layer**. Every RLS
policy becomes an explicit `WHERE` clause + role guard in a
`lib/db/repositories/*` function, covered by a unit test.

### Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `lib/db/client.js` | Singleton `PrismaClient`, pool config | Prisma |
| `lib/db/repositories/*.js` | One file per aggregate (users, exams, questions, attempts, results, structure, logs). All SQL lives here. Enforces authz via caller-supplied actor context. | `lib/db/client` |
| `lib/auth/session.js` | Create / read / destroy sessions; cookie handling | `lib/db`, `next/headers` |
| `lib/auth/password.js` | `hash()` / `verify()` (argon2id) | `@node-rs/argon2` |
| `lib/dal.js` | `getAuthUser()`, `requireRole()` — unchanged signature, now reads the session cookie instead of Supabase | `lib/auth`, `lib/db` |
| `lib/actions/*.js` | Server Actions — unchanged responsibilities, call repositories instead of Supabase client | `lib/dal`, `lib/db` |
| `lib/security/clientIp.js` | Resolve the true client IP (trusted-proxy aware) and test it against the lab allowlist (IP + CIDR) | `lib/db` (allowlist repo), config |
| `middleware.js` | Cookie-presence redirect only (no DB). IP allowlist is **not** enforced here (middleware can't see the socket IP reliably behind the proxy without extra config) — it is enforced in the exam Server Actions. | `lib/auth` (cookie name) |

---

## 3. Functional Requirements

IDs are stable references for the implementation plan.

### 3.1 Authentication & Sessions

- **FR-AUTH-1** Staff (`super_admin`, `school_admin`, `lecturer`) sign
  in with **email + password**. Passwords are hashed with **argon2id**;
  the plaintext is never stored or logged.
- **FR-AUTH-2** A successful sign-in creates a row in `sessions`
  (opaque 256-bit random token, `user_id`, `channel='password'`,
  `created_at`, `expires_at`, `last_seen_at`) and sets an **HttpOnly,
  SameSite=Lax** cookie `pcu-cbt_session` holding the token. Cookie
  `Secure` flag is **on when served over HTTPS, off over plain HTTP**
  (LAN fallback).
- **FR-AUTH-3** Staff sessions expire after **12 hours** of inactivity
  (`last_seen_at` sliding) and **7 days** absolute.
- **FR-AUTH-4** Sign-out deletes the session row and clears the cookie.
- **FR-AUTH-5** `getAuthUser()` validates the cookie token against
  `sessions` on every request (joined to `users`), redirects to
  `/login` if missing/expired/!`is_active`, and is `react.cache`-wrapped
  per request. Behaviour matches today's `lib/dal.js`.
- **FR-AUTH-6** **Credential-less student exam entry** (replaces the
  Supabase magic-link mint): student submits **matric number +
  the exam's current access code**. The server, in order, checks:
  (a) the request's client IP is on the **lab allowlist** (FR-LAB-1) —
  else reject with a distinct "not an approved exam machine" message and
  **no** rate-limit charge; (b) rate limit (FR-AUTH-9); (c) an exam with
  that access code exists, is `live`, and the code is **not revoked**
  (FR-EXAM-7); (d) the matric number belongs to an active student with
  access to that exam; (e) entry window open **or** an existing
  `in_progress` attempt. On success the server creates a session with
  `channel='exam_access'` and `verified_exam_id=<that exam>`, records the
  client IP on the session, and redirects to `/lab/{code}`.
- **FR-AUTH-7** **Credential-less result lookup**: student submits
  **matric number + date of birth**. On success, session with
  `channel='result_lookup'`, `verified_exam_id=NULL`.
- **FR-AUTH-8** A `result_lookup` session **cannot** start, save, or
  submit an exam attempt. A `exam_access` session can only start the
  exam matching its `verified_exam_id`. (Equivalent to today's
  `app_metadata` checks in `lib/actions/attempts.js`, now enforced by
  reading the `sessions` row server-side.)
- **FR-AUTH-9** **Rate limiting**: ≥5 failed student verification
  attempts for the same matric number within 15 minutes → blocked for
  15 minutes. Backed by a `verification_attempts` table. A successful
  verification clears that matric number's history.
- **FR-AUTH-10** **Kiosk hygiene**: "End session" on a lab machine
  deletes the session and returns to `/lab/{code}` (or an allowlisted
  `/check-result[...]` path) so the next student starts clean.
- **FR-AUTH-11** Invited staff receive a temporary password and are
  **forced to set a new one at first login** (closes an existing TODO).
- **FR-AUTH-12** `middleware.js` redirects unauthenticated users away
  from protected paths based on **cookie presence only** (no DB call);
  full validation happens in the DAL. Public prefixes: `/login`,
  `/forgot-password`, `/lab`, `/check-result`.

### 3.2 Institution / Structure (single-tenant)

- **FR-INST-1** Exactly **one `universities` row** exists (the
  institution). It is created by the DB seed, editable by
  `super_admin` (name, logo path, primary colour). No creation/deletion
  UI.
- **FR-INST-2** Subdomain / `/[slug]/login` / `/[slug]/check-result`
  branded routing is **removed**. Only plain `/login` and
  `/check-result` remain.
- **FR-INST-3** `super_admin` collapses to a single top-level admin
  role; `school_admin` remains for delegated day-to-day admin. All four
  enum values (`super_admin`, `school_admin`, `lecturer`, `student`)
  are **retained** to minimise code churn — `university_id` scoping
  stays in queries but always resolves to the one institution.
- **FR-INST-4** Faculties → Departments → Courses hierarchy, and the
  admin CRUD for them, are **unchanged**.

### 3.3 Question Bank

- **FR-QB-1** Lecturers create/edit/archive their own questions
  (`mcq`, `multi_select`, `true_false`, `fill_blank`, `short_answer`,
  `essay`) scoped to a course. Behaviour unchanged from today.
- **FR-QB-2** Lecturers can read non-archived questions authored by
  other lecturers in the institution (per current
  `lecturer_read_university_questions` policy, now a repo `WHERE`).
- **FR-QB-3** `options` and `correct_answer` are stored as **JSON
  strings** (`NVARCHAR(MAX)`); the repo layer parses/serialises. `tags`
  stored as a JSON string array.
- **FR-QB-4** Department-scoped question visibility (per the
  2026-08-11 lecturer-department-scope design) is preserved.

### 3.4 Exams

- **FR-EXAM-1** Lecturers CRUD exams (draft → scheduled → live →
  closed), attach question-bank questions with per-question marks and
  order, set duration, pass mark, randomisation flags, calculator/tips,
  entry window, access code.
- **FR-EXAM-2** **Lab-only delivery.** There is no delivery-mode
  choice. The `exam_mode` column, the `remote` enum value/CHECK, and the
  "Delivery Mode" settings UI are removed. Every student enters via
  `/lab/{access_code}` (FR-AUTH-6). If the live migrations still carry a
  separate `lab_code` distinct from `access_code`, the plan consolidates
  to one code.
- **FR-EXAM-3** Per-student `exam_access` list semantics unchanged: if
  rows exist for an exam, only listed students may access it; otherwise
  all institution students may.
- **FR-EXAM-4** `updateExamStatus` stamps `go_live_at` on the
  transition to `live`; the entry window is `go_live_at +
  entry_window_minutes`.
- **FR-EXAM-5** Bulk matric-list import for `exam_access` (per the
  2026-08-11 bulk-import design) is preserved.

#### Exam access code lifecycle

- **FR-EXAM-6** Each exam has a short **access code** (6 uppercase
  alphanumeric chars, ambiguous chars `0/O/1/I` excluded). The lecturer
  **generates** it from the exam page; it is displayed large and
  printable so the invigilator can write it on the board / hand it out
  to everyone in the lab.
- **FR-EXAM-7** The lecturer can **revoke** the code at any time
  (during the exam included). Revoking sets `access_code_revoked_at`.
  A revoked code immediately fails **new** exam entry (FR-AUTH-6c); it
  does **not** affect students already `in_progress` (they keep their
  session and the FR-ATT-3 resume path). Revoke + generate again mints a
  fresh code (old one stays dead).
- **FR-EXAM-8** The access code is only accepted while the exam is
  `live` and within the entry window; outside that it is inert
  regardless of revoke state.
- **FR-EXAM-9** Access codes are unique among **non-revoked** exams so a
  code always resolves to exactly one exam.

### 3.4a Lab access control (IP allowlist)

- **FR-LAB-1** The institution maintains a **lab IP allowlist**: a set
  of entries, each a single IPv4 address **or** a CIDR range (e.g.
  `192.168.1.0/24`), with an optional label ("Lab A row 1", etc.) and an
  `is_active` flag. Managed by `school_admin` / `super_admin` in an admin
  page (`/admin/lab-network` or under settings).
- **FR-LAB-2** **Enforcement points** — the resolved client IP must
  match an active allowlist entry for: student exam-entry verification
  (FR-AUTH-6a), `startExam`, and `saveAnswer`. `submitExam` is
  **exempt** (finalising an attempt already legitimately started must
  never be blocked). A mismatch returns a distinct, non-rate-limited
  error. Staff and result-lookup flows are **not** IP-restricted.
- **FR-LAB-3** **Per-exam override**: `enforce_ip_allowlist` defaults
  **true** on every exam. A lecturer can turn it off for a specific exam
  (e.g. a staff practice run) — when false, FR-LAB-2 is skipped for that
  exam.
- **FR-LAB-4** If the allowlist is **empty** and `enforce_ip_allowlist`
  is true, exam entry **fails closed** for everyone (misconfiguration is
  safer than an open door) — the admin UI warns loudly about this state.
- **FR-LAB-5** Client IP resolution: when `TRUST_PROXY=1` (HTTPS/reverse
  proxy deployment) the app reads the **last** hop of
  `X-Forwarded-For` as set by the local proxy; otherwise it uses the
  direct socket remote address. The mode is explicit config, never
  auto-detected (an attacker-set `X-Forwarded-For` must never be trusted
  when there is no proxy). See NFR-SEC-9.
- **FR-LAB-6** Every allowlist rejection is written to
  `admin_action_log` (`action='exam_entry_ip_blocked'`, target =
  matric number, meta = attempted IP) so invigilators/admins can see
  off-network attempts after the fact.

### 3.5 Attempts, Autosave & Resilience

- **FR-ATT-1** A student starts **one attempt per exam** (unique
  `(exam_id, student_id)`). Starting requires a live exam, an
  `exam_access` session verified for that exam, a client IP on the lab
  allowlist (FR-LAB-2, when enforced for the exam), and either an open
  entry window **or** an existing `in_progress` attempt (the recovery
  escape hatch — unchanged from today).
- **FR-ATT-2** **Autosave**: the client saves answers via a Server
  Action **debounced to 15 seconds** and on every explicit navigation
  between questions, **not on every keystroke/click**. (Rationale:
  NFR-PERF budget — see §5.) Each save is an idempotent upsert into
  `responses` keyed by `(attempt_id, question_id)`.
- **FR-ATT-3** **Crash recovery**: a student whose machine dies can log
  in on another lab PC with the same matric + access code and resume
  the same `in_progress` attempt with all saved answers and the
  correct remaining time (`started_at + duration_minutes`).
- **FR-ATT-4** **Server-side time backstop**: `saveAnswer` rejects
  writes after `started_at + duration_minutes`; `submitExam` is always
  callable (the only way out of time-over). `saveAnswer` also re-checks
  the lab allowlist (FR-LAB-2); `submitExam` does **not** (a student
  must always be able to finalise an attempt they legitimately started).
- **FR-ATT-5** **Offline resilience on the client** (per the
  2026-08-12 offline-resilience design) is preserved: queued answers in
  `localStorage`, retry, visible sync status.
- **FR-ATT-6** On submit, objective questions are auto-graded
  (`lib/exam/grading.js`, unchanged); essay/short-answer left for
  lecturer marking.

### 3.6 Results

- **FR-RES-1** `results` rows are created on submit/grade; students see
  a result **only after `released_at` is set** by a lecturer/admin.
- **FR-RES-2** Result lookup page shows released results for the
  authenticated (`result_lookup` or any) student session.
- **FR-RES-3** Lecturer results dashboard, per-exam results, and
  spreadsheet export (`xlsx`) are unchanged.

### 3.7 Proctoring & Anti-Cheating — **deferred to v2**

Not in scope for this migration. During the port:

- **FR-PROCTOR-0** `components/student/ProctoringCamera.js` and its
  Supabase Storage upload are **removed**. The exam's
  `proctoring_enabled` column is retained in the schema (unused, default
  `false`) so v2 can light it up without a migration.
- No fullscreen enforcement, clipboard/context-menu blocking, or
  tab-blur logging is ported. In-hall integrity for v1 is the
  air-gapped LAN + access code (FR-EXAM-6/7) + IP allowlist (§3.4a).
- v2 scope (separate design): camera snapshots to local disk, an
  `attempt_events` table for blur/visibility/fullscreen-exit,
  lecturer-side review + flag-for-review.

### 3.8 Auditing

- **FR-AUDIT-1** `admin_action_log` and login/logout activity logging
  (per the two 2026-08-11 designs) are preserved, written through the
  repository layer.

### 3.9 Data Export / Backup (operator-facing)

- **FR-EXPORT-1** An operator can produce a full DB backup
  (`.bak`) via a provided script (Task Scheduler nightly + on-demand).
- **FR-EXPORT-2** Per-exam results export to `.xlsx` from the lecturer
  UI (existing) works offline.

---

## 4. Data Model — Postgres → SQL Server translation

Prisma schema at `prisma/schema.prisma`, `provider = "sqlserver"`.
One migration history under `prisma/migrations`.

### 4.1 Type mapping rules

| Postgres | SQL Server (Prisma) | Notes |
|---|---|---|
| `UUID` PK `DEFAULT uuid_generate_v4()` | `String @id @default(uuid()) @db.NVarChar(36)` | App-generated. Keeps existing string IDs across the codebase. Add a **clustered index on `created_at`** for tables with heavy inserts (`responses`, `attempt_events`, logs) so the random-GUID PK stays non-clustered. |
| `ENUM` types | `String` + `CHECK` constraint (added in a follow-up raw-SQL migration) + Zod validation | Prisma has no SQL Server enum. Allowed values centralised in `lib/db/enums.js`. |
| `TIMESTAMPTZ` | `DateTime @db.DateTime2` | **Store UTC**, convert at the edge. Document the convention. |
| `JSONB` | `String @db.NVarChar(Max)` | Repo layer does `JSON.parse` / `JSON.stringify`. No server-side JSON filtering (already filtered in app). |
| `TEXT[]` (`tags`, `tips`) | `String @db.NVarChar(Max)` holding a JSON array | Helper `toJsonArray` / `fromJsonArray` in repo. |
| `BOOLEAN` | `Boolean` (`BIT`) | — |
| `TEXT` | `String @db.NVarChar(Max)` or sized `NVarChar` for short fields | Size `email`, `matric_number`, codes, names. |
| Partial unique idx `WHERE x IS NOT NULL` | **Filtered unique index** via raw SQL migration | SQL Server supports `CREATE UNIQUE INDEX ... WHERE ...`. |
| `auth.users` FK on `users.id` | **Dropped** | `users` is now standalone; add `password_hash NVARCHAR(MAX) NULL`, `must_change_password BIT NOT NULL DEFAULT 0`. |
| `handle_new_user()` trigger | **Dropped** | App inserts `users` rows explicitly. |
| RLS policies + helper functions | **Dropped** | Re-implemented in `lib/db/repositories`. |
| `NOW()` defaults | `@default(now())` | — |
| `ON DELETE CASCADE` / `RESTRICT` / `SET NULL` | Same via Prisma relations + `onDelete`. **Watch SQL Server multiple-cascade-path errors** — some cascades become `NoAction` + explicit app-side cleanup (documented per table in the plan). |

### 4.2 New / changed tables

- **`sessions`** — `id` (hashed token) PK, `user_id` FK, `channel`
  (`password` | `exam_access` | `result_lookup`), `verified_exam_id`
  NULL FK, `client_ip` NVARCHAR(45) NULL (recorded at mint,
  FR-AUTH-6), `created_at`, `last_seen_at`, `expires_at`. Index on
  `user_id`, on `expires_at` (cleanup sweep).
- **`users`** — add `password_hash`, `must_change_password`. `date_of_birth`
  already referenced by student result lookup — ensure column exists
  (`DATE NULL`).
- **`verification_attempts`** — unchanged shape (`matric_number`, `ip`,
  `created_at`).
- **`exams`** — add `access_code_revoked_at` DATETIME2 NULL (FR-EXAM-7),
  `enforce_ip_allowlist` BIT NOT NULL DEFAULT 1 (FR-LAB-3). **Drop**
  `exam_mode` and its CHECK (lab-only, FR-EXAM-2); `proctoring_enabled`
  stays (unused, default 0, for v2). One code column: keep `access_code`,
  drop `lab_code` if the live schema still has it as a separate column.
  Uniqueness on `access_code` becomes a **filtered unique index**
  `WHERE access_code IS NOT NULL AND access_code_revoked_at IS NULL`
  (FR-EXAM-9).
- **`lab_ip_allowlist`** — new (`id` PK, `entry` NVARCHAR(64) NOT NULL —
  a single IPv4 or CIDR, `label` NVARCHAR(120) NULL, `is_active` BIT
  NOT NULL DEFAULT 1, `created_by` FK, `created_at`). Institution-wide
  (carries `university_id` for consistency with the single-tenant
  convention).
- Everything else: 1:1 port of the current schema (faculties,
  departments, courses, question_bank, exams, exam_questions,
  exam_access, attempts, responses, results, admin_action_log).

### 4.3 Seed (`prisma/seed.js`)

Creates: the one `universities` row, one `super_admin` account
(credentials from env, `must_change_password=1`), and — for dev only —
sample faculty/department/course + a demo lecturer/student.

---

## 5. Non-Functional Requirements

### 5.1 Performance & Concurrency (the 150–200 budget)

- **NFR-PERF-1** The system must sustain **200 concurrent active
  attempts** on a single exam with:
  - answer autosave p95 latency **< 400 ms**,
  - page navigation (next/prev question) p95 **< 600 ms**,
  - exam start p95 **< 1.5 s**,
  - zero lost saved answers under sustained load.
- **NFR-PERF-2** **Workload math** (why this is comfortable): 200
  students × 1 autosave / 15 s ≈ **13 writes/s** steady state; each is
  a single-row upsert. Question navigation adds a few reads/s. The only
  burst is **submit at time-up** — up to 200 submits within ~1 min ≈
  3–4 grade+write transactions/s. This is a light OLTP load; the risk
  is misconfiguration, not raw volume.
- **NFR-PERF-3** **Prisma pool**: `connection_limit` = 20,
  `pool_timeout` = 20 s. Single `PrismaClient` singleton (guard against
  Next dev hot-reload duplication).
- **NFR-PERF-4** **DB indexes**: port all current indexes; add
  `responses (attempt_id, question_id)` unique (already),
  `sessions (expires_at)`, `sessions (user_id)`, and the filtered unique
  index on `exams.access_code` (FR-EXAM-9).
- **NFR-PERF-5** `submitExam` grades in a **single transaction**;
  autosave upserts are **not** wrapped in long transactions.
- **NFR-PERF-6** A **load test** (k6 or Artillery script in
  `tests/load/`) simulating 200 virtual students (start → 40 answers
  over 45 min compressed → submit) is the **acceptance gate** for the
  migration. Must pass on the actual server hardware.
- **NFR-PERF-7** Client autosave debounce **15 s** (FR-ATT-2) — a
  deliberate deviation from the "save the exact second they click"
  blueprint suggestion, to keep write rate flat and Express-safe.

### 5.2 SQL Server edition & sizing

- **NFR-DB-1** **Preferred: SQL Server 2022 Standard** if the
  university holds a licence (no buffer-pool cap, uses all cores).
- **NFR-DB-2** **Acceptable fallback: SQL Server 2022 Express** —
  limits: 1 GB buffer pool, lesser of 4 cores / 1 socket, 10 GB per
  DB. Adequate for this workload **because** the working set (one
  exam's questions + active attempts) is a few MB and writes are
  small. NFR-PERF-6 load test **must** be run on Express if Express is
  what ships.
- **NFR-DB-3** **Do not use Developer edition in production** — it is
  licensed for dev/test only.
- **NFR-DB-4** Recovery model **SIMPLE** (no log shipping needed;
  nightly full backup is the recovery story).
- **NFR-DB-5** DB collation: `Latin1_General_100_CI_AI` (case- &
  accent-insensitive) so matric-number / email matching behaves like
  today's Postgres `citext`-ish usage. Confirm before first migration —
  collation is painful to change later.

### 5.3 Server hardware & OS

- **NFR-HW-1** Server PC: **≥ 16 GB RAM, quad-core, SSD**, Windows 10/11
  Pro or Windows Server 2019+.
- **NFR-HW-2** Cap SQL Server **max server memory** at ~50–60% of RAM
  (e.g. 8 GB on a 16 GB box) so Node + OS are not starved.
- **NFR-HW-3** Server PC on a **UPS** — mid-exam power loss on the
  server is the one unrecoverable failure (clients crashing is
  recoverable per FR-ATT-3).

### 5.4 Security

- **NFR-SEC-1** Network is **air-gapped** (router WAN port unplugged).
  Documented in the runbook as a hard requirement.
- **NFR-SEC-2** SQL Server **TCP 1433 bound to loopback only** — the
  Next.js app is on the same box, so 1433 does **not** need to be open
  on the LAN firewall. Only **3000** (or 443) is opened, to **Private**
  profile only.
- **NFR-SEC-3** SQL Server **Mixed Mode**; the `sa` account gets a
  strong password and is then **disabled**; the app connects as a
  dedicated least-privilege login (`pcu-cbt_app`) with `db_datareader` +
  `db_datawriter` + EXECUTE on the DB only.
- **NFR-SEC-4** **HTTPS on the LAN is optional for v1** (proctoring —
  the main driver — is deferred). Plain HTTP on `192.168.x.x:3000` is
  acceptable: the session cookie stays HttpOnly + SameSite=Lax and
  drops only the `Secure` flag, which on an air-gapped LAN with no
  route off-network is a low residual risk. If HTTPS is wanted anyway,
  run **Caddy** (internal CA) or an `mkcert` cert terminating TLS on
  443 → Node 3000, and set `TRUST_PROXY=1` (NFR-SEC-9).
- **NFR-SEC-5** DB credentials and the session-signing secret live in
  `.env.production` on the server, **not** in git. `.env.local.example`
  is restored with SQL Server placeholders (closes a TODO).
- **NFR-SEC-6** Argon2id params: memory 19 MiB, iterations 2,
  parallelism 1 (OWASP minimum) — staff-login only, low volume.
- **NFR-SEC-7** Session tokens: 32 bytes from `crypto.randomBytes`,
  base64url, stored **hashed (SHA-256)** in `sessions` so a DB read
  doesn't leak live sessions.
- **NFR-SEC-8** No telemetry / external calls at runtime
  (`NEXT_TELEMETRY_DISABLED=1`, Prisma `checksum`/engine download only
  at build).
- **NFR-SEC-9** **Client-IP trust model** (drives FR-LAB-5): a single
  env flag `TRUST_PROXY`. `TRUST_PROXY=0` (default, plain-HTTP
  deployment) → client IP = direct socket address, `X-Forwarded-For` is
  **ignored entirely**. `TRUST_PROXY=1` (a local reverse proxy is in
  front) → client IP = the rightmost `X-Forwarded-For` entry, which the
  trusted proxy sets. Getting this wrong either breaks the allowlist
  (all IPs look like `127.0.0.1`) or lets a client forge its IP — so it
  is called out in the install runbook with a verification step.
- **NFR-SEC-10** **Lab PCs must have stable IPs** — static assignment
  or DHCP reservations by MAC. An allowlist over a churning DHCP pool is
  meaningless. The runbook includes recording each lab PC's IP/MAC and
  entering the range (or per-host IPs) into `lab_ip_allowlist`.

### 5.5 Reliability & Operations

- **NFR-OPS-1** Next.js runs as a **Windows Service** (via
  `node-windows` or NSSM wrapping `npm run start`) with auto-restart and
  start-on-boot.
- **NFR-OPS-2** SQL Server service set to **Automatic** startup.
- **NFR-OPS-3** **Nightly full backup** via `sqlcmd`/`BACKUP DATABASE`
  in Task Scheduler → local `D:\backups`, plus a one-command on-demand
  backup script. Weekly copy to external USB documented.
- **NFR-OPS-4** **Session cleanup**: a lightweight sweep (on startup +
  every 6 h) deletes expired `sessions` and `verification_attempts`
  older than 24 h.
- **NFR-OPS-5** App logs to a rotating file (`./logs`) — no external
  log service.
- **NFR-OPS-6** A **pre-exam checklist script** verifies: DB
  reachable, disk space > 5 GB, backup ran, service healthy, clock
  synced across machines (for timers).
- **NFR-OPS-7 (RPO/RTO)**: RPO ≤ 24 h for historical data (nightly
  backup); **RPO ≈ 0 for an in-progress exam** because answers are
  committed within 15 s (FR-ATT-2). RTO ≤ 30 min (restore `.bak` on
  same or spare PC).

### 5.6 Portability / Install

- **NFR-INSTALL-1** A single documented install runbook + scripts
  (`ops/` folder) reproduces a working server from a bare Windows box.
- **NFR-INSTALL-2** No internet required on the **server** at runtime.
  Build artefacts (`.next`, `node_modules`, Prisma engines) are
  produced on a build machine and copied, **or** the server does a
  one-time online `npm ci && npm run build` before going air-gapped.
- **NFR-INSTALL-3** Node.js **LTS 20.x** pinned via `.nvmrc` /
  `engines`.

### 5.7 Testing

- **NFR-TEST-1** Every translated RLS policy has a repository unit test
  asserting both the allow and deny paths (Vitest).
- **NFR-TEST-2** Existing Vitest suites (`lib/validations/*`,
  `lib/dal`, `lib/actions/*`, `lib/exam/*`) stay green; Supabase mocks
  are replaced with a test Prisma client against a disposable local DB
  (SQL Server in Docker for CI, or SQLite-shaped… — **use real SQL
  Server via `mssql` Docker image** to avoid dialect drift).
- **NFR-TEST-3** The NFR-PERF-6 load test is part of the definition of
  done.
- **NFR-TEST-4** A documented **manual UAT script** for exam day
  (start, autosave, kill client, resume elsewhere, submit, release,
  lookup) — **plus**: attempt entry from a non-allowlisted IP is
  refused; access-code revoke blocks new entry but not an in-progress
  attempt.
- **NFR-TEST-5** Unit tests for `lib/security/clientIp.js`: IPv4 exact
  match, CIDR match/non-match, `TRUST_PROXY=0` ignores `X-Forwarded-For`,
  `TRUST_PROXY=1` reads the rightmost hop, empty allowlist + enforce =
  deny. Repo tests for access-code resolution ignoring revoked codes.

---

## 6. Migration Plan (incremental slices)

Each slice ends with tests green and the app runnable.

1. **Slice 0 — Infra skeleton.** Add Prisma, `prisma/schema.prisma`
   (full translated schema), first migration, `lib/db/client.js`,
   `lib/db/enums.js`, seed. SQL Server in Docker for local dev. No app
   code changed yet.
2. **Slice 1 — Auth core.** `lib/auth/*`, `sessions` table wiring,
   rewrite `lib/dal.js`, `middleware.js`, `lib/actions/auth.js`. Staff
   login/logout works end-to-end. Delete `lib/supabase/{server,client,
   middleware,admin}.js` usage for auth.
3. **Slice 2 — Student credential-less auth + lab IP gate.**
   `lib/actions/studentAuth.js`, replace `mintStudentSession`, rate
   limiting via repo. `lib/security/clientIp.js` + `lab_ip_allowlist`
   repo + `TRUST_PROXY` handling. Exam entry (with IP check) + result
   lookup work.
4. **Slice 3 — Admin & structure.** `lib/actions/admin.js`,
   institution settings, faculties/departments/courses/users repos +
   pages, **lab IP allowlist admin page**. Drop subdomain routing and
   `/[slug]/*` pages.
5. **Slice 4 — Question bank.** `lib/actions/questions.js` + pages.
   Strip `ProctoringCamera` and any client anti-cheat code here or in
   Slice 6 (whichever touches the exam UI first).
6. **Slice 5 — Exams.** `lib/actions/exams.js` + lecturer exam pages,
   exam_access, bulk import, **access-code generate/revoke UI +
   `enforce_ip_allowlist` toggle** (FR-EXAM-6..9). Remove `exam_mode` /
   "Delivery Mode" UI and validation; every exam is lab-only.
7. **Slice 6 — Attempts & results.** `lib/actions/attempts.js`,
   grading, autosave debounce change, per-action IP re-check (FR-ATT-4),
   `/lab/*` flow, results pages, xlsx export. Remove `ProctoringCamera`
   mount and lockdown handlers from the exam interface.
8. **Slice 7 — Ops & hardening.** Windows service, optional HTTPS proxy,
   backup scripts, session-cleanup sweep, pre-exam checklist (incl. lab
   IP/MAC capture), `.env.local.example`, load test, remove all
   remaining `@supabase/*` deps and `lib/supabase/`.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| RLS→code translation misses a policy → data leak | NFR-TEST-1: allow+deny test per policy; slice-by-slice review; keep the old `schema.sql` as the reference checklist. |
| SQL Server multiple-cascade-path migration errors | Identify during Slice 0; convert offending cascades to `NoAction` + explicit repo cleanup, documented per table. |
| Express 1 GB / 4-core cap insufficient under real load | NFR-PERF-6 load test on real hardware is a hard gate; escalate to Standard licence if it fails. |
| Lab PC IPs change (DHCP churn) → students locked out mid-exam | NFR-SEC-10 static IPs / DHCP reservations; allowlist supports CIDR so a whole lab subnet can be entered once; pre-exam checklist verifies a sample lab PC can reach entry. |
| `TRUST_PROXY` misconfigured → allowlist bypassable or everyone blocked | NFR-SEC-9 single explicit flag + runbook verification step (curl from a lab PC and a non-lab PC, confirm allow/deny). |
| Student brings own laptop onto the LAN with an IP inside an allowed CIDR | Residual, accepted for v1. Mitigations: prefer per-host IPs over broad CIDR where feasible; invigilator physically controls the hall; access code is hand-distributed and revocable; v2 proctoring. |
| Access code leaks to a student who is off-site | IP allowlist blocks entry from any non-lab machine; lecturer can revoke + reissue instantly (FR-EXAM-7); every blocked attempt is logged (FR-LAB-6). |
| Server power loss mid-exam | NFR-HW-3 UPS; FR-ATT-2 15 s commit keeps loss ≤ 15 s. |
| Clock skew between machines breaks timers | NFR-OPS-6 checklist verifies sync; timers are server-authoritative (FR-ATT-4) so client skew is cosmetic. |
| GUID PK index fragmentation over years of use | Clustered index on `created_at` for hot tables; annual reindex in maintenance script. |
| Air-gapped build can't fetch Prisma engines | NFR-INSTALL-2: build on connected machine or one-time online build before air-gapping. |

---

## 8. Open Questions

1. Does the institution hold a **SQL Server Standard** licence, or must
   we target Express? (Affects NFR-PERF-6 pass criteria.)
2. How many lab PCs / expected peak — is 200 the ceiling or a typical
   sitting?
3. Confirm **`super_admin` → single admin** collapse is acceptable
   (roles retained in code, just no cross-tenant duties).
4. **Lab network addressing**: will lab PCs get static IPs or DHCP
   reservations, and is the lab on one dedicated subnet we can allowlist
   as a single CIDR, or mixed with other traffic (needing per-host
   entries)?
5. Should the **access code auto-rotate** (e.g. new code each time an
   exam goes `live`), or is it purely manual generate/revoke by the
   lecturer? (Design currently assumes manual.)
6. Plain HTTP for v1 confirmed acceptable (no proctoring driver), or is
   HTTPS still wanted for defence-in-depth?
