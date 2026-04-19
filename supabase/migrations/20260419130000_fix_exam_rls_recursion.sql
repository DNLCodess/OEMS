-- The circular RLS dependency:
--   student_read_accessible_exams (on exams) → queries exam_access table
--   exam_owner_manage_access (on exam_access) → queries exams table → INFINITE LOOP
--
-- Fix: replace the exam_access policy's subquery on exams with a SECURITY DEFINER
-- function that reads exam ownership directly, bypassing RLS.

CREATE OR REPLACE FUNCTION exam_creator_id(p_exam_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT created_by FROM exams WHERE id = p_exam_id
$$;

-- Replace the recursive policy on exam_access
DROP POLICY IF EXISTS "exam_owner_manage_access" ON exam_access;

CREATE POLICY "exam_owner_manage_access" ON exam_access
  FOR ALL TO authenticated
  USING (exam_creator_id(exam_id) = auth.uid())
  WITH CHECK (exam_creator_id(exam_id) = auth.uid());

-- Replace the recursive policy on exam_questions for the same reason
DROP POLICY IF EXISTS "exam_owner_manage_exam_questions" ON exam_questions;

CREATE POLICY "exam_owner_manage_exam_questions" ON exam_questions
  FOR ALL TO authenticated
  USING (exam_creator_id(exam_id) = auth.uid())
  WITH CHECK (exam_creator_id(exam_id) = auth.uid());
