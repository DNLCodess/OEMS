-- Credential-less student authentication
-- Applied: (pending)

-- date_of_birth: verifies a student's identity when checking an
-- already-released result outside an active exam session.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- access_code generalizes lab_code to every exam, not just lab-mode ones —
-- both lab and remote exams now use a shared per-exam code as part of the
-- credential-less student entry flow.
ALTER TABLE exams RENAME COLUMN lab_code TO access_code;

-- handle_new_user: pass date_of_birth through from signup metadata,
-- the same way matric_number/level already are.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, university_id, matric_number, level, date_of_birth, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (NEW.raw_user_meta_data->>'role')::user_role,
    (NEW.raw_user_meta_data->>'university_id')::uuid,
    NEW.raw_user_meta_data->>'matric_number',
    (NEW.raw_user_meta_data->>'level')::student_level,
    (NEW.raw_user_meta_data->>'date_of_birth')::date,
    TRUE
  );
  RETURN NEW;
END;
$$;

-- verification_attempts: throttle for the two credential-less verification
-- endpoints (matric+access_code, matric+date_of_birth). Only ever touched
-- via the service-role client from Server Actions — no student-facing
-- RLS policy needed, default-deny is correct.
CREATE TABLE IF NOT EXISTS verification_attempts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matric_number  TEXT NOT NULL,
  ip             TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_lookup
  ON verification_attempts (matric_number, ip, created_at);

ALTER TABLE verification_attempts ENABLE ROW LEVEL SECURITY;
