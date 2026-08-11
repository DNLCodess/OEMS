-- Lecturers could read every non-archived question university-wide via
-- lecturer_read_university_questions, with no course/department boundary.
-- Narrowing to department-level sharing: a lecturer can now only see (and
-- reuse, via the exam-builder picker) questions belonging to a course in
-- their own department. Own questions stay visible/manageable regardless
-- of department via the untouched lecturer_manage_own_questions ALL policy
-- (Postgres RLS combines multiple permissive policies for one command with
-- OR). A lecturer with no department_id set sees no shared questions —
-- fails closed, not open.
-- Applied: <fill in the date you run this>

-- Helper: get current user's department_id (same pattern as
-- auth_university_id()/auth_role()).
CREATE OR REPLACE FUNCTION auth_department_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT department_id FROM public.users WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "lecturer_read_university_questions" ON question_bank;

CREATE POLICY "lecturer_read_department_questions" ON question_bank
  FOR SELECT
  USING (
    university_id = auth_university_id()
    AND auth_role() = 'lecturer'
    AND is_archived = FALSE
    AND course_id IN (SELECT id FROM courses WHERE department_id = auth_department_id())
  );

-- Manual verification (run as any authenticated lecturer via the app, or
-- via `SET ROLE`/impersonation in the SQL editor — do not run as the
-- postgres/service-role user, which bypasses RLS entirely):
--
--   SELECT id, course_id FROM question_bank WHERE is_archived = FALSE;
--
-- Expected: only rows where course_id belongs to a course in the lecturer's
-- own department, plus any row where created_by = the lecturer's own id
-- (regardless of that row's department). A lecturer with department_id
-- NULL should see only their own created_by rows.
