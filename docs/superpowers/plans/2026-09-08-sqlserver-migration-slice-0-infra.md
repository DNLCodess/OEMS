# SQL Server Migration — Slice 0: Infra Skeleton (Prisma + Schema + Seed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Prisma against the local SQL Server container with the full translated database schema, verified by round-trip tests, plus an idempotent seed — with **zero application code changed**.

**Architecture:** Prisma is added as the data layer. `prisma/schema.prisma` is the single source of truth for the database; `npx prisma migrate` turns it into versioned SQL migration files under `prisma/migrations/`. A singleton `PrismaClient` lives at `lib/db/client.js`. Enum-like values (no native enums on SQL Server) live as plain constants in `lib/db/enums.js` and are enforced by `CHECK` constraints added in a hand-written follow-up migration. Nothing imports `lib/db` yet — Slice 1 onward does that.

**Tech Stack:** Prisma 6 (`prisma`, `@prisma/client`), SQL Server 2022 (Docker, local dev), Vitest (tests run against the real container), Node.js (dev machine; server pins LTS 20.x per spec).

**Spec:** `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md` — read §2 (module boundaries), §4 (data-model translation), §4.3 (seed), §5.7 (testing).

## Global Constraints

- **DB access layer:** Prisma (SQL Server provider) + a thin repository layer at `lib/db`. (spec §Decisions)
- **Tenancy:** logical single-tenant — schema keeps `university_id` FKs; exactly one `universities` row exists, created by the seed; no university create/delete UI. (spec FR-INST-1)
- **Delivery mode:** lab-only. No `exam_mode` column, no `remote` value. (spec FR-EXAM-2)
- **Proctoring:** deferred to v2 — `proctoring_snapshots` table is **not** ported; `exams.proctoring_enabled` column is retained but unused (default `0`). (spec §3.7, §4.2)
- **IDs:** every PK is `String` (app-generated UUID) stored as `NVarChar(36)`. (spec §4.1)
- **Timestamps:** `DateTime @db.DateTime2`, stored **UTC**. (spec §4.1)
- **JSON columns:** `String @db.NVarChar(Max)` holding `JSON.stringify` output; parsed in the repo layer (Slice 4+), not here. (spec §4.1, FR-QB-3)
- **Field naming:** Prisma model field names are kept **identical to the snake_case DB column names** (e.g. `university_id`, `full_name`, `created_at`) — deliberately non-idiomatic, to match the 50 existing call sites and avoid a rename churn. Only table names are mapped (`@@map("users")`), model names are singular PascalCase.
- **Connection string (local dev):** `sqlserver://localhost:1433;database=pcu_cbt;user=sa;password=Pcu_Cbt_2024;encrypt=true;trustServerCertificate=true` — lives in `.env` (already git-ignored).
- **Prisma pool (later use):** `connection_limit=20`, `pool_timeout=20`. Not exercised in Slice 0 but set on the client now. (spec NFR-PERF-3)
- **Commit cadence:** commit after every task. Commit messages end with the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer.
- **Tests:** `npx vitest run` must stay green (currently 235 passing). New DB tests run against the live container.

---

## Prisma in five minutes (read before Task 1)

You have never used Prisma. Here is the whole mental model:

| Thing | What it is |
|---|---|
| `prisma/schema.prisma` | A text file describing your database — every table (`model`), column (`field`), and relationship. **You edit this by hand.** It is the source of truth. |
| `npx prisma migrate dev --name x` | Looks at `schema.prisma`, compares it to the database, writes a new folder `prisma/migrations/<timestamp>_x/migration.sql` containing the `CREATE TABLE …` SQL, and runs it against your dev database. Migrations are committed to git and replayed in order on any other machine. |
| `npx prisma migrate dev --create-only` | Same, but writes the `migration.sql` **without running it** — so you can hand-edit it first (needed for things Prisma's schema language can't express, like filtered indexes and `CHECK` constraints). |
| `npx prisma generate` | Reads `schema.prisma` and generates a typed JavaScript client into `node_modules/@prisma/client`. `migrate dev` runs this for you automatically. |
| `PrismaClient` | The object you import to talk to the DB: `prisma.user.findMany(...)`, `prisma.exam.create(...)`. One instance per process (a "singleton") — creating many leaks connections. |
| `npx prisma studio` | A local web GUI to browse/edit rows. Handy for eyeballing what the seed created. |
| `npx prisma db seed` | Runs the script named in `package.json` → `"prisma": { "seed": "..." }`. Used to insert baseline rows. |

**The loop you will repeat:** edit `schema.prisma` → `npx prisma migrate dev --name something` → write a test that creates+reads a row → run it.

**Why no native enums:** SQL Server + Prisma doesn't support `enum`. So `role` is just a `String`, the allowed values live in `lib/db/enums.js`, and a `CHECK (role IN ('super_admin', …))` constraint (Task 6) stops bad data at the DB.

**Why `onDelete: NoAction` almost everywhere:** SQL Server rejects a schema where two foreign-key paths could both cascade-delete into the same table ("multiple cascade paths"). The safe default is `NoAction` (the DB refuses to delete a parent that still has children) and we delete children explicitly in app code. We only use `Cascade` down the ownership chain (university → faculty → department → course, exam → exam_questions, attempt → responses, user → sessions).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `.env` | `DATABASE_URL` for Prisma CLI **and** Next.js (already git-ignored) | 1 |
| `package.json` | add `prisma` + `@prisma/client`; add `db:*` scripts; add `prisma.seed` | 1, 9 |
| `prisma/schema.prisma` | full DB schema — all 17 models | 3 |
| `prisma/migrations/**` | generated + hand-edited SQL migrations (committed) | 4, 6 |
| `prisma/seed.js` | insert the one university + bootstrap super-admin + dev sample data | 9 |
| `lib/db/client.js` | singleton `PrismaClient` with pool config + hot-reload guard | 2 |
| `lib/db/client.test.js` | connectivity smoke test (`SELECT 1`) | 2 |
| `lib/db/enums.js` | allowed values for every enum-like column, as frozen constants | 5 |
| `lib/db/enums.test.js` | sanity assertions on the constants | 5 |
| `lib/db/schema.structure.test.js` | round-trip tests: university/faculty/department/course + cascade | 7 |
| `lib/db/schema.users.test.js` | round-trip tests: user/session/verification_attempt + constraints | 7 |
| `lib/db/schema.exams.test.js` | round-trip tests: question_bank/exam/exam_questions/exam_access | 8 |
| `lib/db/schema.attempts.test.js` | round-trip tests: attempt/response/result + admin_action_log + lab_ip_allowlist | 8 |
| `tests/helpers/db.js` | shared test `PrismaClient` + `resetDb()` (delete all rows FK-safe) | 7 |
| `prisma/seed.test.js` | seed runs, is re-runnable, produces exactly one university | 9 |

---

