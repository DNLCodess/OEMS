-- ============================================================
-- OEMS — Online Examination Management System
-- Supabase / PostgreSQL Schema
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Execute top-to-bottom; re-running is safe due to IF NOT EXISTS guards.
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'school_admin', 'lecturer', 'student');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_level AS ENUM ('100', '200', '300', '400', '500', 'PG');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE semester_type AS ENUM ('first', 'second');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE exam_type AS ENUM ('ca', 'mid_semester', 'end_of_semester');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE exam_status AS ENUM ('draft', 'scheduled', 'live', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE question_type AS ENUM ('mcq', 'multi_select', 'true_false', 'fill_blank', 'short_answer', 'essay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE difficulty AS ENUM ('easy', 'medium', 'hard');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'graded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- 2. UNIVERSITY STRUCTURE
-- ============================================================

CREATE TABLE IF NOT EXISTS universities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  subdomain   TEXT NOT NULL UNIQUE,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faculties (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(university_id, name)
);

CREATE TABLE IF NOT EXISTS departments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  faculty_id     UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faculty_id, name)
);

CREATE TABLE IF NOT EXISTS courses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  course_code    TEXT NOT NULL,           -- e.g. "CSC 301"
  course_title   TEXT NOT NULL,           -- e.g. "Data Structures"
  credit_units   INT NOT NULL DEFAULT 2 CHECK (credit_units BETWEEN 1 AND 6),
  level          student_level NOT NULL,
  semester       semester_type NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(university_id, course_code)
);


-- ============================================================
-- 3. USERS (extends auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  university_id  UUID REFERENCES universities(id) ON DELETE SET NULL,
  role           user_role NOT NULL,
  email          TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  -- Students only
  matric_number  TEXT,
  level          student_level,
  department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,
  faculty_id     UUID REFERENCES faculties(id) ON DELETE SET NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT students_have_matric CHECK (
    role != 'student' OR matric_number IS NOT NULL
  )
);

-- Partial unique index: matric numbers must be unique per university, but only when set.
-- A table-level UNIQUE NULLS NOT DISTINCT would prevent >1 lecturer/admin per university.
CREATE UNIQUE INDEX IF NOT EXISTS unique_matric_per_university
  ON users (university_id, matric_number)
  WHERE matric_number IS NOT NULL;

-- Automatically create a users row when a new auth user signs up.
-- Role, university_id, and name are passed via user_metadata on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, university_id, matric_number, level, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (NEW.raw_user_meta_data->>'role')::user_role,
    (NEW.raw_user_meta_data->>'university_id')::uuid,
    NEW.raw_user_meta_data->>'matric_number',
    (NEW.raw_user_meta_data->>'level')::student_level,
    TRUE
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- ============================================================
-- 4. QUESTION BANK
-- ============================================================

CREATE TABLE IF NOT EXISTS question_bank (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  type           question_type NOT NULL,
  body           TEXT NOT NULL,
  -- options: array of {id, text} for MCQ/multi_select/true_false; null for others
  options        JSONB,
  -- correct_answer: string (mcq/true_false), string[] (multi_select), or null (essay)
  correct_answer JSONB,
  explanation    TEXT,
  difficulty     difficulty NOT NULL DEFAULT 'medium',
  tags           TEXT[] NOT NULL DEFAULT '{}',
  is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 5. EXAMS
-- ============================================================

CREATE TABLE IF NOT EXISTS exams (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id        UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  created_by           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id            UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  title                TEXT NOT NULL,
  instructions         TEXT,
  duration_minutes     INT NOT NULL CHECK (duration_minutes > 0),
  start_at             TIMESTAMPTZ,
  end_at               TIMESTAMPTZ,
  academic_session     TEXT NOT NULL,   -- e.g. "2024/2025"
  semester             semester_type NOT NULL,
  exam_type            exam_type NOT NULL,
  status               exam_status NOT NULL DEFAULT 'draft',
  pass_mark            INT NOT NULL DEFAULT 50 CHECK (pass_mark BETWEEN 0 AND 100),
  randomise_questions  BOOLEAN NOT NULL DEFAULT FALSE,
  randomise_options    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Delivery mode: remote (anywhere) or lab (kiosk via lab_code link)
  exam_mode            TEXT    NOT NULL DEFAULT 'remote' CHECK (exam_mode IN ('remote', 'lab')),
  lab_code             TEXT    UNIQUE,
  proctoring_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  show_calculator      BOOLEAN NOT NULL DEFAULT FALSE,
  tips                 TEXT[]  NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT end_after_start CHECK (end_at IS NULL OR end_at > start_at)
);

-- Questions belonging to an exam, with per-question mark allocation
CREATE TABLE IF NOT EXISTS exam_questions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id      UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  order_index  INT NOT NULL DEFAULT 0,
  marks        INT NOT NULL DEFAULT 1 CHECK (marks > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(exam_id, question_id)
);

-- Per-student access list — if the table has rows for an exam, only those students can access it
CREATE TABLE IF NOT EXISTS exam_access (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id    UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(exam_id, user_id)
);


-- ============================================================
-- 6. STUDENT ATTEMPTS
-- ============================================================

CREATE TABLE IF NOT EXISTS attempts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id       UUID NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
  student_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at  TIMESTAMPTZ,
  status        attempt_status NOT NULL DEFAULT 'in_progress',
  total_score   INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One attempt per student per exam
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS responses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id       UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id      UUID NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  student_answer   JSONB,
  is_correct       BOOLEAN,
  marks_awarded    INT NOT NULL DEFAULT 0,
  teacher_feedback TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);


