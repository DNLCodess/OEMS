-- Exam delivery modes, proctoring, calculator, and tips

-- ── New columns on exams ─────────────────────────────────────────────────────

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS exam_mode          text        NOT NULL DEFAULT 'remote'
    CHECK (exam_mode IN ('remote', 'lab')),
  ADD COLUMN IF NOT EXISTS lab_code           text        UNIQUE,
  ADD COLUMN IF NOT EXISTS proctoring_enabled boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_calculator    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tips               text[]      NOT NULL DEFAULT '{}';

-- ── Proctoring snapshots ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proctoring_snapshots (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id  UUID        NOT NULL REFERENCES attempts(id)  ON DELETE CASCADE,
  student_id  UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  image_url   TEXT        NOT NULL,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proctoring_attempt ON proctoring_snapshots(attempt_id);

ALTER TABLE proctoring_snapshots ENABLE ROW LEVEL SECURITY;

-- Students can only insert their own snapshots
CREATE POLICY "student_insert_own_snapshots" ON proctoring_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

-- Lecturers/admins can read snapshots for exams in their university
CREATE POLICY "staff_read_snapshots" ON proctoring_snapshots
  FOR SELECT TO authenticated
  USING (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM attempts a
      JOIN exams e ON e.id = a.exam_id
      WHERE a.id = proctoring_snapshots.attempt_id
        AND e.university_id = auth_university_id()
    )
  );

-- ── Supabase Storage bucket for proctoring images ───────────────────────────
-- Creates the private bucket if it doesn't exist yet.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proctoring',
  'proctoring',
  false,
  524288,  -- 512 KB per snapshot
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: students can upload to their own folder
CREATE POLICY "student_upload_snapshots"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proctoring'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: staff can view snapshots for their university
CREATE POLICY "staff_view_snapshots"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proctoring'
    AND auth_role() IN ('lecturer', 'school_admin', 'super_admin')
  );