## Task 1: Install Prisma, wire the connection

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Create: `.env`
- Modify: `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: an `.env` file with `DATABASE_URL`; npm scripts `db:migrate`, `db:studio`, `db:reset`, `db:seed`; `prisma/schema.prisma` scaffold (replaced wholesale in Task 3).

- [ ] **Step 1: Confirm the database container is up**

Run: `docker ps --filter name=pcucbt-sql --format "{{.Names}} {{.Status}}"`
Expected: `pcucbt-sql Up ...`. If not: `docker start pcucbt-sql`.

- [ ] **Step 2: Install Prisma packages**

Run:
```bash
npm install --save-dev prisma@^6
npm install @prisma/client@^6
```
Expected: both install, `package.json` shows `prisma` under `devDependencies` and `@prisma/client` under `dependencies`.

- [ ] **Step 3: Scaffold Prisma**

Run: `npx prisma init --datasource-provider sqlserver`
Expected: creates `prisma/schema.prisma` and appends a `DATABASE_URL` line to a `.env` file. Ignore the printed "next steps" — we do our own.

- [ ] **Step 4: Set the real `DATABASE_URL`**

Overwrite `.env` so it contains exactly:
```
DATABASE_URL="sqlserver://localhost:1433;database=pcu_cbt;user=sa;password=Pcu_Cbt_2024;encrypt=true;trustServerCertificate=true"
```
(`.env` is already listed in `.gitignore` — confirm with `git check-ignore .env`, which should print `.env`.)

- [ ] **Step 5: Replace the scaffolded schema with our datasource/generator block only**

Overwrite `prisma/schema.prisma` with:
```prisma
// PCU CBT database schema — source of truth for SQL Server.
// Field names deliberately match snake_case DB columns (see plan Global Constraints).

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlserver"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 6: Verify Prisma can reach the database**

Run: `npx prisma db execute --stdin <<< "SELECT 1"`
Expected: exits 0 with no error. (This proves the connection string works. A login error here means the container password or DB name is wrong.)

- [ ] **Step 7: Add npm scripts**

In `package.json` `"scripts"`, add:
```json
"db:migrate": "prisma migrate dev",
"db:studio": "prisma studio",
"db:reset": "prisma migrate reset --force",
"db:seed": "prisma db seed",
"db:generate": "prisma generate"
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma
git commit -m "chore(db): add Prisma, wire SQL Server connection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(`.env` is intentionally not committed.)

---

## Task 2: `PrismaClient` singleton + connectivity test

**Files:**
- Create: `lib/db/client.js`
- Create: `lib/db/client.test.js`

**Interfaces:**
- Produces: `import { prisma } from '@/lib/db/client'` — a shared `PrismaClient`. Every repository (Slice 1+) imports this and nothing else for DB access.

- [ ] **Step 1: Write the failing test**

Create `lib/db/client.test.js`:
```js
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'