-- ============================================================
-- 7. RESULTS
-- ============================================================

CREATE TABLE IF NOT EXISTS results (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id   UUID NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  exam_id      UUID NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
  final_score  INT NOT NULL,
  passed       BOOLEAN NOT NULL,
  released_at  TIMESTAMPTZ,   -- NULL = not yet visible to the student
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 8. INDEXES (query performance)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_university        ON users(university_id);
CREATE INDEX IF NOT EXISTS idx_users_role              ON users(role);
CREATE INDEX IF NOT EXISTS idx_faculties_university    ON faculties(university_id);
CREATE INDEX IF NOT EXISTS idx_departments_faculty     ON departments(faculty_id);
CREATE INDEX IF NOT EXISTS idx_courses_department      ON courses(department_id);
CREATE INDEX IF NOT EXISTS idx_courses_university      ON courses(university_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_course    ON question_bank(course_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_creator   ON question_bank(created_by);
CREATE INDEX IF NOT EXISTS idx_exams_course            ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_status            ON exams(status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam     ON exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam           ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student        ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_responses_attempt       ON responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_results_student         ON results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_exam            ON results(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_released        ON results(released_at) WHERE released_at IS NOT NULL;


-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE universities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_access     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE results         ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's university_id (avoids repeated sub-selects)
CREATE OR REPLACE FUNCTION auth_university_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT university_id FROM public.users WHERE id = auth.uid()
$$;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

-- Helper: get exam creator without triggering RLS (breaks exam ↔ exam_access circular dependency)
CREATE OR REPLACE FUNCTION exam_creator_id(p_exam_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT created_by FROM exams WHERE id = p_exam_id
$$;


-- ---- universities ----
CREATE POLICY "super_admin_all_universities" ON universities
  FOR ALL TO authenticated
  USING (auth_role() = 'super_admin')
  WITH CHECK (auth_role() = 'super_admin');

CREATE POLICY "members_read_own_university" ON universities
  FOR SELECT TO authenticated
  USING (id = auth_university_id());


-- ---- faculties ----
CREATE POLICY "members_read_faculties" ON faculties
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id());

CREATE POLICY "school_admin_manage_faculties" ON faculties
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'))
  WITH CHECK (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));


-- ---- departments ----
CREATE POLICY "members_read_departments" ON departments
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id());

CREATE POLICY "school_admin_manage_departments" ON departments
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'))
  WITH CHECK (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));


-- ---- courses ----
CREATE POLICY "members_read_courses" ON courses
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id());

CREATE POLICY "school_admin_manage_courses" ON courses
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'))
  WITH CHECK (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));


-- ---- users ----
CREATE POLICY "users_read_own_profile" ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "users_update_own_profile" ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "school_admin_read_university_users" ON users
  FOR SELECT TO authenticated
  USING (
    university_id = auth_university_id()
    AND auth_role() IN ('school_admin', 'super_admin', 'lecturer')
  );

CREATE POLICY "school_admin_manage_users" ON users
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'))
  WITH CHECK (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));


-- ---- question_bank ----
CREATE POLICY "lecturer_manage_own_questions" ON question_bank
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND created_by = auth.uid())
  WITH CHECK (university_id = auth_university_id() AND created_by = auth.uid());

