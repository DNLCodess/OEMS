-- RLS Hardening — Phase 6 audit
--
-- Gap: "student_own_responses FOR ALL" allowed students to INSERT/UPDATE responses
-- even on already-submitted attempts. Replacing with scoped policies.
-- Gap: "student_own_attempts FOR ALL" allowed students to directly UPDATE the
-- attempt row (e.g. forging status or total_score). Tightened to SELECT + INSERT.
-- Grading/submission updates are performed via Server Actions (user JWT) and are
-- constrained at the application layer; the remaining window (direct Supabase API
-- calls from the browser) is now closed by removing UPDATE from the student policy.

-- ── attempts ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "student_own_attempts" ON attempts;

CREATE POLICY "student_select_own_attempts" ON attempts
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- Students may only INSERT once per exam (DB UNIQUE enforces one attempt per student)
-- and only when the exam is live.
CREATE POLICY "student_insert_own_attempts" ON attempts
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND status = 'in_progress'
    AND total_score IS NULL
    AND EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = attempts.exam_id
        AND exams.status = 'live'
        AND exams.university_id = auth_university_id()
    )
  );

-- Server Actions (submitExam, recalculateResult) run under the student's JWT
-- and need to UPDATE attempts. We allow it only while status = 'in_progress'
-- and block forging: student cannot set total_score or jump past 'submitted'.
CREATE POLICY "student_submit_own_attempt" ON attempts
  FOR UPDATE TO authenticated
  USING  (student_id = auth.uid() AND status = 'in_progress')
  WITH CHECK (
    student_id = auth.uid()
    AND status = 'submitted'
  );


-- ── responses ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "student_own_responses" ON responses;

CREATE POLICY "student_select_own_responses" ON responses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM attempts
      WHERE attempts.id = responses.attempt_id
        AND attempts.student_id = auth.uid()
    )
  );

-- Students may only INSERT/UPDATE responses while the attempt is in_progress.
CREATE POLICY "student_insert_own_responses" ON responses
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM attempts
      WHERE attempts.id = responses.attempt_id
        AND attempts.student_id = auth.uid()
        AND attempts.status = 'in_progress'
    )
  );

CREATE POLICY "student_update_own_responses" ON responses
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM attempts
      WHERE attempts.id = responses.attempt_id
        AND attempts.student_id = auth.uid()
        AND attempts.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM attempts
      WHERE attempts.id = responses.attempt_id
        AND attempts.student_id = auth.uid()
        AND attempts.status = 'in_progress'
    )
  );

-- Grading updates (marks_awarded, is_correct, teacher_feedback) are handled
-- by the existing "lecturer_update_feedback" policy — no changes needed there.
