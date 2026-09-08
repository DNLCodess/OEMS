# Database (SQL Server + Prisma)

## Local dev setup

1. Start SQL Server (Docker):
   `docker start pcucbt-sql`
   (first-time container create command is in the migration spec / `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md`)
2. `.env` (git-ignored) must contain:
   `DATABASE_URL="sqlserver://localhost:1433;database=pcu_cbt;user=sa;password=Pcu_Cbt_2024;encrypt=true;trustServerCertificate=true"`
3. Apply migrations + generate the client:  `npm run db:migrate`
4. Seed baseline data:  `npm run db:seed`
5. Browse data in a GUI:  `npm run db:studio` (http://localhost:5555)

## Common tasks

| Task | Command |
|---|---|
| New schema change | edit `prisma/schema.prisma`, then `npm run db:migrate` (prompts for a migration name) |
| Constraint Prisma can't express (filtered index, CHECK) | `npx prisma migrate dev --create-only --name x`, hand-edit the generated `migration.sql`, then `npm run db:migrate` |
| Wipe + rebuild dev DB | `npm run db:reset` (drops everything, replays all migrations, then runs the seed) |
| Regenerate the client only | `npm run db:generate` |
| Deploy migrations on the server (no dev prompts) | `npx prisma migrate deploy` |

## Conventions

- **PKs:** app-generated UUID strings (`NVarChar(36)`).
- **Timestamps:** `DateTime2`, always stored UTC.
- **Enum-like columns:** plain strings; allowed values in `lib/db/enums.js`; enforced by `CHECK` constraints (see `prisma/migrations/*_enum_checks_and_filtered_indexes`).
- **JSON columns** (`options`, `correct_answer`, `tags`, `tips`, `meta`): `NVarChar(Max)` holding `JSON.stringify` output; parse/serialise in the repo layer.
- **FKs** default to `onDelete: NoAction`; `Cascade` only down the ownership chain (university→faculty→department→course, exam→exam_questions/exam_access, attempt→responses/result, user→sessions). SQL Server rejects multiple cascade paths into one table — that is why `departments.university_id` and `courses.university_id` are `NoAction`.
- **Prisma model field names** deliberately match the snake_case DB columns (matches the existing app code). Model names are singular PascalCase mapped to snake_case tables via `@@map`.

## Tests

DB integration tests (`lib/db/schema.*.test.js`, `lib/db/client.test.js`,
`prisma/seed.test.js`) run against the live container and truncate all tables
in `beforeEach` via `tests/helpers/db.js`. They run in the **`db` vitest
project**, which is serial (`fileParallelism: false`) so they don't race.
Unit tests run in the parallel **`unit`** project.

- Everything:  `npx vitest run`
- DB only:  `npx vitest run --project db`
- Unit only:  `npx vitest run --project unit`