CREATE POLICY "lecturer_read_university_questions" ON question_bank
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id() AND auth_role() = 'lecturer' AND is_archived = FALSE);

CREATE POLICY "school_admin_read_questions" ON question_bank
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));


-- ---- exams ----
CREATE POLICY "lecturer_manage_own_exams" ON exams
  FOR ALL TO authenticated
  USING (university_id = auth_university_id() AND created_by = auth.uid())
  WITH CHECK (university_id = auth_university_id() AND created_by = auth.uid());

CREATE POLICY "school_admin_read_exams" ON exams
  FOR SELECT TO authenticated
  USING (university_id = auth_university_id() AND auth_role() IN ('school_admin', 'super_admin'));

CREATE POLICY "student_read_accessible_exams" ON exams
  FOR SELECT TO authenticated
  USING (
    university_id = auth_university_id()
    AND auth_role() = 'student'
    AND status IN ('scheduled', 'live', 'closed')
    AND (
      -- Open to all students in the university, OR specifically listed
      NOT EXISTS (SELECT 1 FROM exam_access WHERE exam_access.exam_id = exams.id)
      OR EXISTS (SELECT 1 FROM exam_access WHERE exam_access.exam_id = exams.id AND exam_access.user_id = auth.uid())
    )
  );


-- ---- exam_questions ----
CREATE POLICY "exam_owner_manage_exam_questions" ON exam_questions
  FOR ALL TO authenticated
  USING (exam_creator_id(exam_id) = auth.uid())
  WITH CHECK (exam_creator_id(exam_id) = auth.uid());

CREATE POLICY "student_read_exam_questions" ON exam_questions
  FOR SELECT TO authenticated
  USING (
    auth_role() = 'student'
    AND EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = exam_questions.exam_id AND exams.status = 'live'
    )
    AND EXISTS (
      SELECT 1 FROM attempts
      WHERE attempts.exam_id = exam_questions.exam_id
      AND attempts.student_id = auth.uid()
      AND attempts.status = 'in_progress'
    )
  );


-- ---- exam_access ----
CREATE POLICY "exam_owner_manage_access" ON exam_access
  FOR ALL TO authenticated
  USING (exam_creator_id(exam_id) = auth.uid())
  WITH CHECK (exam_creator_id(exam_id) = auth.uid());


-- ---- attempts ----
CREATE POLICY "student_own_attempts" ON attempts
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "lecturer_read_exam_attempts" ON attempts
  FOR SELECT TO authenticated
  USING (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM exams
      WHERE exams.id = attempts.exam_id AND exams.university_id = auth_university_id()
    )
  );


-- ---- responses ----
CREATE POLICY "student_own_responses" ON responses
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM attempts WHERE attempts.id = responses.attempt_id AND attempts.student_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM attempts WHERE attempts.id = responses.attempt_id AND attempts.student_id = auth.uid())
  );

CREATE POLICY "lecturer_read_responses" ON responses
  FOR SELECT TO authenticated
  USING (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM attempts a
      JOIN exams e ON e.id = a.exam_id
      WHERE a.id = responses.attempt_id AND e.university_id = auth_university_id()
    )
  );

CREATE POLICY "lecturer_update_feedback" ON responses
  FOR UPDATE TO authenticated
  USING (
    auth_role() = 'lecturer'
    AND EXISTS (
      SELECT 1 FROM attempts a
      JOIN exams e ON e.id = a.exam_id
      WHERE a.id = responses.attempt_id AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    auth_role() = 'lecturer'
    AND EXISTS (
      SELECT 1 FROM attempts a
      JOIN exams e ON e.id = a.exam_id
      WHERE a.id = responses.attempt_id AND e.created_by = auth.uid()
    )
  );


-- ---- results ----
-- Students can only see released results
CREATE POLICY "student_read_own_released_results" ON results
  FOR SELECT TO authenticated
  USING (student_id = auth.uid() AND released_at IS NOT NULL);

CREATE POLICY "lecturer_manage_results" ON results
  FOR ALL TO authenticated
  USING (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM exams WHERE exams.id = results.exam_id AND exams.university_id = auth_university_id()
    )
  )
  WITH CHECK (
    auth_role() IN ('lecturer', 'school_admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM exams WHERE exams.id = results.exam_id AND exams.university_id = auth_university_id()
    )
  );
