-- Lets a university customize its primary brand color, shown on its
-- /{slug}/login and other branded pages and carried through its staff's
-- entire authenticated session. NULL (every existing row, and any future
-- one that never sets it) means "use the default PCU purple" — this column
-- is purely additive, nothing existing changes behavior.
-- Applied: 2026-08-12 (applied directly via Supabase MCP)

ALTER TABLE universities ADD COLUMN IF NOT EXISTS primary_color TEXT;
