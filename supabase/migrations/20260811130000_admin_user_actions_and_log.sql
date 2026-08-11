-- Adds the ability to permanently (one-way, through the app) remove a user,
-- and a scoped activity log for user activate/deactivate/remove actions.
-- removed_at is the only new "is removed" signal — it's always set together
-- with is_active = false, so every existing is_active = true filter in the
-- app already excludes a removed user with no other code changes needed.
-- Applied: <fill in the date you run this>

ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS admin_action_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID REFERENCES universities(id) ON DELETE SET NULL,
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('activated', 'deactivated', 'removed')),
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_read_action_log" ON admin_action_log
  FOR SELECT TO authenticated
  USING (auth_role() = 'super_admin');

CREATE POLICY "super_admin_insert_action_log" ON admin_action_log
  FOR INSERT TO authenticated
  WITH CHECK (auth_role() = 'super_admin');

CREATE POLICY "school_admin_read_own_action_log" ON admin_action_log
  FOR SELECT TO authenticated
  USING (auth_role() = 'school_admin' AND university_id = auth_university_id());

CREATE POLICY "school_admin_insert_own_action_log" ON admin_action_log
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_role() = 'school_admin'
    AND university_id = auth_university_id()
    AND actor_id = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_admin_action_log_university ON admin_action_log(university_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created_at ON admin_action_log(created_at DESC);

-- Manual verification (run via the app as each role, or via SET ROLE /
-- impersonation in the SQL editor — never as the postgres/service-role
-- user, which bypasses RLS entirely):
--
--   SELECT * FROM admin_action_log ORDER BY created_at DESC LIMIT 20;
--
-- Expected: a super_admin sees every row; a school_admin sees only rows
-- where university_id matches their own university.
