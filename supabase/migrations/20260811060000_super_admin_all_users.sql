-- Super admin could only ever see their own row in the users table
-- Applied: 2026-08-11

-- super_admin is a platform-wide role, not scoped to a university — its own
-- university_id is NULL (handle_new_user() only sets university_id from
-- signup metadata, and createSuperAdmin never passes one). Every existing
-- SELECT/ALL policy on users requires `university_id = auth_university_id()`,
-- and NULL never equals NULL in SQL, so those policies contributed zero rows
-- for a super admin. Only "read your own row" (id = auth.uid()) ever matched,
-- which is why /super-admin/users showed just the logged-in super admin
-- instead of every user on the platform. universities already has the
-- unscoped equivalent of this policy (super_admin_all_universities); users
-- never got one.
CREATE POLICY "super_admin_all_users" ON users
  FOR ALL TO authenticated
  USING (auth_role() = 'super_admin')
  WITH CHECK (auth_role() = 'super_admin');
