-- Extends admin_action_log (shipped and applied earlier today) to also
-- capture login/logout — successful and failed — across staff (password)
-- and students (credential-less). See docs/superpowers/specs/
-- 2026-08-11-login-logout-activity-log-design.md for the full design.
-- Applied: <fill in the date you run this>

-- The original CHECK constraint was declared inline with no explicit name,
-- so Postgres auto-named it. Find and drop it by inspecting the catalog
-- rather than hardcoding the assumed name, so this migration can't
-- silently no-op against a differently-named constraint.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT con.conname INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'admin_action_log'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%action%';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE admin_action_log DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE admin_action_log ADD CONSTRAINT admin_action_log_action_check
  CHECK (action IN ('activated', 'deactivated', 'removed', 'logged_in', 'logged_out', 'login_failed'));

ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS subject_role user_role;
ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS target_identifier TEXT;

-- Manual verification: confirm the new check constraint accepts the new
-- values and still rejects garbage:
--
--   INSERT INTO admin_action_log (action, subject_role, target_identifier)
--   VALUES ('logged_in', 'lecturer', 'nobody@example.com'); -- should succeed
--   INSERT INTO admin_action_log (action) VALUES ('bogus');  -- should fail
--
-- Then delete the test row:
--   DELETE FROM admin_action_log WHERE target_identifier = 'nobody@example.com';
