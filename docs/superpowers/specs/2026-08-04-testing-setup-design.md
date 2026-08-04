# Testing Setup — Design

## Problem

OEMS has no automated tests. All verification of business logic (role guards,
validation rules, invite/grading/results logic) currently happens by manually
clicking through the app. This is the first of four planned follow-up
workstreams (tracked in `tdl.md`); the other three (super-admin settings UI,
forced password-reset flow, restoring `.env.local.example`) depend on being
able to verify their logic without a full manual pass, so this comes first.

## Goal

Establish a fast, logic-focused regression safety net: unit/integration tests
for the riskiest, hardest-to-eyeball-verify code — Zod validation schemas,
the central auth guard (`lib/dal.js`), and the two highest-risk server
actions (`lib/actions/auth.js`, `lib/actions/admin.js`). Not aiming for
exhaustive coverage in this round — see Non-Goals.

## Tooling

- **Runner:** [Vitest](https://vitest.dev). Chosen over Jest because it's
  native ESM/Vite, requires no Babel config to work with Next.js 16 +
  React 19, and is fast enough to run on every save.
- **Config:** `vitest.config.mjs` at the repo root.
  - `environment: 'node'` — v1 has no component/DOM tests.
  - Path alias `@/*` → `./*`, mirroring `jsconfig.json`, via
    `vite-tsconfig-paths` or an explicit `resolve.alias` entry.
- **npm scripts** (added to `package.json`):
  - `"test": "vitest run"` — single run, used in CI/pre-commit context later.
  - `"test:watch": "vitest"` — interactive watch mode for local dev.
- **No coverage tooling in v1** (`@vitest/coverage-v8` etc.) — can be added
  later once there's enough test surface for a coverage number to be
  meaningful.

## Test layout

- Colocated: `foo.js` → `foo.test.js` in the same directory. This is
  Vitest's own convention, keeps tests next to the code they verify, and
  avoids a parallel `__tests__` tree drifting out of sync.
- Shared mock helper: `tests/helpers/supabaseMock.js` (new top-level `tests/`
  dir, since this is shared infrastructure, not a test of any one file).

## Supabase mocking strategy

Server actions call `createClient()` (`lib/supabase/server.js`) or
`createAdminClient()` (`lib/supabase/admin.js`), then chain query builder
calls like `.from('users').select('*').eq('id', x).single()`.

`tests/helpers/supabaseMock.js` exports a `createMockSupabaseClient(responses)`
factory:

- Returns an object shaped like the real client (`.from()`, `.auth.admin.*`,
  `.auth.signInWithPassword()`, etc.) where every query-builder method
  (`select`, `eq`, `in`, `upsert`, `update`, `single`, ...) is chainable and
  returns `this`, terminating in a Promise that resolves to a
  caller-configured `{ data, error }`.
- Tests configure responses per table: `createMockSupabaseClient({ users: [{
  data: ..., error: null }, { data: ..., error: null }] })` — an ordered
  queue per table name, shifted on each terminal call (`.single()`,
  `.select()` when awaited directly, etc.) against that table. Covers the
  common case of a test needing two sequential calls to the same table
  (e.g. a `select` then an `update`) without over-engineering a generic
  call-matcher.
- Test files `vi.mock('@/lib/supabase/server')` /
  `vi.mock('@/lib/supabase/admin')` to inject the mock in place of the real
  client.

This tests business logic (which queries fire, role/permission branches,
error propagation, return shapes) without any network call or real database
— fast, no cleanup, deterministic. It will **not** catch RLS-policy or raw
SQL bugs; that class of bug stays covered by the existing manual
`supabase/migrations` review process and is out of scope here.

## Scope — files covered in this round

| File | What's tested |
|---|---|
| `lib/validations/auth.js` | Schema accepts valid input, rejects invalid (missing fields, bad email, short password) |
| `lib/validations/exams.js` | Same pattern for exam schema |
| `lib/validations/questions.js` | Same pattern for question schema, incl. per-type option/answer shape rules |
| `lib/dal.js` | `getAuthUser()` returns null when unauthenticated; `requireRole()` allows matching roles, redirects/throws for mismatched roles; `roleHome()` mapping |
| `lib/actions/auth.js` | Login success/failure paths, password-reset request/update flows, error message propagation |
| `lib/actions/admin.js` | `inviteUser()` — role/permission checks, temp-password behavior (this is the file the forced-password-reset workstream will modify next, so a baseline test here protects that change) |

## Non-Goals (deferred, tracked in `tdl.md`)

- `lib/actions/exams.js`, `questions.js`, `attempts.js`, `results.js` —
  separate follow-up round.
- Playwright / end-to-end browser tests.
- Component/UI tests (React Testing Library) — v1 is logic-only.
- CI wiring (no CI config exists yet in this repo).
- Coverage thresholds/reporting.

## Testing the tests

Since this whole workstream *is* test infrastructure, "testing" it means:
`npm run test` runs clean with all new tests passing, and a deliberately
broken assertion (e.g. temporarily flipping an `expect`) fails loudly to
confirm the harness actually executes and reports failures correctly.
