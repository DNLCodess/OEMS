-- The original UNIQUE NULLS NOT DISTINCT constraint on (university_id, matric_number)
-- treated two NULL matric_numbers as equal, preventing more than one lecturer/admin
-- per university (they all have matric_number = NULL).
--
-- Fix: drop the table-level constraint and replace with a partial unique index
-- that only enforces uniqueness when matric_number IS NOT NULL.

ALTER TABLE users DROP CONSTRAINT IF EXISTS matric_unique_per_university;

CREATE UNIQUE INDEX IF NOT EXISTS unique_matric_per_university
  ON users (university_id, matric_number)
  WHERE matric_number IS NOT NULL;