describe('lib/db/client', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('exposes a singleton PrismaClient', async () => {
    const { prisma: again } = await import('@/lib/db/client')
    expect(again).toBe(prisma)
  })

  it('can execute a trivial query against SQL Server', async () => {
    const rows = await prisma.$queryRawUnsafe('SELECT 1 AS one')
    expect(rows).toEqual([{ one: 1 }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/db/client.test.js`
Expected: FAIL — `Cannot find module '@/lib/db/client'`.

- [ ] **Step 3: Generate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". (No models yet — that's fine, `$queryRawUnsafe` still works.)

- [ ] **Step 4: Write `lib/db/client.js`**

```js
import { PrismaClient } from '@prisma/client'

// A single PrismaClient per process. In dev, Next.js / Vitest re-evaluate
// modules on hot reload; without this guard each reload leaks a new pool
// until SQL Server refuses connections.
const globalForPrisma = globalThis

export const prisma =
  globalForPrisma.__pcuPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pcuPrisma = prisma
}
```

> Prisma reads `connection_limit` / `pool_timeout` from the `DATABASE_URL` query string, not from code. Add them when the app actually serves load (Slice 6 / deployment). For Slice 0 the defaults are fine.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/db/client.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Full suite still green**

Run: `npx vitest run`
Expected: all pass (was 235, now 237).

- [ ] **Step 7: Commit**

```bash
git add lib/db/client.js lib/db/client.test.js
git commit -m "feat(db): add PrismaClient singleton + connectivity test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Write the full `prisma/schema.prisma`

**Files:**
- Modify: `prisma/schema.prisma` (append all 17 models)

**Interfaces:**
- Produces: the complete model set. Model names (for the client API): `University`, `Faculty`, `Department`, `Course`, `User`, `Session`, `VerificationAttempt`, `QuestionBank`, `Exam`, `ExamQuestion`, `ExamAccess`, `Attempt`, `Response`, `Result`, `Result`, `AdminActionLog`, `LabIpAllowlist`. Client accessors are camelCase: `prisma.university`, `prisma.questionBank`, `prisma.labIpAllowlist`, etc.

- [ ] **Step 1: Append the structure + user models**

Add to `prisma/schema.prisma`:
```prisma
model University {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  name          String   @db.NVarChar(200)
  subdomain     String   @unique @db.NVarChar(63)
  logo_url      String?  @db.NVarChar(500)
  primary_color String?  @db.NVarChar(32)
  created_at    DateTime @default(now()) @db.DateTime2

  faculties         Faculty[]
  departments       Department[]
  courses           Course[]
  users             User[]
  question_bank     QuestionBank[]
  exams             Exam[]
  admin_action_log  AdminActionLog[]
  lab_ip_allowlist  LabIpAllowlist[]

  @@map("universities")
}

model Faculty {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  university_id String   @db.NVarChar(36)
  name          String   @db.NVarChar(200)
  created_at    DateTime @default(now()) @db.DateTime2

  university  University   @relation(fields: [university_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  departments Department[]
  users       User[]

  @@unique([university_id, name])
  @@index([university_id])
  @@map("faculties")
}

model Department {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  university_id String   @db.NVarChar(36)
  faculty_id    String   @db.NVarChar(36)
  name          String   @db.NVarChar(200)
  created_at    DateTime @default(now()) @db.DateTime2

  // university_id is NoAction to avoid a SQL Server "multiple cascade paths"
  // diamond (university -> faculty -> department AND university -> department).
  // Cascade flows via the faculty chain; deleting a university is not a
  // supported operation anyway (FR-INST-1).
  university University @relation(fields: [university_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  faculty    Faculty    @relation(fields: [faculty_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  courses    Course[]
  users      User[]

  @@unique([faculty_id, name])
  @@index([faculty_id])
  @@map("departments")
}

model Course {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  university_id String   @db.NVarChar(36)
  department_id String   @db.NVarChar(36)
  course_code   String   @db.NVarChar(20)
  course_title  String   @db.NVarChar(200)
  credit_units  Int      @default(2)
  level         String   @db.NVarChar(10)
  semester      String   @db.NVarChar(10)
  created_at    DateTime @default(now()) @db.DateTime2

  // university_id NoAction — same diamond reason as Department.
  university    University      @relation(fields: [university_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  department    Department       @relation(fields: [department_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  question_bank QuestionBank[]
  exams         Exam[]

  @@unique([university_id, course_code])
  @@index([department_id])
  @@index([university_id])
  @@map("courses")
}

model User {
  id                   String    @id @default(uuid()) @db.NVarChar(36)
  university_id        String?   @db.NVarChar(36)
  role                 String    @db.NVarChar(20)
  email                String    @db.NVarChar(255)
  full_name            String    @db.NVarChar(200)
  matric_number        String?   @db.NVarChar(50)
  level                String?   @db.NVarChar(10)
  department_id        String?   @db.NVarChar(36)
  faculty_id           String?   @db.NVarChar(36)
  is_active            Boolean   @default(true)
  date_of_birth        DateTime? @db.Date
  removed_at           DateTime? @db.DateTime2
  password_hash        String?   @db.NVarChar(Max)
  must_change_password Boolean   @default(false)
  created_at           DateTime  @default(now()) @db.DateTime2

  university University? @relation(fields: [university_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  department Department? @relation(fields: [department_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  faculty    Faculty?    @relation(fields: [faculty_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  sessions           Session[]
  questions_created  QuestionBank[]   @relation("QuestionCreatedBy")
  exams_created      Exam[]           @relation("ExamCreatedBy")
  exam_access        ExamAccess[]
  attempts           Attempt[]
  results            Result[]
  actions_performed  AdminActionLog[] @relation("ActionActor")
  actions_targeting  AdminActionLog[] @relation("ActionTarget")
  lab_ip_entries     LabIpAllowlist[]

  @@index([university_id])
  @@index([role])
  @@map("users")
}

model Session {
  id               String    @id @db.NVarChar(64)   // SHA-256 hex of the opaque token
  user_id          String    @db.NVarChar(36)
  channel          String    @db.NVarChar(20)        // password | exam_access | result_lookup
  verified_exam_id String?   @db.NVarChar(36)
  client_ip        String?   @db.NVarChar(45)
  created_at       DateTime  @default(now()) @db.DateTime2
  last_seen_at     DateTime  @default(now()) @db.DateTime2
  expires_at       DateTime  @db.DateTime2

  user          User  @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  verified_exam Exam? @relation(fields: [verified_exam_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([user_id])
  @@index([expires_at])
  @@map("sessions")
}

model VerificationAttempt {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  matric_number String   @db.NVarChar(50)
  ip            String   @db.NVarChar(45)
  created_at    DateTime @default(now()) @db.DateTime2

  @@index([matric_number, ip, created_at])
  @@map("verification_attempts")
}
```

- [ ] **Step 2: Append the question-bank + exam models**

```prisma
model QuestionBank {
  id             String   @id @default(uuid()) @db.NVarChar(36)
  university_id  String   @db.NVarChar(36)
  created_by     String   @db.NVarChar(36)
  course_id      String   @db.NVarChar(36)
  type           String   @db.NVarChar(20)
  body           String   @db.NVarChar(Max)
  options        String?  @db.NVarChar(Max)   // JSON string
  correct_answer String?  @db.NVarChar(Max)   // JSON string
  explanation    String?  @db.NVarChar(Max)
  difficulty     String   @default("medium") @db.NVarChar(10)
  tags           String   @default("[]") @db.NVarChar(Max)   // JSON array string
  is_archived    Boolean  @default(false)
  created_at     DateTime @default(now()) @db.DateTime2

  university      University       @relation(fields: [university_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  creator         User             @relation("QuestionCreatedBy", fields: [created_by], references: [id], onDelete: NoAction, onUpdate: NoAction)
  course          Course           @relation(fields: [course_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  exam_questions  ExamQuestion[]
  responses       Response[]

  @@index([course_id])
  @@index([created_by])
  @@map("question_bank")
}

model Exam {
  id                     String    @id @default(uuid()) @db.NVarChar(36)
  university_id          String    @db.NVarChar(36)
  created_by             String    @db.NVarChar(36)
  course_id              String    @db.NVarChar(36)
  title                  String    @db.NVarChar(300)
  instructions           String?   @db.NVarChar(Max)
  duration_minutes       Int
  start_at               DateTime? @db.DateTime2   // legacy, unused
  end_at                 DateTime? @db.DateTime2   // legacy, unused
  academic_session       String    @db.NVarChar(20)
  semester               String    @db.NVarChar(10)
  exam_type              String    @db.NVarChar(20)
  status                 String    @default("draft") @db.NVarChar(20)
  pass_mark              Int       @default(50)
  randomise_questions    Boolean   @default(false)
  randomise_options      Boolean   @default(false)
  access_code            String?   @db.NVarChar(12)
  access_code_mode       String    @default("auto") @db.NVarChar(10)   // auto | manual
  access_code_revoked_at DateTime? @db.DateTime2
  enforce_ip_allowlist   Boolean   @default(true)
  proctoring_enabled     Boolean   @default(false)   // retained, unused (v2)
  show_calculator        Boolean   @default(false)
  tips                   String    @default("[]") @db.NVarChar(Max)   // JSON array string
  go_live_at             DateTime? @db.DateTime2
  entry_window_minutes   Int       @default(10)
  created_at             DateTime  @default(now()) @db.DateTime2

  university      University      @relation(fields: [university_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  creator         User            @relation("ExamCreatedBy", fields: [created_by], references: [id], onDelete: NoAction, onUpdate: NoAction)
  course          Course          @relation(fields: [course_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  exam_questions  ExamQuestion[]
  exam_access     ExamAccess[]
  attempts        Attempt[]
  results         Result[]
  sessions        Session[]

  @@index([course_id])
  @@index([status])
  @@map("exams")
}

model ExamQuestion {
  id          String   @id @default(uuid()) @db.NVarChar(36)
  exam_id     String   @db.NVarChar(36)
  question_id String   @db.NVarChar(36)
  order_index Int      @default(0)
  marks       Int      @default(1)
  created_at  DateTime @default(now()) @db.DateTime2

  exam     Exam         @relation(fields: [exam_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  question QuestionBank @relation(fields: [question_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@unique([exam_id, question_id])
  @@index([exam_id])
  @@map("exam_questions")
}

model ExamAccess {
  id         String   @id @default(uuid()) @db.NVarChar(36)
  exam_id    String   @db.NVarChar(36)
  user_id    String   @db.NVarChar(36)
  created_at DateTime @default(now()) @db.DateTime2

  exam Exam @relation(fields: [exam_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  user User @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([exam_id, user_id])
  @@map("exam_access")
}
```

- [ ] **Step 3: Append the attempt + result + log models**

```prisma
model Attempt {
  id           String    @id @default(uuid()) @db.NVarChar(36)
  exam_id      String    @db.NVarChar(36)
  student_id   String    @db.NVarChar(36)
  started_at   DateTime  @default(now()) @db.DateTime2
  submitted_at DateTime? @db.DateTime2
  status       String    @default("in_progress") @db.NVarChar(20)
  total_score  Int?
  created_at   DateTime  @default(now()) @db.DateTime2

  exam      Exam       @relation(fields: [exam_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  student   User       @relation(fields: [student_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  responses Response[]
  result    Result?

  @@unique([exam_id, student_id])
  @@index([exam_id])
  @@index([student_id])
  @@map("attempts")
}

model Response {
  id               String   @id @default(uuid()) @db.NVarChar(36)
  attempt_id       String   @db.NVarChar(36)
  question_id      String   @db.NVarChar(36)
  student_answer   String?  @db.NVarChar(Max)   // JSON string
  is_correct       Boolean?
  marks_awarded    Int      @default(0)
  teacher_feedback String?  @db.NVarChar(Max)
  created_at       DateTime @default(now()) @db.DateTime2

  attempt  Attempt      @relation(fields: [attempt_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  question QuestionBank @relation(fields: [question_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@unique([attempt_id, question_id])
  @@index([attempt_id])
  @@map("responses")
}

model Result {
  id          String    @id @default(uuid()) @db.NVarChar(36)
  attempt_id  String    @unique @db.NVarChar(36)
  student_id  String    @db.NVarChar(36)
  exam_id     String    @db.NVarChar(36)
  final_score Int
  passed      Boolean
  released_at DateTime? @db.DateTime2
  created_at  DateTime  @default(now()) @db.DateTime2

  attempt Attempt @relation(fields: [attempt_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  student User    @relation(fields: [student_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  exam    Exam    @relation(fields: [exam_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([student_id])
  @@index([exam_id])
  @@index([released_at])
  @@map("results")
}

model AdminActionLog {
  id                String   @id @default(uuid()) @db.NVarChar(36)
  university_id     String?  @db.NVarChar(36)
  actor_id          String?  @db.NVarChar(36)
  action            String   @db.NVarChar(40)
  target_user_id    String?  @db.NVarChar(36)
  subject_role      String?  @db.NVarChar(20)
  target_identifier String?  @db.NVarChar(255)
  meta              String?  @db.NVarChar(Max)   // JSON string (e.g. blocked IP)
  created_at        DateTime @default(now()) @db.DateTime2

  university University? @relation(fields: [university_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  actor     User?       @relation("ActionActor", fields: [actor_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  target    User?       @relation("ActionTarget", fields: [target_user_id], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([university_id])
  @@index([created_at])
  @@map("admin_action_log")
}

model LabIpAllowlist {
  id            String   @id @default(uuid()) @db.NVarChar(36)
  university_id String   @db.NVarChar(36)
  entry         String   @db.NVarChar(64)    // single IPv4 or CIDR
  label         String?  @db.NVarChar(120)
  is_active     Boolean  @default(true)
  created_by    String   @db.NVarChar(36)
  created_at    DateTime @default(now()) @db.DateTime2

  university University @relation(fields: [university_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  creator    User      @relation(fields: [created_by], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([university_id])
  @@map("lab_ip_allowlist")
}
```

- [ ] **Step 4: Validate + format the schema**

Run: `npx prisma validate && npx prisma format`
Expected: "The schema at prisma/schema.prisma is valid" and the file is reformatted. If validation complains about a missing back-relation, add the named relation field it asks for and re-run.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): translate full Postgres schema to Prisma/SQL Server

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: First migration (create every table)

**Files:**
- Create: `prisma/migrations/<timestamp>_init/migration.sql` (generated)
- Create: `prisma/migrations/migration_lock.toml` (generated)

**Interfaces:**
- Produces: every table physically present in the `pcu_cbt` database.

- [ ] **Step 1: Generate and apply the migration**

Run: `npx prisma migrate dev --name init`
Expected: "Applied migration ... init" and "Generated Prisma Client".

If it fails with **"Introduced foreign keys ... would introduce a cycle or multiple cascade paths"**: the error names the table. In `schema.prisma`, change the offending relation's `onDelete` to `NoAction`, add a one-line comment saying why (mirroring the Department/Course comments), re-run `npx prisma format`, and run `npx prisma migrate dev --name init` again. Repeat until it applies. Then update this plan's schema listing so future readers see the final state.

- [ ] **Step 2: Verify the tables exist**

Run:
```bash
docker exec pcucbt-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P Pcu_Cbt_2024 -C -d pcu_cbt -Q "SELECT name FROM sys.tables ORDER BY name"
```
Expected: 17 rows plus `_prisma_migrations` — `admin_action_log, attempts, courses, departments, exam_access, exam_questions, exams, faculties, lab_ip_allowlist, question_bank, responses, results, sessions, universities, users, verification_attempts` (and `_prisma_migrations`).

- [ ] **Step 3: Full suite still green**

Run: `npx vitest run`
Expected: all pass (237).

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations
git commit -m "feat(db): initial migration — all tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `lib/db/enums.js` — allowed values

**Files:**
- Create: `lib/db/enums.js`
- Create: `lib/db/enums.test.js`

**Interfaces:**
- Produces: named exports, each a frozen array of strings, plus `ENUM_VALUES` (a map used by Task 6 to build `CHECK` constraints and by Slice 4+ Zod schemas):
  - `USER_ROLES`, `STUDENT_LEVELS`, `SEMESTERS`, `EXAM_TYPES`, `EXAM_STATUSES`, `QUESTION_TYPES`, `DIFFICULTIES`, `ATTEMPT_STATUSES`, `SESSION_CHANNELS`, `ACCESS_CODE_MODES`, `ADMIN_LOG_ACTIONS`
  - `ENUM_VALUES` — `{ 'users.role': USER_ROLES, ... }` mapping `"<table>.<column>"` → allowed values.

- [ ] **Step 1: Write the failing test**

Create `lib/db/enums.test.js`:
```js
import { describe, it, expect } from 'vitest'
import {
  USER_ROLES, STUDENT_LEVELS, EXAM_STATUSES, QUESTION_TYPES,
  SESSION_CHANNELS, ACCESS_CODE_MODES, ADMIN_LOG_ACTIONS, ENUM_VALUES,
} from '@/lib/db/enums'

describe('lib/db/enums', () => {
  it('lists the four user roles', () => {
    expect(USER_ROLES).toEqual(['super_admin', 'school_admin', 'lecturer', 'student'])
  })

  it('keeps PG in student levels', () => {
    expect(STUDENT_LEVELS).toContain('PG')
  })

  it('exam statuses match the state machine', () => {
    expect(EXAM_STATUSES).toEqual(['draft', 'scheduled', 'live', 'closed'])
  })

  it('has six question types', () => {
    expect(QUESTION_TYPES).toHaveLength(6)
  })

  it('session channels cover the three auth paths', () => {
    expect(SESSION_CHANNELS).toEqual(['password', 'exam_access', 'result_lookup'])
  })

  it('access code modes are auto/manual', () => {
    expect(ACCESS_CODE_MODES).toEqual(['auto', 'manual'])
  })

  it('admin log actions include the new IP-block action', () => {
    expect(ADMIN_LOG_ACTIONS).toContain('exam_entry_ip_blocked')
  })

  it('arrays are frozen', () => {
    expect(Object.isFrozen(USER_ROLES)).toBe(true)
  })

  it('ENUM_VALUES maps table.column keys', () => {
    expect(ENUM_VALUES['users.role']).toBe(USER_ROLES)
    expect(ENUM_VALUES['exams.status']).toBe(EXAM_STATUSES)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db/enums.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/db/enums.js`**

```js
// Enum-like column values. SQL Server + Prisma has no native enum, so these
// are plain constants: enforced at the DB by CHECK constraints (see the
// _enum_checks migration) and at the edge by Zod schemas (Slice 4+).

export const USER_ROLES        = Object.freeze(['super_admin', 'school_admin', 'lecturer', 'student'])
export const STUDENT_LEVELS    = Object.freeze(['100', '200', '300', '400', '500', 'PG'])
export const SEMESTERS         = Object.freeze(['first', 'second'])
export const EXAM_TYPES        = Object.freeze(['ca', 'mid_semester', 'end_of_semester'])
export const EXAM_STATUSES     = Object.freeze(['draft', 'scheduled', 'live', 'closed'])
export const QUESTION_TYPES    = Object.freeze(['mcq', 'multi_select', 'true_false', 'fill_blank', 'short_answer', 'essay'])
export const DIFFICULTIES      = Object.freeze(['easy', 'medium', 'hard'])
export const ATTEMPT_STATUSES  = Object.freeze(['in_progress', 'submitted', 'graded'])
export const SESSION_CHANNELS  = Object.freeze(['password', 'exam_access', 'result_lookup'])
export const ACCESS_CODE_MODES = Object.freeze(['auto', 'manual'])
export const ADMIN_LOG_ACTIONS = Object.freeze([
  'activated', 'deactivated', 'removed',
  'logged_in', 'logged_out', 'login_failed',
  'exam_entry_ip_blocked',
])

export const ENUM_VALUES = Object.freeze({
  'users.role':               USER_ROLES,
  'users.level':              STUDENT_LEVELS,
  'courses.level':            STUDENT_LEVELS,
  'courses.semester':         SEMESTERS,
  'exams.semester':           SEMESTERS,
  'exams.exam_type':          EXAM_TYPES,
  'exams.status':             EXAM_STATUSES,
  'exams.access_code_mode':   ACCESS_CODE_MODES,
  'question_bank.type':       QUESTION_TYPES,
  'question_bank.difficulty': DIFFICULTIES,
  'attempts.status':          ATTEMPT_STATUSES,
  'sessions.channel':         SESSION_CHANNELS,
  'admin_action_log.action':  ADMIN_LOG_ACTIONS,
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/db/enums.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/enums.js lib/db/enums.test.js
git commit -m "feat(db): enum-value constants + table.column map

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Hand-written migration — CHECK constraints + filtered unique indexes

**Files:**
- Create: `prisma/migrations/<timestamp>_enum_checks_and_filtered_indexes/migration.sql` (via `--create-only`, then hand-edited)

**Interfaces:**
- Consumes: `ENUM_VALUES` from `lib/db/enums.js` (values copied literally into SQL — do **not** import at migration runtime).
- Produces: DB-level `CHECK` constraints on every enum-like column; the two filtered unique indexes (`users` matric, `exams` access code); the `students_have_matric` check.

- [ ] **Step 1: Create an empty migration**

Run: `npx prisma migrate dev --create-only --name enum_checks_and_filtered_indexes`
Expected: creates the folder with an empty (or near-empty) `migration.sql`; **does not apply** it.

- [ ] **Step 2: Write the migration SQL**

Replace the file contents with:
```sql
-- Enum-like CHECK constraints (values mirror lib/db/enums.js).
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_role]              CHECK ([role] IN ('super_admin','school_admin','lecturer','student'));
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_level]             CHECK ([level] IS NULL OR [level] IN ('100','200','300','400','500','PG'));
ALTER TABLE [users]            ADD CONSTRAINT [ck_users_students_matric]   CHECK ([role] <> 'student' OR [matric_number] IS NOT NULL);
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_level]           CHECK ([level] IN ('100','200','300','400','500','PG'));
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_semester]        CHECK ([semester] IN ('first','second'));
ALTER TABLE [courses]          ADD CONSTRAINT [ck_courses_credit_units]    CHECK ([credit_units] BETWEEN 1 AND 6);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_semester]          CHECK ([semester] IN ('first','second'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_exam_type]         CHECK ([exam_type] IN ('ca','mid_semester','end_of_semester'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_status]            CHECK ([status] IN ('draft','scheduled','live','closed'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_access_code_mode]  CHECK ([access_code_mode] IN ('auto','manual'));
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_pass_mark]         CHECK ([pass_mark] BETWEEN 0 AND 100);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_duration]          CHECK ([duration_minutes] > 0);
ALTER TABLE [exams]            ADD CONSTRAINT [ck_exams_entry_window]      CHECK ([entry_window_minutes] > 0);
ALTER TABLE [exam_questions]   ADD CONSTRAINT [ck_exam_questions_marks]    CHECK ([marks] > 0);
ALTER TABLE [question_bank]    ADD CONSTRAINT [ck_qb_type]                 CHECK ([type] IN ('mcq','multi_select','true_false','fill_blank','short_answer','essay'));
ALTER TABLE [question_bank]    ADD CONSTRAINT [ck_qb_difficulty]          CHECK ([difficulty] IN ('easy','medium','hard'));
ALTER TABLE [attempts]        ADD CONSTRAINT [ck_attempts_status]         CHECK ([status] IN ('in_progress','submitted','graded'));
ALTER TABLE [sessions]        ADD CONSTRAINT [ck_sessions_channel]        CHECK ([channel] IN ('password','exam_access','result_lookup'));
ALTER TABLE [admin_action_log] ADD CONSTRAINT [ck_aal_action]            CHECK ([action] IN ('activated','deactivated','removed','logged_in','logged_out','login_failed','exam_entry_ip_blocked'));

-- Filtered unique indexes (Prisma's @@unique can't express a WHERE clause).
-- Matric numbers unique per university, but only when set (staff rows have NULL).
CREATE UNIQUE INDEX [ux_users_matric_per_university]
  ON [users] ([university_id], [matric_number])
  WHERE [matric_number] IS NOT NULL;

-- An access code resolves to exactly one exam among non-revoked exams.
CREATE UNIQUE INDEX [ux_exams_active_access_code]
  ON [exams] ([access_code])
  WHERE [access_code] IS NOT NULL AND [access_code_revoked_at] IS NULL;
```

- [ ] **Step 3: Apply it**

Run: `npx prisma migrate dev`
Expected: "Applied migration ... enum_checks_and_filtered_indexes". (`migrate dev` with no `--name` applies pending migrations.)

- [ ] **Step 4: Prove a CHECK bites**

Run:
```bash
docker exec pcucbt-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P Pcu_Cbt_2024 -C -d pcu_cbt -Q "INSERT INTO users (id, role, email, full_name) VALUES ('t', 'wizard', 'a@b.c', 'x')"
```
Expected: fails with `The INSERT statement conflicted with the CHECK constraint "ck_users_role"`.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations
git commit -m "feat(db): CHECK constraints + filtered unique indexes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Round-trip tests — structure + users

**Files:**
- Create: `tests/helpers/db.js`
- Create: `lib/db/schema.structure.test.js`
- Create: `lib/db/schema.users.test.js`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces: `resetDb()` and `testPrisma` from `tests/helpers/db.js` — used by every DB test from here on.

- [ ] **Step 1: Write the test helper**

Create `tests/helpers/db.js`:
```js
import { prisma } from '@/lib/db/client'

export const testPrisma = prisma

// Delete all rows in FK-safe order (children first). Called in beforeEach
// of DB tests so each test starts from empty.
export async function resetDb() {
  await prisma.$transaction([
    prisma.response.deleteMany(),
    prisma.result.deleteMany(),
    prisma.attempt.deleteMany(),
    prisma.examAccess.deleteMany(),
    prisma.examQuestion.deleteMany(),
    prisma.session.deleteMany(),
    prisma.labIpAllowlist.deleteMany(),
    prisma.adminActionLog.deleteMany(),
    prisma.exam.deleteMany(),
    prisma.questionBank.deleteMany(),
    prisma.verificationAttempt.deleteMany(),
    prisma.user.deleteMany(),
    prisma.course.deleteMany(),
    prisma.department.deleteMany(),
    prisma.faculty.deleteMany(),
    prisma.university.deleteMany(),
  ])
}

// Minimal valid rows for tests that need a parent chain.
export async function seedMinimalStructure() {
  const university = await prisma.university.create({
    data: { name: 'PCU', subdomain: 'pcu' },
  })
  const faculty = await prisma.faculty.create({
    data: { university_id: university.id, name: 'Science' },
  })
  const department = await prisma.department.create({
    data: { university_id: university.id, faculty_id: faculty.id, name: 'Computer Science' },
  })
  const course = await prisma.course.create({
    data: {
      university_id: university.id, department_id: department.id,
      course_code: 'CSC 301', course_title: 'Data Structures',
      credit_units: 3, level: '300', semester: 'first',
    },
  })
  return { university, faculty, department, course }
}
```

- [ ] **Step 2: Write the structure test**

Create `lib/db/schema.structure.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

describe('schema: institution structure', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates a full university → course chain', async () => {
    const { university, course } = await seedMinimalStructure()
    const loaded = await prisma.course.findUnique({
      where: { id: course.id },
      include: { department: { include: { faculty: true } } },
    })
    expect(loaded.department.faculty.university_id).toBe(university.id)
  })

  it('enforces unique course_code per university', async () => {
    const { university, department } = await seedMinimalStructure()
    await expect(
      prisma.course.create({
        data: {
          university_id: university.id, department_id: department.id,
          course_code: 'CSC 301', course_title: 'Dup',
          credit_units: 2, level: '300', semester: 'first',
        },
      }),
    ).rejects.toThrow()
  })

  it('cascades faculty delete down to courses', async () => {
    const { faculty, course } = await seedMinimalStructure()
    await prisma.faculty.delete({ where: { id: faculty.id } })
    expect(await prisma.course.findUnique({ where: { id: course.id } })).toBeNull()
  })

  it('rejects an out-of-range credit_units', async () => {
    const { university, department } = await seedMinimalStructure()
    await expect(
      prisma.course.create({
        data: {
          university_id: university.id, department_id: department.id,
          course_code: 'CSC 999', course_title: 'Bad',
          credit_units: 9, level: '300', semester: 'first',
        },
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Write the users test**

Create `lib/db/schema.users.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

describe('schema: users / sessions / verification_attempts', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates a staff user with no matric number', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'Dr L' },
    })
    expect(u.is_active).toBe(true)
    expect(u.must_change_password).toBe(false)
  })

  it('rejects a student with no matric number (ck_users_students_matric)', async () => {
    const { university } = await seedMinimalStructure()
    await expect(
      prisma.user.create({
        data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S' },
      }),
    ).rejects.toThrow()
  })

  it('allows two staff (NULL matric) but blocks duplicate student matric per university', async () => {
    const { university } = await seedMinimalStructure()
    await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'a@pcu.edu', full_name: 'A' } })
    await prisma.user.create({ data: { university_id: university.id, role: 'school_admin', email: 'b@pcu.edu', full_name: 'B' } })

    await prisma.user.create({ data: { university_id: university.id, role: 'student', email: 'c@pcu.edu', full_name: 'C', matric_number: 'CSC/2021/001' } })
    await expect(
      prisma.user.create({ data: { university_id: university.id, role: 'student', email: 'd@pcu.edu', full_name: 'D', matric_number: 'CSC/2021/001' } }),
    ).rejects.toThrow()
  })

  it('stores and reads a session, cascades on user delete', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'e@pcu.edu', full_name: 'E' } })
    await prisma.session.create({
      data: {
        id: 'a'.repeat(64), user_id: u.id, channel: 'password',
        expires_at: new Date(Date.now() + 3600_000),
      },
    })
    await prisma.user.delete({ where: { id: u.id } })
    expect(await prisma.session.findUnique({ where: { id: 'a'.repeat(64) } })).toBeNull()
  })

  it('rejects an unknown session channel', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'f@pcu.edu', full_name: 'F' } })
    await expect(
      prisma.session.create({
        data: { id: 'b'.repeat(64), user_id: u.id, channel: 'telepathy', expires_at: new Date() },
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run lib/db/schema.structure.test.js lib/db/schema.users.test.js`
Expected: PASS (9 tests). If the matric cascade/constraint tests fail, re-check Task 6 applied (`npx prisma migrate status`).

- [ ] **Step 5: Full suite green**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/db.js lib/db/schema.structure.test.js lib/db/schema.users.test.js
git commit -m "test(db): round-trip tests for structure + users + sessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Round-trip tests — questions, exams, attempts, results, logs

**Files:**
- Create: `lib/db/schema.exams.test.js`
- Create: `lib/db/schema.attempts.test.js`

**Interfaces:**
- Consumes: `resetDb`, `seedMinimalStructure`, `testPrisma` from `tests/helpers/db.js`.

- [ ] **Step 1: Write the exams test**

Create `lib/db/schema.exams.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

async function baseline() {
  const { university, course } = await seedMinimalStructure()
  const lecturer = await prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'lec@pcu.edu', full_name: 'Lec' },
  })
  return { university, course, lecturer }
}

describe('schema: question_bank / exams / exam_questions / exam_access', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('stores a question with JSON string columns verbatim', async () => {
    const { university, course, lecturer } = await baseline()
    const q = await prisma.questionBank.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        type: 'mcq', body: '2+2?',
        options: JSON.stringify([{ id: 'a', text: '3' }, { id: 'b', text: '4' }]),
        correct_answer: JSON.stringify('b'),
        tags: JSON.stringify(['math']),
      },
    })
    expect(JSON.parse(q.options)).toHaveLength(2)
    expect(JSON.parse(q.correct_answer)).toBe('b')
  })

  it('rejects an invalid question type', async () => {
    const { university, course, lecturer } = await baseline()
    await expect(
      prisma.questionBank.create({
        data: {
          university_id: university.id, created_by: lecturer.id, course_id: course.id,
          type: 'freeform', body: 'x',
        },
      }),
    ).rejects.toThrow()
  })

  it('creates an exam with lab-only defaults', async () => {
    const { university, course, lecturer } = await baseline()
    const exam = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'Midterm', duration_minutes: 60,
        academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
      },
    })
    expect(exam.status).toBe('draft')
    expect(exam.enforce_ip_allowlist).toBe(true)
    expect(exam.access_code_mode).toBe('auto')
    expect(exam.proctoring_enabled).toBe(false)
  })

  it('allows many NULL access codes but blocks duplicate active codes', async () => {
    const { university, course, lecturer } = await baseline()
    const mk = (title, code) => prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title, duration_minutes: 60, academic_session: '2025/2026',
        semester: 'first', exam_type: 'ca', access_code: code,
      },
    })
    await mk('A', null)
    await mk('B', null)              // two NULLs OK
    await mk('C', 'ABC234')
    await expect(mk('D', 'ABC234')).rejects.toThrow()   // duplicate active code
  })

  it('lets a revoked code be reused by another exam', async () => {
    const { university, course, lecturer } = await baseline()
    const first = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'A', duration_minutes: 60, academic_session: '2025/2026',
        semester: 'first', exam_type: 'ca', access_code: 'XYZ234',
      },
    })
    await prisma.exam.update({ where: { id: first.id }, data: { access_code_revoked_at: new Date() } })
    await expect(
      prisma.exam.create({
        data: {
          university_id: university.id, created_by: lecturer.id, course_id: course.id,
          title: 'B', duration_minutes: 60, academic_session: '2025/2026',
          semester: 'first', exam_type: 'ca', access_code: 'XYZ234',
        },
      }),
    ).resolves.toBeTruthy()
  })

  it('cascades exam delete to exam_questions and exam_access', async () => {
    const { university, course, lecturer } = await baseline()
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 'stu@pcu.edu', full_name: 'Stu', matric_number: 'X/1' },
    })
    const q = await prisma.questionBank.create({
      data: { university_id: university.id, created_by: lecturer.id, course_id: course.id, type: 'mcq', body: 'q' },
    })
    const exam = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'E', duration_minutes: 30, academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
      },
    })
    await prisma.examQuestion.create({ data: { exam_id: exam.id, question_id: q.id, marks: 2 } })
    await prisma.examAccess.create({ data: { exam_id: exam.id, user_id: student.id } })

    await prisma.exam.delete({ where: { id: exam.id } })
    expect(await prisma.examQuestion.count()).toBe(0)
    expect(await prisma.examAccess.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Write the attempts test**

Create `lib/db/schema.attempts.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

async function baseline() {
  const { university, course } = await seedMinimalStructure()
  const lecturer = await prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'lec@pcu.edu', full_name: 'Lec' },
  })
  const student = await prisma.user.create({
    data: { university_id: university.id, role: 'student', email: 'stu@pcu.edu', full_name: 'Stu', matric_number: 'CSC/2021/9' },
  })
  const question = await prisma.questionBank.create({
    data: { university_id: university.id, created_by: lecturer.id, course_id: course.id, type: 'mcq', body: 'q' },
  })
  const exam = await prisma.exam.create({
    data: {
      university_id: university.id, created_by: lecturer.id, course_id: course.id,
      title: 'E', duration_minutes: 30, academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
    },
  })
  return { university, course, lecturer, student, question, exam }
}

describe('schema: attempts / responses / results', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('enforces one attempt per (exam, student)', async () => {
    const { exam, student } = await baseline()
    await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    await expect(
      prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } }),
    ).rejects.toThrow()
  })

  it('upserts a response idempotently on (attempt, question)', async () => {
    const { exam, student, question } = await baseline()
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    const key = { attempt_id_question_id: { attempt_id: attempt.id, question_id: question.id } }

    await prisma.response.upsert({
      where: key,
      create: { attempt_id: attempt.id, question_id: question.id, student_answer: JSON.stringify('a') },
      update: { student_answer: JSON.stringify('a') },
    })
    await prisma.response.upsert({
      where: key,
      create: { attempt_id: attempt.id, question_id: question.id, student_answer: JSON.stringify('b') },
      update: { student_answer: JSON.stringify('b') },
    })
    const rows = await prisma.response.findMany({ where: { attempt_id: attempt.id } })
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].student_answer)).toBe('b')
  })

  it('cascades attempt delete to responses and result', async () => {
    const { exam, student, question } = await baseline()
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    await prisma.response.create({ data: { attempt_id: attempt.id, question_id: question.id } })
    await prisma.result.create({
      data: { attempt_id: attempt.id, student_id: student.id, exam_id: exam.id, final_score: 0, passed: false },
    })
    await prisma.attempt.delete({ where: { id: attempt.id } })
    expect(await prisma.response.count()).toBe(0)
    expect(await prisma.result.count()).toBe(0)
  })

  it('rejects an invalid attempt status', async () => {
    const { exam, student } = await baseline()
    await expect(
      prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'cheating' } }),
    ).rejects.toThrow()
  })
})

