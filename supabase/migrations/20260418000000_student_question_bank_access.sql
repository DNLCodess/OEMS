-- Allow students to read question_bank rows that belong to an exam
-- they have an active (in_progress) attempt for.
-- Correct answers are never sent to the client — that exclusion is enforced
-- in the application layer by not selecting the correct_answer column.

CREATE POLICY "student_read_questions_in_active_attempt" ON question_bank
  FOR SELECT TO authenticated
  USING (
    auth_role() = 'student'
    AND EXISTS (
      SELECT 1
      FROM exam_questions eq
      JOIN attempts a ON a.exam_id = eq.exam_id
      WHERE eq.question_id = question_bank.id
        AND a.student_id   = auth.uid()
        AND a.status       = 'in_progress'
    )
  );
