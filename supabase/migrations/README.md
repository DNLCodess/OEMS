# Supabase Migrations

## Convention

- `supabase/schema.sql` — the full baseline schema (run once on a fresh project).
- `supabase/migrations/` — incremental changes applied **on top of** the baseline.

## Naming

```
YYYYMMDDHHMMSS_short_description.sql
```

Example: `20241025143000_add_exam_word_limit.sql`

## How to run

1. Open the Supabase dashboard → SQL Editor → New query.
2. Paste the migration file contents.
3. Run. Migrations are **not** automatically applied — each must be run manually.
4. Mark the file as applied by adding a comment at the top: `-- Applied: YYYY-MM-DD`.

## Rules

- Never edit `schema.sql` after the project is live. Write a migration instead.
- Migrations must be idempotent where possible (`IF NOT EXISTS`, `OR REPLACE`, etc.).
- Each migration file covers one logical change — do not bundle unrelated changes.
- RLS policies that change existing behaviour go in a migration, not in `schema.sql`.