describe('schema: admin_action_log / lab_ip_allowlist', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('logs an IP-block action with JSON meta', async () => {
    const { university } = await baseline()
    const row = await prisma.adminActionLog.create({
      data: {
        university_id: university.id, action: 'exam_entry_ip_blocked',
        target_identifier: 'CSC/2021/9', meta: JSON.stringify({ ip: '10.0.0.5' }),
      },
    })
    expect(JSON.parse(row.meta).ip).toBe('10.0.0.5')
  })

  it('rejects an unknown log action', async () => {
    await expect(
      prisma.adminActionLog.create({ data: { action: 'nuked_everything' } }),
    ).rejects.toThrow()
  })

  it('stores a CIDR allowlist entry', async () => {
    const { university, lecturer } = await baseline()
    const e = await prisma.labIpAllowlist.create({
      data: { university_id: university.id, entry: '192.168.1.0/24', label: 'Lab A', created_by: lecturer.id },
    })
    expect(e.is_active).toBe(true)
  })
})
```

- [ ] **Step 3: Run the new tests**

Run: `npx vitest run lib/db/schema.exams.test.js lib/db/schema.attempts.test.js`
Expected: PASS (13 tests).

- [ ] **Step 4: Full suite green**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.exams.test.js lib/db/schema.attempts.test.js
git commit -m "test(db): round-trip tests for exams, attempts, results, logs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Seed script

**Files:**
- Create: `prisma/seed.js`
- Create: `prisma/seed.test.js`
- Modify: `package.json` (add `"prisma": { "seed": "node prisma/seed.js" }`)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`.
- Produces: `seed()` (default export, async) — creates exactly one `universities` row (idempotent via `subdomain` upsert), one bootstrap `super_admin` user (`password_hash: null`, `must_change_password: true` — real password is set in Slice 1), and, when `SEED_SAMPLE_DATA=1`, a demo faculty/department/course + one lecturer + one student.

