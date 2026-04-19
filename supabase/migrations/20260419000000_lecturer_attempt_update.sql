-- C1 Fix: Lecturer UPDATE policy on attempts was missing.
-- recalculateResult() sets status='graded' and total_score under a lecturer JWT.
-- Without this policy those updates silently affected 0 rows.

CREATE POLICY "lecturer_update_exam_attempts" ON attempts
  FOR UPDATE TO authenticated
  USING (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = attempts.exam_id
        AND exams.university_id = auth_university_id()
    )
  )
  WITH CHECK (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = attempts.exam_id
        AND exams.university_id = auth_university_id()
    )
  );
