-- Exam timing redesign: duration-based entry window instead of fixed wall-clock scheduling
-- Applied: 2026-08-09 (applied directly via Supabase MCP)

-- go_live_at: stamped automatically the moment a lecturer transitions an
-- exam to 'live' (updateExamStatus) — never set directly by a lecturer.
-- Combined with entry_window_minutes, this replaces fixed start_at/end_at
-- scheduling (columns still present in the schema, unused) with a window
-- relative to the actual moment the exam opened, which survives a late
-- start correctly — a fixed pre-set clock time does not.
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS go_live_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_window_minutes INT NOT NULL DEFAULT 10 CHECK (entry_window_minutes > 0);