- [ ] **Step 1: Write the failing test**

Create `prisma/seed.test.js`:
```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import { seed } from './seed.js'

describe('prisma/seed', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates exactly one university and one super_admin', async () => {
    await seed()
    expect(await prisma.university.count()).toBe(1)
    const admins = await prisma.user.findMany({ where: { role: 'super_admin' } })
    expect(admins).toHaveLength(1)
    expect(admins[0].must_change_password).toBe(true)
    expect(admins[0].password_hash).toBeNull()
  })

  it('is re-runnable without creating duplicates', async () => {
    await seed()
    await seed()
    expect(await prisma.university.count()).toBe(1)
    expect(await prisma.user.count({ where: { role: 'super_admin' } })).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run prisma/seed.test.js`
Expected: FAIL — `Cannot find module './seed.js'`.

- [ ] **Step 3: Write `prisma/seed.js`**

```js
import { prisma } from '../lib/db/client.js'

const INSTITUTION_NAME   = process.env.SEED_INSTITUTION_NAME   || 'Precious Cornerstone University'
const INSTITUTION_SLUG   = process.env.SEED_INSTITUTION_SLUG   || 'pcu'
const SUPER_ADMIN_EMAIL  = process.env.SEED_SUPER_ADMIN_EMAIL  || 'superadmin@pcu.edu.ng'
const SUPER_ADMIN_NAME   = process.env.SEED_SUPER_ADMIN_NAME   || 'System Administrator'

export async function seed() {
  // One institution. Upsert on the unique subdomain so re-running is safe.
  const university = await prisma.university.upsert({
    where: { subdomain: INSTITUTION_SLUG },
    update: { name: INSTITUTION_NAME },
    create: { name: INSTITUTION_NAME, subdomain: INSTITUTION_SLUG },
  })

  // Bootstrap super admin. password_hash stays NULL here — Slice 1 adds the
  // login flow + a one-time "set your password" step gated on
  // must_change_password. Find-or-create by email (email is not unique in
  // the schema, so we can't upsert on it).
  const existing = await prisma.user.findFirst({
    where: { email: SUPER_ADMIN_EMAIL, role: 'super_admin' },
  })
  if (!existing) {
    await prisma.user.create({
      data: {
        university_id: university.id,
        role: 'super_admin',
        email: SUPER_ADMIN_EMAIL,
        full_name: SUPER_ADMIN_NAME,
        must_change_password: true,
      },
    })
  }

  if (process.env.SEED_SAMPLE_DATA === '1') {
    await seedSampleData(university.id)
  }

  return university
}

async function seedSampleData(universityId) {
  const faculty = await prisma.faculty.upsert({
    where: { university_id_name: { university_id: universityId, name: 'Natural & Applied Sciences' } },
    update: {},
    create: { university_id: universityId, name: 'Natural & Applied Sciences' },
  })
  const department = await prisma.department.upsert({
    where: { faculty_id_name: { faculty_id: faculty.id, name: 'Computer Science' } },
    update: {},
    create: { university_id: universityId, faculty_id: faculty.id, name: 'Computer Science' },
  })
  const course = await prisma.course.upsert({
    where: { university_id_course_code: { university_id: universityId, course_code: 'CSC 301' } },
    update: {},
    create: {
      university_id: universityId, department_id: department.id,
      course_code: 'CSC 301', course_title: 'Data Structures & Algorithms',
      credit_units: 3, level: '300', semester: 'first',
    },
  })

  const lecturer = await prisma.user.findFirst({ where: { email: 'lecturer@pcu.edu.ng' } })
  if (!lecturer) {
    await prisma.user.create({
      data: {
        university_id: universityId, role: 'lecturer',
        email: 'lecturer@pcu.edu.ng', full_name: 'Demo Lecturer',
        department_id: department.id, faculty_id: faculty.id,
        must_change_password: true,
      },
    })
  }
  const student = await prisma.user.findFirst({ where: { matric_number: 'CSC/2021/001', university_id: universityId } })
  if (!student) {
    await prisma.user.create({
      data: {
        university_id: universityId, role: 'student',
        email: 'student@pcu.edu.ng', full_name: 'Demo Student',
        matric_number: 'CSC/2021/001', level: '300',
        department_id: department.id, faculty_id: faculty.id,
        date_of_birth: new Date('2003-05-14'),
      },
    })
  }
  return { faculty, department, course }
}

// Allow `node prisma/seed.js` and `prisma db seed`.
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => { console.log('Seed complete.'); return prisma.$disconnect() })
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run prisma/seed.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `prisma db seed`**

In `package.json`, add a top-level key (sibling of `"scripts"`):
```json
"prisma": {
  "seed": "node prisma/seed.js"
}
```

- [ ] **Step 6: Run the real seed against the dev DB**

Run: `npx prisma db seed`
Expected: prints "Seed complete." Then verify:
```bash
npx prisma studio
```
Open http://localhost:5555, confirm `universities` has 1 row and `users` has 1 `super_admin`. Close Studio (Ctrl+C).

- [ ] **Step 7: Full suite green**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add prisma/seed.js prisma/seed.test.js package.json
git commit -m "feat(db): seed — one institution + bootstrap super admin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Slice wrap-up — docs + verification

**Files:**
- Create: `docs/db/README.md`
- Modify: `README.md` (add a "Database (local dev)" section)

- [ ] **Step 1: Write `docs/db/README.md`**

```markdown
# Database (SQL Server + Prisma)

## Local dev setup

1. Start SQL Server:
   `docker start pcucbt-sql`  (first-time create command is in the migration spec)
2. `.env` must contain:
   `DATABASE_URL="sqlserver://localhost:1433;database=pcu_cbt;user=sa;password=Pcu_Cbt_2024;encrypt=true;trustServerCertificate=true"`
3. Apply migrations + generate client:  `npm run db:migrate`
4. Seed baseline data:  `npm run db:seed`
5. Browse data:  `npm run db:studio`

## Common tasks

| Task | Command |
|---|---|
| New schema change | edit `prisma/schema.prisma`, then `npm run db:migrate` (prompts for a name) |
| Constraint Prisma can't express | `npx prisma migrate dev --create-only --name x`, hand-edit `migration.sql`, `npm run db:migrate` |
| Wipe + rebuild dev DB | `npm run db:reset` (drops everything, replays migrations; does NOT auto-seed) |
| Regenerate client only | `npm run db:generate` |

## Conventions

- PKs: app-generated UUID strings (`NVarChar(36)`).
- Timestamps: `DateTime2`, always UTC.
- Enum-like columns: plain strings; allowed values in `lib/db/enums.js`; enforced by `CHECK` constraints.
- JSON columns (`options`, `correct_answer`, `tags`, `tips`, `meta`): `NVarChar(Max)` holding `JSON.stringify`; parse in the repo layer.
- FKs default to `onDelete: NoAction`; `Cascade` only down the ownership chain.
- Prisma model field names match snake_case DB columns on purpose (matches existing app code).

## Tests

DB tests (`lib/db/schema.*.test.js`, `prisma/seed.test.js`) run against the live
container and reset all tables in `beforeEach` via `tests/helpers/db.js`.
Run just those: `npx vitest run lib/db prisma/seed.test.js`.
```

- [ ] **Step 2: Add a section to `README.md`**

Under the existing setup instructions, add:
```markdown
## Database (local dev)

This project uses **SQL Server** (via Docker) with **Prisma**. See
[`docs/db/README.md`](docs/db/README.md) for setup. Quick start:

```bash
docker start pcucbt-sql
npm run db:migrate
npm run db:seed
```
```

- [ ] **Step 3: Verify the whole slice from clean**

Run:
```bash
npm run db:reset       # drop + replay all migrations
npm run db:seed        # baseline data
npx vitest run         # full suite
```
Expected: reset applies 2 migrations, seed prints "Seed complete.", all tests pass.

- [ ] **Step 4: Confirm no app code changed**

Run: `git diff --stat main -- app components lib/actions lib/supabase lib/dal.js`
Expected: **empty** — Slice 0 touches only `prisma/`, `lib/db/`, `tests/helpers/`, `docs/`, `package.json`, `README.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/db/README.md README.md
git commit -m "docs(db): local dev + Prisma workflow guide

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§4 data-model translation):**
- §4.1 type-mapping rules — Tasks 3 (UUID/DateTime2/NVarChar(Max)/Boolean), 6 (filtered indexes, dropped `auth.users` FK implicit, no enums). ✅
- §4.2 new/changed tables — `sessions` (Task 3), `users.password_hash`/`must_change_password`/`date_of_birth` (Task 3), `verification_attempts` (Task 3), `exams.access_code_revoked_at`/`access_code_mode`/`enforce_ip_allowlist` (Task 3), `lab_ip_allowlist` (Task 3), `exam_mode` dropped (not in schema), `proctoring_snapshots` not ported, `attempt_events` not created. ✅
- §4.2 filtered unique index on `exams.access_code` — Task 6. ✅
- §4.3 seed — Task 9 (one university, bootstrap super_admin, sample data behind `SEED_SAMPLE_DATA=1`). ✅
- §5.7 NFR-TEST-2 (real SQL Server for tests, not SQLite) — Task 7 (`tests/helpers/db.js` uses the live container). ✅
- Multiple-cascade-path risk (§7) — Task 3 pre-empts Department/Course; Task 4 Step 1 gives the fix loop for any others. ✅
- NFR-PERF-4 indexes — Task 3 `@@index` on `sessions(user_id)`, `sessions(expires_at)`; Task 6 filtered unique on `access_code`; all legacy indexes carried. ✅

**Deferred to later slices (correctly out of scope here):**
- `lib/auth/*`, password hashing, `TRUST_PROXY`, `lib/security/clientIp.js` — Slice 1/2.
- Repository layer, RLS→code translation — Slice 1+.
- Removing `@supabase/*` deps, `lib/supabase/` — Slice 7.
- `connection_limit`/`pool_timeout` tuning, Windows service, backups — Slice 7.

**Placeholder scan:** no TBD/TODO; every code step has complete content; no "add error handling" hand-waves. ✅

**Type consistency:** client accessors used consistently — `prisma.university`, `prisma.questionBank`, `prisma.examQuestion`, `prisma.examAccess`, `prisma.labIpAllowlist`, `prisma.adminActionLog`, `prisma.verificationAttempt` (camelCase of the `@@map`'d model name). Composite-unique `where` keys used in seed (`university_id_name`, `faculty_id_name`, `university_id_course_code`, `attempt_id_question_id`) follow Prisma's `<field1>_<field2>` convention from the `@@unique` declarations in Task 3. ✅

**Note for the executor:** the sqlcmd path in Tasks 4/6 is `/opt/mssql-tools18/bin/sqlcmd` for the 2022 image; if that errors, try `/opt/mssql-tools/bin/sqlcmd` (older path) — both may exist depending on image build.
